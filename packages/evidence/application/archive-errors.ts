export const EvidenceArchiveErrorCode = {
  INVALID_INPUT: "evidence.archive.invalid_input",
  INVALID_ARCHIVE: "evidence.archive.invalid_archive",
  CONCURRENT_LIMIT: "evidence.archive.concurrent_limit",
  COMPRESSED_SIZE_LIMIT: "evidence.archive.compressed_size_limit",
  ENTRY_LIMIT: "evidence.archive.entry_limit",
  EXPANDED_SIZE_LIMIT: "evidence.archive.expanded_size_limit",
  SCANNED_FILE_SIZE_LIMIT: "evidence.archive.scanned_file_size_limit",
  INVALID_ENTRY: "evidence.archive.invalid_entry",
  UNSUPPORTED_ENCRYPTION: "evidence.archive.unsupported_encryption",
  UNSUPPORTED_ENTRY_TYPE: "evidence.archive.unsupported_entry_type",
  INVALID_PATH: "evidence.archive.invalid_path",
  DUPLICATE_PATH: "evidence.archive.duplicate_path",
  PATH_COLLISION: "evidence.archive.path_collision",
  PATH_COMPLEXITY_LIMIT: "evidence.archive.path_complexity_limit",
  SIZE_MISMATCH: "evidence.archive.size_mismatch",
  CHECKSUM_MISMATCH: "evidence.archive.checksum_mismatch",
  SCANNER_FAILED: "evidence.archive.scanner_failed",
  SCANNER_MUTATED_BYTES: "evidence.archive.scanner_mutated_bytes",
} as const;

export type EvidenceArchiveErrorCode =
  (typeof EvidenceArchiveErrorCode)[keyof typeof EvidenceArchiveErrorCode];

export class EvidenceArchiveReadError extends Error {
  readonly code: EvidenceArchiveErrorCode;

  constructor(code: EvidenceArchiveErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EvidenceArchiveReadError";
    this.code = code;
  }
}
