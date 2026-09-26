export const ReviewErrorCode = {
  INVALID_PROPOSAL: "reviews.proposal.invalid",
  INVALID_CITATION: "reviews.citation.invalid",
  INVALID_DECISION: "reviews.decision.invalid",
  INVALID_LIFECYCLE_TRANSITION: "reviews.lifecycle.invalid_transition",
  APPROVAL_REQUIRED: "reviews.publication.approval_required",
} as const;

export type ReviewErrorCode = (typeof ReviewErrorCode)[keyof typeof ReviewErrorCode];

export class ReviewDomainError extends Error {
  readonly code: ReviewErrorCode;

  constructor(code: ReviewErrorCode, message: string) {
    super(message);
    this.name = "ReviewDomainError";
    this.code = code;
  }
}
