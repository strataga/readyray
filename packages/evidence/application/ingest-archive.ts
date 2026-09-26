import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { EvidenceArchiveErrorCode, EvidenceArchiveReadError } from "./archive-errors.js";
import { EVIDENCE_ARCHIVE_LIMITS, readBoundedZipEvidenceArchive } from "./read-bounded-zip.js";
import type { EvidenceArchiveReadResult } from "./read-bounded-zip.js";
import { EvidenceSecretScanError, EvidenceSecretScanErrorCode, scanEvidenceFileForSecrets } from "./secret-scanner.js";
import { createEvidenceIntake, transitionEvidenceIntake } from "../domain/intake.js";
import type { EvidenceIntake } from "../domain/intake.js";

export const EvidenceArchiveIngestRejectionCode = {
  SECRET_DETECTED: "secret_detected",
  UNSUPPORTED_CONTENT: "unsupported_content",
  INVALID_ARCHIVE: "invalid_archive",
  ARCHIVE_LIMIT_EXCEEDED: "archive_limit_exceeded",
  SCANNER_FAILED: "scanner_failed",
  CAPACITY_EXCEEDED: "capacity_exceeded",
} as const;

export type EvidenceArchiveIngestRejectionCode =
  (typeof EvidenceArchiveIngestRejectionCode)[keyof typeof EvidenceArchiveIngestRejectionCode];

export const EvidenceArchiveIngestErrorCode = {
  INVALID_INPUT: "invalid_input",
  WORKSPACE_FORBIDDEN: "workspace_forbidden",
  AUTHORIZATION_UNAVAILABLE: "authorization_unavailable",
  STORAGE_FAILED: "storage_failed",
} as const;

export type EvidenceArchiveIngestErrorCode =
  (typeof EvidenceArchiveIngestErrorCode)[keyof typeof EvidenceArchiveIngestErrorCode];

/** Safe application failure that deliberately retains no archive bytes or scanner diagnostics. */
export class EvidenceArchiveIngestError extends Error {
  readonly code: EvidenceArchiveIngestErrorCode;

  constructor(code: EvidenceArchiveIngestErrorCode) {
    super(`Evidence archive intake failed (${code}).`);
    this.name = "EvidenceArchiveIngestError";
    this.code = code;
  }
}

export interface WorkspaceEvidenceAuthorizationPort {
  canIngestEvidence(input: { readonly actorId: string; readonly workspaceId: string }): Promise<boolean>;
}

export interface StoreAcceptedEvidenceArchive {
  readonly workspaceId: string;
  readonly intake: AcceptedEvidenceArchiveIntake;
  readonly archiveBytes: Uint8Array;
}

/** Implementations must commit the accepted intake and bytes atomically or reject without committing. */
export interface EvidenceArchiveStoragePort {
  /** Must copy/commit the supplied bytes before resolving; it must not retain the caller's buffer. */
  storeAcceptedArchive(input: StoreAcceptedEvidenceArchive): Promise<void>;
}

export interface IngestEvidenceArchiveInput {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly archiveBytes: Uint8Array;
}

export interface AcceptedEvidenceArchiveIntake {
  readonly status: "accepted";
  readonly intake: EvidenceIntake & { readonly status: "accepted" };
  readonly workspaceId: string;
  readonly archiveSha256: string;
  readonly manifest: EvidenceArchiveReadResult["manifest"];
  readonly digests: EvidenceArchiveReadResult["digests"];
}

export interface RejectedEvidenceArchiveIntake {
  readonly status: "rejected";
  readonly intake: EvidenceIntake & { readonly status: "rejected" };
  readonly rejectionCode: EvidenceArchiveIngestRejectionCode;
}

export type IngestEvidenceArchiveResult =
  | AcceptedEvidenceArchiveIntake
  | RejectedEvidenceArchiveIntake;

