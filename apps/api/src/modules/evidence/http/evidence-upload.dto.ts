import { ApiProperty } from "@nestjs/swagger";

export class EvidenceDigestResponseDto {
  @ApiProperty({ example: "src/main.ts" })
  path!: string;

  @ApiProperty({ enum: ["sha256"], example: "sha256" })
  algorithm!: "sha256";

  @ApiProperty({ type: "string", pattern: "^[a-f0-9]{64}$" })
  hexDigest!: string;

  @ApiProperty({ type: "integer", minimum: 0, example: 1420 })
  byteSize!: number;
}

export class EvidenceArchiveIntakeResponseDto {
  @ApiProperty({ format: "uuid" })
  intakeId!: string;

  @ApiProperty({ enum: ["accepted"], example: "accepted" })
  status!: "accepted";

  @ApiProperty({ format: "uuid" })
  workspaceId!: string;

  @ApiProperty({ type: "string", pattern: "^[a-f0-9]{64}$" })
  archiveSha256!: string;

  @ApiProperty({ type: EvidenceDigestResponseDto, isArray: true })
  digests!: readonly EvidenceDigestResponseDto[];
}

export class EvidenceManifestEntryResponseDto {
  @ApiProperty({ example: "src/main.ts" })
  path!: string;

  @ApiProperty({ type: "integer", minimum: 0, example: 1420 })
  byteSize!: number;

  @ApiProperty({ required: false, example: "text/typescript" })
  mediaType?: string;
}

export class EvidenceManifestResponseDto {
  @ApiProperty({ type: "integer", minimum: 0, example: 1420 })
  totalBytes!: number;

  @ApiProperty({ type: EvidenceManifestEntryResponseDto, isArray: true })
  entries!: readonly EvidenceManifestEntryResponseDto[];
}

export class EvidenceArchiveInventoryResponseDto {
  @ApiProperty({ format: "uuid" })
  intakeId!: string;

  @ApiProperty({ enum: ["accepted"], example: "accepted" })
  status!: "accepted";

  @ApiProperty({ format: "uuid" })
  workspaceId!: string;

  @ApiProperty({ type: "string", pattern: "^[a-f0-9]{64}$" })
  archiveSha256!: string;

  @ApiProperty({ type: "string", format: "date-time" })
  createdAt!: string;

  @ApiProperty({ type: "string", format: "date-time" })
  updatedAt!: string;

  @ApiProperty({ type: EvidenceManifestResponseDto })
  manifest!: EvidenceManifestResponseDto;

  @ApiProperty({ type: EvidenceDigestResponseDto, isArray: true })
  digests!: readonly EvidenceDigestResponseDto[];
}
