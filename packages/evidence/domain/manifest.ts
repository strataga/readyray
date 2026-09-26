import { EvidenceDomainError, EvidenceErrorCode } from "./errors.js";
import { containsControlCharacters } from "./control-characters.js";
import { normalizeRelativeEvidencePath } from "./relative-path.js";
import type { RelativeEvidencePath } from "./relative-path.js";

export interface EvidenceManifestEntryInput {
  readonly path: string;
  readonly byteSize: number;
  readonly mediaType?: string;
}

export interface EvidenceManifestEntry {
  readonly path: RelativeEvidencePath;
  readonly byteSize: number;
  readonly mediaType?: string;
}

export interface EvidenceManifestLimits {
  readonly maxEntries: number;
  readonly maxTotalBytes: number;
  readonly maxPathCharacters: number;
  readonly maxMediaTypeCharacters: number;
}

export interface EvidenceManifest {
  readonly entries: readonly EvidenceManifestEntry[];
  readonly totalBytes: number;
}

/**
 * Build an immutable metadata-only manifest. Limits are explicit policy inputs:
 * product defaults remain undecided until the ingestion requirements are set.
 */
export function createEvidenceManifest(
  inputs: readonly EvidenceManifestEntryInput[],
  limits: EvidenceManifestLimits,
): EvidenceManifest {
  validateLimits(limits);
  if (!Array.isArray(inputs)) {
    throw new EvidenceDomainError(EvidenceErrorCode.INVALID_MANIFEST, "Manifest entries must be an array.");
  }
  if (inputs.length > limits.maxEntries) {
    throw new EvidenceDomainError(EvidenceErrorCode.MANIFEST_LIMIT_EXCEEDED, "Manifest contains too many entries.", { limit: limits.maxEntries });
  }

  const seen = new Set<string>();
  let totalBytes = 0;
  const entries = inputs.map((input) => {
    if (input === null || typeof input !== "object") {
      throw new EvidenceDomainError(EvidenceErrorCode.INVALID_MANIFEST, "Manifest entry must be an object.");
    }
    const path = normalizeRelativeEvidencePath(input.path);
    if (path.length > limits.maxPathCharacters) {
      throw new EvidenceDomainError(EvidenceErrorCode.MANIFEST_LIMIT_EXCEEDED, "Manifest path exceeds the character limit.", { limit: limits.maxPathCharacters });
    }
    if (seen.has(path)) {
      throw new EvidenceDomainError(EvidenceErrorCode.INVALID_MANIFEST, "Manifest contains a duplicate normalized path.");
    }
    seen.add(path);

    if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 0) {
      throw new EvidenceDomainError(EvidenceErrorCode.INVALID_MANIFEST, "Entry byteSize must be a non-negative safe integer.");
    }
    totalBytes += input.byteSize;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
      throw new EvidenceDomainError(EvidenceErrorCode.MANIFEST_LIMIT_EXCEEDED, "Manifest exceeds the total byte limit.", { limit: limits.maxTotalBytes });
    }

    if (input.mediaType !== undefined &&
      (typeof input.mediaType !== "string" || input.mediaType.length === 0 || input.mediaType.length > limits.maxMediaTypeCharacters || containsControlCharacters(input.mediaType))) {
      throw new EvidenceDomainError(EvidenceErrorCode.INVALID_MANIFEST, "Entry mediaType is empty, too long, or contains control characters.");
    }
    return Object.freeze({ path, byteSize: input.byteSize, ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }) });
  });

  return Object.freeze({ entries: Object.freeze(entries), totalBytes });
}

function validateLimits(limits: EvidenceManifestLimits): void {
  if ((limits === null || limits === undefined) || typeof limits !== "object" ||
    !Number.isSafeInteger(limits.maxEntries) || limits.maxEntries < 0 ||
    !Number.isSafeInteger(limits.maxTotalBytes) || limits.maxTotalBytes < 0 ||
    !Number.isSafeInteger(limits.maxPathCharacters) || limits.maxPathCharacters < 1 ||
    !Number.isSafeInteger(limits.maxMediaTypeCharacters) || limits.maxMediaTypeCharacters < 1) {
    throw new EvidenceDomainError(EvidenceErrorCode.INVALID_MANIFEST, "Manifest limits must be non-negative safe integers (character limits must be positive).");
  }
}
