/** Stable validation failures for the generic, caller-configured scoring engine. */
export const ReviewScoringErrorCode = {
  INVALID_RUBRIC: "INVALID_RUBRIC",
  INVALID_OUTCOME: "INVALID_OUTCOME",
  UNKNOWN_CONTROL: "UNKNOWN_CONTROL",
  DUPLICATE_OUTCOME: "DUPLICATE_OUTCOME",
  MISSING_OUTCOME: "MISSING_OUTCOME",
  UNSAFE_TOTAL_WEIGHT: "UNSAFE_TOTAL_WEIGHT",
} as const;

export type ReviewScoringErrorCode = (typeof ReviewScoringErrorCode)[keyof typeof ReviewScoringErrorCode];

export class ReviewScoringError extends Error {
  public readonly code: ReviewScoringErrorCode;

  public constructor(code: ReviewScoringErrorCode) {
    super(`Review scoring input is invalid (${code}).`);
    this.name = "ReviewScoringError";
    this.code = code;
  }
}

export interface ReviewRubricControl {
  readonly id: string;
  readonly weight: number;
}

export interface ReviewScoringRubric {
  /** Opaque rubric identifier; the product's version format is not defined here. */
  readonly version: string;
  readonly controls: readonly ReviewRubricControl[];
}

export type ReviewControlOutcomeKind = "met" | "unmet" | "insufficient_evidence";

export interface ReviewControlOutcome {
  readonly controlId: string;
  readonly outcome: ReviewControlOutcomeKind;
}

export interface ScoredReviewControl {
  readonly controlId: string;
  readonly weight: number;
  readonly outcome: ReviewControlOutcomeKind;
}

export interface ReviewScore {
  readonly rubricVersion: string;
  /** Controls are always in rubric order, regardless of outcome input order. */
  readonly controls: readonly ScoredReviewControl[];
  /** Weighted readiness: only `met` controls contribute to the numerator. */
  readonly scoreBasisPoints: number;
  /** Weighted evidence presence: `met` and `unmet` are evidenced outcomes. */
  readonly evidenceCoverageBasisPoints: number;
}

const ALLOWED_OUTCOMES = new Set<string>(["met", "unmet", "insufficient_evidence"]);

/**
 * Scores a complete outcome set against an explicit rubric without I/O or mutation.
 * Basis points use exact integer arithmetic and round half up to the nearest point.
 */
export function scoreReview(rubric: ReviewScoringRubric, outcomes: readonly ReviewControlOutcome[]): ReviewScore {
  if (!isRecord(rubric) || !isOpaqueIdentifier(rubric.version) || !Array.isArray(rubric.controls)) {
    throw new ReviewScoringError(ReviewScoringErrorCode.INVALID_RUBRIC);
  }
  if (rubric.controls.length === 0) {
    throw new ReviewScoringError(ReviewScoringErrorCode.INVALID_RUBRIC);
  }

  const controls: Array<{ readonly id: string; readonly weight: number }> = [];
  const controlIds = new Set<string>();
  let totalWeight = 0;

  for (const candidate of rubric.controls as readonly unknown[]) {
    if (!isRecord(candidate) || !isOpaqueIdentifier(candidate.id) || !Number.isSafeInteger(candidate.weight) || (candidate.weight as number) <= 0) {
      throw new ReviewScoringError(ReviewScoringErrorCode.INVALID_RUBRIC);
    }
    const id = candidate.id;
    const weight = candidate.weight as number;
    if (controlIds.has(id)) {
      throw new ReviewScoringError(ReviewScoringErrorCode.INVALID_RUBRIC);
    }
    if (totalWeight > Number.MAX_SAFE_INTEGER - weight) {
      throw new ReviewScoringError(ReviewScoringErrorCode.UNSAFE_TOTAL_WEIGHT);
    }
    totalWeight += weight;
    controlIds.add(id);
    controls.push({ id, weight });
  }

  if (!Array.isArray(outcomes)) {
    throw new ReviewScoringError(ReviewScoringErrorCode.INVALID_OUTCOME);
  }

  const outcomeById = new Map<string, ReviewControlOutcomeKind>();
  for (const candidate of outcomes as readonly unknown[]) {
    if (!isRecord(candidate) || !isOpaqueIdentifier(candidate.controlId) || typeof candidate.outcome !== "string" || !ALLOWED_OUTCOMES.has(candidate.outcome)) {
      throw new ReviewScoringError(ReviewScoringErrorCode.INVALID_OUTCOME);
    }
    if (!controlIds.has(candidate.controlId)) {
      throw new ReviewScoringError(ReviewScoringErrorCode.UNKNOWN_CONTROL);
    }
    if (outcomeById.has(candidate.controlId)) {
      throw new ReviewScoringError(ReviewScoringErrorCode.DUPLICATE_OUTCOME);
    }
    outcomeById.set(candidate.controlId, candidate.outcome as ReviewControlOutcomeKind);
  }

  if (outcomeById.size !== controls.length) {
    throw new ReviewScoringError(ReviewScoringErrorCode.MISSING_OUTCOME);
  }

  const scoredControls = controls.map(({ id, weight }) => Object.freeze({
    controlId: id,
    weight,
    outcome: outcomeById.get(id) as ReviewControlOutcomeKind,
  }));
  let metWeight = 0n;
  let evidencedWeight = 0n;
  for (const control of scoredControls) {
    const weight = BigInt(control.weight);
    if (control.outcome === "met") {
      metWeight += weight;
    }
    if (control.outcome !== "insufficient_evidence") {
      evidencedWeight += weight;
    }
  }

  const denominator = BigInt(totalWeight);
  const score = toBasisPoints(metWeight, denominator);
  const coverage = toBasisPoints(evidencedWeight, denominator);
  return Object.freeze({
    rubricVersion: rubric.version,
    controls: Object.freeze(scoredControls),
    scoreBasisPoints: score,
    evidenceCoverageBasisPoints: coverage,
  });
}

function toBasisPoints(numerator: bigint, denominator: bigint): number {
  return Number((numerator * 10_000n + denominator / 2n) / denominator);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOpaqueIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.trim() === value
    && !containsControlCharacter(value);
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    if (codePoint <= 0x1f || codePoint === 0x7f) {
      return true;
    }
  }
  return false;
}
