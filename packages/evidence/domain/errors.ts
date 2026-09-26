/** Stable domain error identifiers; callers may map these to transport errors. */
export const EvidenceErrorCode = {
  INVALID_RELATIVE_PATH: "evidence.path.invalid",
  INVALID_MANIFEST: "evidence.manifest.invalid",
  MANIFEST_LIMIT_EXCEEDED: "evidence.manifest.limit_exceeded",
  INVALID_DIGEST: "evidence.digest.invalid",
  INVALID_INTAKE_TRANSITION: "evidence.intake.invalid_transition",
  INVALID_INTAKE: "evidence.intake.invalid",
} as const;

export type EvidenceErrorCode = (typeof EvidenceErrorCode)[keyof typeof EvidenceErrorCode];

export class EvidenceDomainError extends Error {
  readonly code: EvidenceErrorCode;
  readonly details?: Readonly<Record<string, string | number>>;

  constructor(
    code: EvidenceErrorCode,
    message: string,
    details?: Readonly<Record<string, string | number>>,
  ) {
    super(message);
    this.name = "EvidenceDomainError";
    this.code = code;
    this.details = details === undefined ? undefined : Object.freeze({ ...details });
  }
}
