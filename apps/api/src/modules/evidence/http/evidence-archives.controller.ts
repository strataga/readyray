import { Body, Controller, Get, HttpStatus, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../../../http/authenticated-request.js";
import { ApiContractResponse, ApiProblem } from "../../../http/api-problem.decorator.js";
import { SessionGuard } from "../../../http/session.guard.js";
import {
  EvidenceArchiveIngestError,
  EvidenceArchiveIngestErrorCode,
  EvidenceArchiveIngestRejectionCode,
  EvidenceArchiveInventoryError,
  EvidenceArchiveInventoryErrorCode,
  getEvidenceArchiveInventory,
  ingestEvidenceArchive,
} from "@archgauge/evidence/application";
import type {
  EvidenceArchiveInventoryReadPort,
  EvidenceArchiveStoragePort,
  IngestEvidenceArchiveResult,
  WorkspaceEvidenceAuthorizationPort,
} from "@archgauge/evidence/application";
import { EVIDENCE_ARCHIVE_LIMITS } from "@archgauge/evidence/application";
import { EVIDENCE_ARCHIVE_STORAGE, EVIDENCE_WORKSPACE_AUTHORIZATION } from "./evidence.tokens.js";
import { EvidenceUploadHttpError } from "./evidence-upload.error.js";
import { EvidenceArchiveIntakeResponseDto, EvidenceArchiveInventoryResponseDto } from "./evidence-upload.dto.js";

@ApiTags("evidence")
@ApiBearerAuth("bearer")
@UseGuards(SessionGuard)
@Controller()
export class EvidenceArchivesController {
  constructor(
    @Inject(EVIDENCE_WORKSPACE_AUTHORIZATION)
    private readonly authorization: WorkspaceEvidenceAuthorizationPort,
    @Inject(EVIDENCE_ARCHIVE_STORAGE)
    private readonly storage: EvidenceArchiveStoragePort & EvidenceArchiveInventoryReadPort,
  ) {}

  @Post("workspaces/:workspaceId/evidence/archives")
  @ApiOperation({
    summary: "Upload a bounded evidence ZIP archive",
    description: "Accepts a raw application/zip body, authorizes workspace membership, scans evidence before storage, and returns immutable digest metadata only.",
  })
  @ApiParam({ name: "workspaceId", type: String })
  @ApiConsumes("application/zip")
  @ApiBody({
    required: true,
    schema: { type: "string", format: "binary" },
    description: `Raw ZIP bytes. Maximum compressed size: ${EVIDENCE_ARCHIVE_LIMITS.maxCompressedBytes} bytes.`,
  })
  @ApiContractResponse({ status: 201, description: "Evidence archive accepted and stored after validation and secret scanning.", type: EvidenceArchiveIntakeResponseDto })
  @ApiProblem(400, "The upload request is invalid.")
  @ApiProblem(401, "A valid bearer session is required.")
  @ApiProblem(403, "The caller cannot ingest evidence into this workspace.")
  @ApiProblem(413, "The compressed archive exceeds the upload limit.")
  @ApiProblem(415, "The request must use application/zip content.")
  @ApiProblem(422, "The archive was rejected during evidence validation.")
  @ApiProblem(429, "Another evidence upload is in progress.")
  @ApiProblem(500, "The request could not be completed.")
  @ApiProblem(503, "Authorization, scanning, or storage is temporarily unavailable.")
  async upload(
    @Param("workspaceId") workspaceId: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<EvidenceArchiveIntakeResponseDto> {
    if (request.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/zip") {
      throw new EvidenceUploadHttpError(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "unsupported_media_type", "The request must use application/zip content.");
    }
    if (!Buffer.isBuffer(body)) {
      throw new EvidenceUploadHttpError(HttpStatus.BAD_REQUEST, "invalid_input", "A raw ZIP byte body is required.");
    }
    try {
      if (body.byteLength > EVIDENCE_ARCHIVE_LIMITS.maxCompressedBytes) {
        throw new EvidenceUploadHttpError(HttpStatus.PAYLOAD_TOO_LARGE, "archive_limit_exceeded", "The compressed archive exceeds the upload limit.");
      }

      let result: IngestEvidenceArchiveResult;
      try {
        result = await ingestEvidenceArchive({
          actorId: request.userId,
          workspaceId,
          archiveBytes: body,
        }, this.authorization, this.storage);
      } catch (error) {
        if (!(error instanceof EvidenceArchiveIngestError)) {
          throw error;
        }
        throw mapIngestError(error);
      }

      if (result.status === "rejected") {
        throw mapRejectedIntake(result.rejectionCode);
      }

      return {
        intakeId: result.intake.id,
        status: "accepted",
        workspaceId: result.workspaceId,
        archiveSha256: result.archiveSha256,
        digests: result.digests.map(({ path, algorithm, hexDigest, byteSize }) => ({
          path,
          algorithm,
          hexDigest,
          byteSize,
        })),
      };
    } finally {
      body.fill(0);
    }
  }

  @Get("workspaces/:workspaceId/evidence/archives/:intakeId")
  @ApiOperation({
    summary: "Read accepted evidence archive inventory",
    description: "Returns accepted intake metadata, manifest, and SHA-256 digests for a workspace member. Archive bytes are never returned.",
  })
  @ApiParam({ name: "workspaceId", type: String, format: "uuid" })
  @ApiParam({ name: "intakeId", type: String, format: "uuid" })
  @ApiContractResponse({ status: 200, description: "Accepted evidence archive inventory.", type: EvidenceArchiveInventoryResponseDto })
  @ApiProblem(400, "The workspace or intake identifier is invalid.")
  @ApiProblem(401, "A valid bearer session is required.")
  @ApiProblem(403, "The caller cannot access evidence in this workspace.")
  @ApiProblem(404, "The accepted evidence archive was not found.")
  @ApiProblem(500, "The request could not be completed.")
  @ApiProblem(503, "Workspace authorization or evidence storage is temporarily unavailable.")
  async getInventory(
    @Param("workspaceId") workspaceId: string,
    @Param("intakeId") intakeId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<EvidenceArchiveInventoryResponseDto> {
    let result;
    try {
      result = await getEvidenceArchiveInventory({
        actorId: request.userId,
        workspaceId,
        intakeId,
      }, this.authorization, this.storage);
    } catch (error) {
      if (!(error instanceof EvidenceArchiveInventoryError)) {
        throw error;
      }
      throw mapInventoryError(error);
    }

    return {
      intakeId: result.intake.id,
      status: "accepted",
      workspaceId: result.workspaceId,
      archiveSha256: result.archiveSha256,
      createdAt: result.intake.createdAt,
      updatedAt: result.intake.updatedAt,
      manifest: {
        totalBytes: result.manifest.totalBytes,
        entries: result.manifest.entries.map(({ path, byteSize, mediaType }) => ({
          path,
          byteSize,
          ...(mediaType === undefined ? {} : { mediaType }),
        })),
      },
      digests: result.digests.map(({ path, algorithm, hexDigest, byteSize }) => ({
        path,
        algorithm,
        hexDigest,
        byteSize,
      })),
    };
  }
}

function mapIngestError(error: EvidenceArchiveIngestError): EvidenceUploadHttpError {
  switch (error.code) {
    case EvidenceArchiveIngestErrorCode.INVALID_INPUT:
      return new EvidenceUploadHttpError(HttpStatus.BAD_REQUEST, "invalid_input", "The upload request is invalid.");
    case EvidenceArchiveIngestErrorCode.WORKSPACE_FORBIDDEN:
      return new EvidenceUploadHttpError(HttpStatus.FORBIDDEN, "workspace_forbidden", "The caller cannot ingest evidence into this workspace.");
    case EvidenceArchiveIngestErrorCode.AUTHORIZATION_UNAVAILABLE:
      return new EvidenceUploadHttpError(HttpStatus.SERVICE_UNAVAILABLE, "authorization_unavailable", "Workspace authorization is temporarily unavailable.");
    case EvidenceArchiveIngestErrorCode.STORAGE_FAILED:
      return new EvidenceUploadHttpError(HttpStatus.SERVICE_UNAVAILABLE, "storage_unavailable", "Evidence storage is temporarily unavailable.");
  }
}

function mapRejectedIntake(code: string): EvidenceUploadHttpError {
  switch (code) {
    case EvidenceArchiveIngestRejectionCode.SECRET_DETECTED:
      return new EvidenceUploadHttpError(HttpStatus.UNPROCESSABLE_ENTITY, "secret_detected", "The evidence archive contains credentials and was rejected.");
    case EvidenceArchiveIngestRejectionCode.UNSUPPORTED_CONTENT:
      return new EvidenceUploadHttpError(HttpStatus.UNPROCESSABLE_ENTITY, "unsupported_content", "The evidence archive contains unsupported content.");
    case EvidenceArchiveIngestRejectionCode.ARCHIVE_LIMIT_EXCEEDED:
      return new EvidenceUploadHttpError(HttpStatus.PAYLOAD_TOO_LARGE, "archive_limit_exceeded", "The evidence archive exceeds an intake limit.");
    case EvidenceArchiveIngestRejectionCode.SCANNER_FAILED:
      return new EvidenceUploadHttpError(HttpStatus.SERVICE_UNAVAILABLE, "scanner_unavailable", "Evidence scanning is temporarily unavailable.");
    case EvidenceArchiveIngestRejectionCode.CAPACITY_EXCEEDED:
      return new EvidenceUploadHttpError(HttpStatus.TOO_MANY_REQUESTS, "upload_busy", "An evidence upload is already in progress.");
    case EvidenceArchiveIngestRejectionCode.INVALID_ARCHIVE:
    default:
      return new EvidenceUploadHttpError(HttpStatus.UNPROCESSABLE_ENTITY, "invalid_archive", "The evidence archive could not be validated.");
  }
}

function mapInventoryError(error: EvidenceArchiveInventoryError): EvidenceUploadHttpError {
  switch (error.code) {
    case EvidenceArchiveInventoryErrorCode.INVALID_INPUT:
      return new EvidenceUploadHttpError(HttpStatus.BAD_REQUEST, "invalid_input", "The workspace or intake identifier is invalid.");
    case EvidenceArchiveInventoryErrorCode.WORKSPACE_FORBIDDEN:
      return new EvidenceUploadHttpError(HttpStatus.FORBIDDEN, "workspace_forbidden", "The caller cannot access evidence in this workspace.");
    case EvidenceArchiveInventoryErrorCode.NOT_FOUND:
      return new EvidenceUploadHttpError(HttpStatus.NOT_FOUND, "not_found", "The accepted evidence archive was not found.");
    case EvidenceArchiveInventoryErrorCode.AUTHORIZATION_UNAVAILABLE:
      return new EvidenceUploadHttpError(HttpStatus.SERVICE_UNAVAILABLE, "authorization_unavailable", "Workspace authorization is temporarily unavailable.");
    case EvidenceArchiveInventoryErrorCode.STORAGE_UNAVAILABLE:
      return new EvidenceUploadHttpError(HttpStatus.SERVICE_UNAVAILABLE, "storage_unavailable", "Evidence storage is temporarily unavailable.");
  }
}
