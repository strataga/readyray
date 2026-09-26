import { ReviewDomainError, ReviewErrorCode } from "./errors.js";
import { containsControlCharacters } from "./control-characters.js";

export type CanonicalEvidencePath = string & { readonly __canonicalEvidencePath: unique symbol };

export interface EvidenceCitationInput {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly sha256: string;
}

export interface EvidenceCitation {
  readonly path: CanonicalEvidencePath;
  readonly startLine: number;
  readonly endLine: number;
  readonly sha256: string;
}

/** Validate and freeze a precise path, inclusive line range, and content digest citation. */
export function createEvidenceCitation(input: EvidenceCitationInput): EvidenceCitation {
  if (input === null || input === undefined || typeof input !== "object") {
    throw new ReviewDomainError(ReviewErrorCode.INVALID_CITATION, "Citation must be an object.");
  }
  const path = canonicalizeRelativePath(input.path);
  if (!Number.isSafeInteger(input.startLine) || input.startLine < 1 ||
    !Number.isSafeInteger(input.endLine) || input.endLine < input.startLine ||
    typeof input.sha256 !== "string" || !/^[a-fA-F0-9]{64}$/u.test(input.sha256)) {
    throw new ReviewDomainError(ReviewErrorCode.INVALID_CITATION, "Citation requires a valid inclusive line range and SHA-256 digest.");
  }
  return Object.freeze({ path, startLine: input.startLine, endLine: input.endLine, sha256: input.sha256.toLowerCase() });
}

function canonicalizeRelativePath(input: string): CanonicalEvidencePath {
  if (typeof input !== "string" || input.length === 0 || !isWellFormedUnicode(input) || containsControlCharacters(input)) {
    throw new ReviewDomainError(ReviewErrorCode.INVALID_CITATION, "Citation path is empty, contains malformed Unicode, or contains control characters.");
  }
  const slashPath = input.replaceAll("\\", "/");
  if (slashPath.startsWith("/") || /^[a-zA-Z]:/u.test(slashPath)) {
    throw new ReviewDomainError(ReviewErrorCode.INVALID_CITATION, "Citation path must be relative.");
  }
  const segments = slashPath.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new ReviewDomainError(ReviewErrorCode.INVALID_CITATION, "Citation path must not traverse parent directories.");
  }
  const normalized = segments.filter((segment) => segment !== "" && segment !== ".").join("/");
  if (normalized.length === 0) {
    throw new ReviewDomainError(ReviewErrorCode.INVALID_CITATION, "Citation path must identify an evidence file.");
  }
  return normalized as CanonicalEvidencePath;
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
