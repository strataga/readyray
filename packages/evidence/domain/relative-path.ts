import { EvidenceDomainError, EvidenceErrorCode } from "./errors.js";
import { containsControlCharacters } from "./control-characters.js";

/** A canonical, repository-relative POSIX path. */
export type RelativeEvidencePath = string & { readonly __relativeEvidencePath: unique symbol };

/**
 * Validate and canonicalize an evidence path without touching the filesystem.
 * Backslashes are treated as separators; traversal segments and absolute paths
 * are rejected instead of being normalized away.
 */
export function normalizeRelativeEvidencePath(input: string): RelativeEvidencePath {
  if (typeof input !== "string" || input.length === 0 || !isWellFormedUnicode(input) || containsControlCharacters(input)) {
    throw new EvidenceDomainError(EvidenceErrorCode.INVALID_RELATIVE_PATH, "Evidence path is empty, contains malformed Unicode, or contains control characters.");
  }

  const slashPath = input.replaceAll("\\", "/");
  if (slashPath.startsWith("/") || /^[a-zA-Z]:/u.test(slashPath)) {
    throw new EvidenceDomainError(EvidenceErrorCode.INVALID_RELATIVE_PATH, "Evidence path must be relative.");
  }

  const segments = slashPath.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new EvidenceDomainError(EvidenceErrorCode.INVALID_RELATIVE_PATH, "Evidence path must not traverse parent directories.");
  }

  const normalized = segments.filter((segment) => segment !== "" && segment !== ".").join("/");
  if (normalized.length === 0) {
    throw new EvidenceDomainError(EvidenceErrorCode.INVALID_RELATIVE_PATH, "Evidence path must identify a file or directory.");
  }

  return normalized as RelativeEvidencePath;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const nextIndex = index + 1;
      if (nextIndex >= value.length) {
        return false;
      }
      const next = value.charCodeAt(nextIndex);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return false;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}
