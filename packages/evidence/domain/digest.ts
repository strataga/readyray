import { EvidenceDomainError, EvidenceErrorCode } from "./errors.js";
import { normalizeRelativeEvidencePath } from "./relative-path.js";
import type { RelativeEvidencePath } from "./relative-path.js";

export interface EvidenceDigestRecordInput {
  readonly path: string;
  readonly algorithm: "sha256";
  readonly hexDigest: string;
  readonly byteSize: number;
}

/** Immutable reference to bytes hashed by an ingestion adapter. */
export interface EvidenceDigestRecord {
  readonly path: RelativeEvidencePath;
  readonly algorithm: "sha256";
  readonly hexDigest: string;
  readonly byteSize: number;
}

export function createEvidenceDigestRecord(input: EvidenceDigestRecordInput): EvidenceDigestRecord {
  if ((input === null || input === undefined) || typeof input !== "object" || input.algorithm !== "sha256" ||
    typeof input.hexDigest !== "string" || !/^[a-fA-F0-9]{64}$/u.test(input.hexDigest) ||
    !Number.isSafeInteger(input.byteSize) || input.byteSize < 0) {
    throw new EvidenceDomainError(EvidenceErrorCode.INVALID_DIGEST, "Digest record must contain a SHA-256 hex digest and a valid byte size.");
  }
  return Object.freeze({
    path: normalizeRelativeEvidencePath(input.path),
    algorithm: "sha256",
    hexDigest: input.hexDigest.toLowerCase(),
    byteSize: input.byteSize,
  });
}
