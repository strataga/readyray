export const EvidenceManifestParseErrorCode = {
  INVALID_INPUT: "evidence.manifest_parse.invalid_input",
  INVALID_POLICY: "evidence.manifest_parse.invalid_policy",
  BYTE_LIMIT_EXCEEDED: "evidence.manifest_parse.byte_limit_exceeded",
  INVALID_UTF8: "evidence.manifest_parse.invalid_utf8",
  MALFORMED_JSON: "evidence.manifest_parse.malformed_json",
  INVALID_SHAPE: "evidence.manifest_parse.invalid_shape",
} as const;

export type EvidenceManifestParseErrorCode =
  (typeof EvidenceManifestParseErrorCode)[keyof typeof EvidenceManifestParseErrorCode];

export class EvidenceManifestParseError extends Error {
  readonly code: EvidenceManifestParseErrorCode;

  constructor(code: EvidenceManifestParseErrorCode, message: string) {
    super(message);
    this.name = "EvidenceManifestParseError";
    this.code = code;
  }
}
