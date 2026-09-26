import { createEvidenceManifest } from "../domain/manifest.js";
import type { EvidenceManifest, EvidenceManifestEntryInput, EvidenceManifestLimits } from "../domain/manifest.js";
import { EvidenceDomainError, EvidenceErrorCode } from "../domain/errors.js";
import { EvidenceManifestParseError, EvidenceManifestParseErrorCode } from "./errors.js";

export interface EvidenceManifestParsePolicy extends EvidenceManifestLimits {
  readonly maxManifestBytes: number;
}

/** Parse bounded UTF-8 JSON metadata and delegate semantic validation to the domain. */
export function parseBoundedEvidenceManifest(
  bytes: Uint8Array,
  policy: EvidenceManifestParsePolicy,
): EvidenceManifest {
  validateInputAndPolicy(bytes, policy);

  if (bytes.byteLength > policy.maxManifestBytes) {
    throw new EvidenceManifestParseError(
      EvidenceManifestParseErrorCode.BYTE_LIMIT_EXCEEDED,
      "Evidence manifest exceeds the configured byte limit.",
    );
  }

  let text: string;
  try {
    // Preserve a leading BOM so JSON.parse rejects it as non-JSON input.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new EvidenceManifestParseError(
      EvidenceManifestParseErrorCode.INVALID_UTF8,
      "Evidence manifest is not valid UTF-8.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new EvidenceManifestParseError(
      EvidenceManifestParseErrorCode.MALFORMED_JSON,
      "Evidence manifest is not valid JSON.",
    );
  }

  const entries = extractEntries(parsed, policy.maxEntries);
  return createEvidenceManifest(entries, policy);
}

function validateInputAndPolicy(
  bytes: Uint8Array,
  policy: EvidenceManifestParsePolicy,
): void {
  if (!(bytes instanceof Uint8Array)) {
    throw new EvidenceManifestParseError(
      EvidenceManifestParseErrorCode.INVALID_INPUT,
      "Evidence manifest input must be a Uint8Array.",
    );
  }
  if (policy === null || policy === undefined || typeof policy !== "object" ||
    !Number.isSafeInteger(policy.maxManifestBytes) || policy.maxManifestBytes < 0 ||
    !Number.isSafeInteger(policy.maxEntries) || policy.maxEntries < 0 ||
    !Number.isSafeInteger(policy.maxTotalBytes) || policy.maxTotalBytes < 0 ||
    !Number.isSafeInteger(policy.maxPathCharacters) || policy.maxPathCharacters < 1 ||
    !Number.isSafeInteger(policy.maxMediaTypeCharacters) || policy.maxMediaTypeCharacters < 1) {
    throw new EvidenceManifestParseError(
      EvidenceManifestParseErrorCode.INVALID_POLICY,
      "Evidence manifest policy limits are invalid.",
    );
  }
}

function extractEntries(parsed: unknown, maxEntries: number): readonly EvidenceManifestEntryInput[] {
  if (!isRecord(parsed) || !hasOnlyKeys(parsed, ["entries"]) || !Array.isArray(parsed.entries)) {
    throw invalidShape();
  }
  if (parsed.entries.length > maxEntries) {
    throw new EvidenceDomainError(
      EvidenceErrorCode.MANIFEST_LIMIT_EXCEEDED,
      "Manifest contains too many entries.",
      { limit: maxEntries },
    );
  }

  for (const entry of parsed.entries) {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ["path", "byteSize", "mediaType"]) ||
      !Object.hasOwn(entry, "path") || !Object.hasOwn(entry, "byteSize")) {
      throw invalidShape();
    }
  }

  return parsed.entries as EvidenceManifestEntryInput[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}

function invalidShape(): EvidenceManifestParseError {
  return new EvidenceManifestParseError(
    EvidenceManifestParseErrorCode.INVALID_SHAPE,
    "Evidence manifest contains unknown or missing top-level or entry fields.",
  );
}
