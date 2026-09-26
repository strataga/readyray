import { lintSource } from "@secretlint/core";
import { creator as recommendedPreset } from "@secretlint/secretlint-rule-preset-recommend";
import { Buffer } from "node:buffer";
import { extname } from "node:path";
import { isText } from "istextorbinary";
import { normalizeRelativeEvidencePath } from "../domain/relative-path.js";
import { EVIDENCE_SCANNED_FILE_MAX_BYTES } from "./read-bounded-zip.js";
import type { EvidenceArchiveScannerFile } from "./read-bounded-zip.js";

export const EvidenceSecretScanErrorCode = {
  INVALID_PATH: "INVALID_PATH",
  UNSUPPORTED_CONTENT: "UNSUPPORTED_CONTENT",
  SECRET_DETECTED: "SECRET_DETECTED",
  SCANNER_FAILED: "SCANNER_FAILED",
} as const;

export type EvidenceSecretScanErrorCode = (typeof EvidenceSecretScanErrorCode)[keyof typeof EvidenceSecretScanErrorCode];

/** Safe scanner failure metadata. It deliberately contains no path, findings, or source text. */
export class EvidenceSecretScanError extends Error {
  public readonly code: EvidenceSecretScanErrorCode;

  public constructor(code: EvidenceSecretScanErrorCode) {
    super(`Evidence secret scan failed (${code}).`);
    this.name = "EvidenceSecretScanError";
    this.code = code;
  }
}

const COMMENT_FILTER_RULE_ID = "@secretlint/secretlint-rule-filter-comments";
const secretlintConfig = {
  // Register recommend rules individually so the comment filter is absent.
  // Evidence-controlled secretlint-disable directives must not suppress findings.
  rules: recommendedPreset.rules
    .filter((rule) => rule.meta.id !== COMMENT_FILTER_RULE_ID)
    .map((rule) => ({ id: rule.meta.id, rule })),
} satisfies Parameters<typeof lintSource>[0]["options"]["config"];

/**
 * Scan one ZIP reader callback file entirely in memory. Use this as
 * `readBoundedZipEvidenceArchive`'s awaited `scanFile` callback.
 */
export async function scanEvidenceFileForSecrets(file: EvidenceArchiveScannerFile): Promise<void> {
  if (!(file?.bytes instanceof Uint8Array) || file.bytes.byteLength > EVIDENCE_SCANNED_FILE_MAX_BYTES) {
    throw new EvidenceSecretScanError(EvidenceSecretScanErrorCode.UNSUPPORTED_CONTENT);
  }

  try {
    normalizeRelativeEvidencePath(file.path);
  } catch {
    throw new EvidenceSecretScanError(EvidenceSecretScanErrorCode.INVALID_PATH);
  }

  let content: string;
  try {
    // This Buffer shares the callback's bounded backing bytes and is only read.
    const bytes = Buffer.from(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength);
    if (containsBinaryControlByte(bytes) || isText(undefined, bytes) !== true) {
      throw new EvidenceSecretScanError(EvidenceSecretScanErrorCode.UNSUPPORTED_CONTENT);
    }
    content = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
  } catch (error) {
    if (error instanceof EvidenceSecretScanError) {
      throw error;
    }
    throw new EvidenceSecretScanError(EvidenceSecretScanErrorCode.UNSUPPORTED_CONTENT);
  }

  try {
    const result = await lintSource({
      source: {
        // Never pass evidence path metadata into a third-party diagnostic/log path.
        filePath: "evidence.txt",
        ext: extname("evidence.txt"),
        content,
        contentType: "text",
      },
      options: {
        config: secretlintConfig,
        maskSecrets: true,
        noPhysicFilePath: true,
      },
    });
    if (result.messages.length > 0) {
      throw new EvidenceSecretScanError(EvidenceSecretScanErrorCode.SECRET_DETECTED);
    }
  } catch (error) {
    if (error instanceof EvidenceSecretScanError) {
      throw error;
    }
    // Do not retain Secretlint error text or causes; a plugin error could embed source.
    throw new EvidenceSecretScanError(EvidenceSecretScanErrorCode.SCANNER_FAILED);
  }
}

function containsBinaryControlByte(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (byte === 0 || (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) || byte === 0x7f) {
      return true;
    }
  }
  return false;
}