/** Authorize first, validate and scan every file, then atomically store the original archive snapshot. */
export async function ingestEvidenceArchive(
  input: IngestEvidenceArchiveInput,
  authorization: WorkspaceEvidenceAuthorizationPort,
  storage: EvidenceArchiveStoragePort,
): Promise<IngestEvidenceArchiveResult> {
  if (!(input?.archiveBytes instanceof Uint8Array) ||
    input.archiveBytes.byteLength > EVIDENCE_ARCHIVE_LIMITS.maxCompressedBytes) {
    throw new EvidenceArchiveIngestError(EvidenceArchiveIngestErrorCode.INVALID_INPUT);
  }

  let authorized: boolean;
  try {
    authorized = await authorization.canIngestEvidence({
      actorId: input.actorId,
      workspaceId: input.workspaceId,
    });
  } catch {
    throw new EvidenceArchiveIngestError(EvidenceArchiveIngestErrorCode.AUTHORIZATION_UNAVAILABLE);
  }
  if (!authorized) {
    throw new EvidenceArchiveIngestError(EvidenceArchiveIngestErrorCode.WORKSPACE_FORBIDDEN);
  }

  // Authorization is complete. Snapshot synchronously before parsing so later caller mutation cannot change stored bytes.
  const archiveSnapshot = Buffer.from(input.archiveBytes);
  try {
    const createdAt = new Date().toISOString();
    const received = createEvidenceIntake(randomUUID(), createdAt);
    const validating = transitionEvidenceIntake(received, "validating", createdAt);

    let archiveResult: EvidenceArchiveReadResult;
    try {
      archiveResult = await readBoundedZipEvidenceArchive(archiveSnapshot, {
        scanFile: scanEvidenceFileForSecrets,
      });
    } catch (error) {
      return rejectIntake(validating, mapArchiveFailure(error));
    }

    const acceptedIntake = transitionEvidenceIntake(validating, "accepted", new Date().toISOString());
    if (acceptedIntake.status !== "accepted") {
      throw new Error("Evidence intake lifecycle did not produce an accepted state.");
    }
    const accepted: AcceptedEvidenceArchiveIntake = Object.freeze({
      status: "accepted",
      intake: acceptedIntake as EvidenceIntake & { readonly status: "accepted" },
      workspaceId: input.workspaceId,
      archiveSha256: createHash("sha256").update(archiveSnapshot).digest("hex"),
      manifest: archiveResult.manifest,
      digests: archiveResult.digests,
    });

    try {
      await storage.storeAcceptedArchive({
        workspaceId: input.workspaceId,
        intake: accepted,
        archiveBytes: archiveSnapshot,
      });
    } catch {
      throw new EvidenceArchiveIngestError(EvidenceArchiveIngestErrorCode.STORAGE_FAILED);
    }

    return accepted;
  } finally {
    archiveSnapshot.fill(0);
  }
}

function rejectIntake(
  validating: EvidenceIntake,
  rejectionCode: EvidenceArchiveIngestRejectionCode,
): RejectedEvidenceArchiveIntake {
  const rejected = transitionEvidenceIntake(validating, "rejected", new Date().toISOString(), rejectionCode);
  if (rejected.status !== "rejected") {
    throw new Error("Evidence intake lifecycle did not produce a rejected state.");
  }
  return Object.freeze({
    status: "rejected",
    intake: rejected as EvidenceIntake & { readonly status: "rejected" },
    rejectionCode,
  });
}

function mapArchiveFailure(error: unknown): EvidenceArchiveIngestRejectionCode {
  if (!(error instanceof EvidenceArchiveReadError)) {
    return EvidenceArchiveIngestRejectionCode.INVALID_ARCHIVE;
  }

  if (error.code === EvidenceArchiveErrorCode.SCANNER_FAILED) {
    const cause = (error as EvidenceArchiveReadError & { readonly cause?: unknown }).cause;
    if (cause instanceof EvidenceSecretScanError) {
      switch (cause.code) {
        case EvidenceSecretScanErrorCode.SECRET_DETECTED:
          return EvidenceArchiveIngestRejectionCode.SECRET_DETECTED;
        case EvidenceSecretScanErrorCode.UNSUPPORTED_CONTENT:
          return EvidenceArchiveIngestRejectionCode.UNSUPPORTED_CONTENT;
        default:
          return EvidenceArchiveIngestRejectionCode.SCANNER_FAILED;
      }
    }
    return EvidenceArchiveIngestRejectionCode.SCANNER_FAILED;
  }

  if (error.code === EvidenceArchiveErrorCode.COMPRESSED_SIZE_LIMIT ||
    error.code === EvidenceArchiveErrorCode.ENTRY_LIMIT ||
    error.code === EvidenceArchiveErrorCode.EXPANDED_SIZE_LIMIT ||
    error.code === EvidenceArchiveErrorCode.PATH_COMPLEXITY_LIMIT) {
    return EvidenceArchiveIngestRejectionCode.ARCHIVE_LIMIT_EXCEEDED;
  }

  if (error.code === EvidenceArchiveErrorCode.SCANNED_FILE_SIZE_LIMIT) {
    return EvidenceArchiveIngestRejectionCode.UNSUPPORTED_CONTENT;
  }

  if (error.code === EvidenceArchiveErrorCode.CONCURRENT_LIMIT) {
    return EvidenceArchiveIngestRejectionCode.CAPACITY_EXCEEDED;
  }

  return EvidenceArchiveIngestRejectionCode.INVALID_ARCHIVE;
}
