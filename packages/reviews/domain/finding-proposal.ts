import { createEvidenceCitation } from "./citation.js";
import type { EvidenceCitation, EvidenceCitationInput } from "./citation.js";
import { ReviewDomainError, ReviewErrorCode } from "./errors.js";

export type FindingClassification = "fact" | "inference" | "assumption" | "insufficient_evidence";
export type FindingProposalStatus = "proposed" | "approved" | "rejected" | "published";

export interface FindingProposalInput {
  readonly id: string;
  readonly classification: FindingClassification;
  readonly title: string;
  readonly description: string;
  readonly citations: readonly EvidenceCitationInput[];
  readonly proposedAt: string;
}

export interface FindingProposal {
  readonly id: string;
  readonly classification: FindingClassification;
  readonly title: string;
  readonly description: string;
  readonly citations: readonly EvidenceCitation[];
  readonly status: FindingProposalStatus;
  readonly proposedAt: string;
  readonly reviewerId?: string;
  readonly decidedAt?: string;
  readonly publishedAt?: string;
}

export type HumanDecision = "approve" | "reject";

// In-memory provenance only: serialized proposals do not retain this marker.
// Durable rehydration must verify a trusted persisted reviewer-decision event
// before a dedicated reconstitution path can restore publication eligibility.
const explicitlyApproved = new WeakSet<object>();

export function createFindingProposal(input: FindingProposalInput): FindingProposal {
  if (input === null || input === undefined || typeof input !== "object" || !isIdentifier(input.id) ||
    !isClassification(input.classification) || !isText(input.title) || !isText(input.description) ||
    !isCanonicalUtcTimestamp(input.proposedAt) || !Array.isArray(input.citations)) {
    throw new ReviewDomainError(ReviewErrorCode.INVALID_PROPOSAL, "Finding proposal fields are invalid.");
  }
  if (input.citations.length === 0 && input.classification !== "insufficient_evidence") {
    throw new ReviewDomainError(ReviewErrorCode.INVALID_PROPOSAL, "A finding needs citations unless it is classified as insufficient evidence.");
  }

  const citations = Array.from(input.citations, createEvidenceCitation);
  return Object.freeze({
    id: input.id,
    classification: input.classification,
    title: input.title,
    description: input.description,
    citations: Object.freeze(citations),
    status: "proposed",
    proposedAt: input.proposedAt,
  });
}

/** Record an explicit decision by a named human reviewer. */
export function decideFindingProposal(
  proposal: FindingProposal,
  decision: HumanDecision,
  reviewerId: string,
  decidedAt: string,
): FindingProposal {
  if (!isValidProposal(proposal)) {
    throw new ReviewDomainError(ReviewErrorCode.INVALID_PROPOSAL, "Finding proposal state is invalid.");
  }
  if (proposal.status !== "proposed") {
    throw new ReviewDomainError(ReviewErrorCode.INVALID_LIFECYCLE_TRANSITION, "Only proposed findings can receive a human decision.");
  }
  if ((decision !== "approve" && decision !== "reject") || !isIdentifier(reviewerId) ||
    !isCanonicalUtcTimestamp(decidedAt) || Date.parse(decidedAt) < Date.parse(proposal.proposedAt)) {
    throw new ReviewDomainError(ReviewErrorCode.INVALID_DECISION, "Decision requires approve/reject, a reviewer identifier, and a valid timestamp.");
  }
  const decided = Object.freeze({
    ...proposal,
    citations: snapshotCitations(proposal.citations),
    status: decision === "approve" ? "approved" : "rejected",
    reviewerId,
    decidedAt,
  });
  if (decision === "approve") {
    explicitlyApproved.add(decided);
  }
  return decided;
}

/** Publication is only reachable from an approved proposal with an explicit reviewer decision. */
export function publishFindingProposal(proposal: FindingProposal, publishedAt: string): FindingProposal {
  if (!isValidProposal(proposal)) {
    throw new ReviewDomainError(ReviewErrorCode.INVALID_PROPOSAL, "Finding proposal state is invalid.");
  }
  if (proposal.status !== "approved" || !proposal.reviewerId || !proposal.decidedAt || !explicitlyApproved.has(proposal)) {
    throw new ReviewDomainError(ReviewErrorCode.APPROVAL_REQUIRED, "A recorded human approval is required before publication.");
  }
  if (!isCanonicalUtcTimestamp(publishedAt) || Date.parse(publishedAt) < Date.parse(proposal.decidedAt)) {
    throw new ReviewDomainError(ReviewErrorCode.INVALID_PROPOSAL, "Publication timestamp must be canonical UTC and not precede approval.");
  }
  return Object.freeze({
    ...proposal,
    citations: snapshotCitations(proposal.citations),
    status: "published",
    publishedAt,
  });
}

function snapshotCitations(citations: readonly EvidenceCitation[]): readonly EvidenceCitation[] {
  return Object.freeze(Array.from(citations, createEvidenceCitation));
}

function isValidProposal(proposal: FindingProposal): boolean {
  if (proposal === null || proposal === undefined || typeof proposal !== "object" || !isIdentifier(proposal.id) ||
    !isClassification(proposal.classification) || !isText(proposal.title) || !isText(proposal.description) ||
    !isCanonicalUtcTimestamp(proposal.proposedAt) || !Array.isArray(proposal.citations) ||
    (proposal.citations.length === 0 && proposal.classification !== "insufficient_evidence")) {
    return false;
  }
  try {
    for (const citation of proposal.citations) {
      createEvidenceCitation(citation);
    }
  } catch {
    return false;
  }

  if (proposal.status === "proposed") {
    return proposal.reviewerId === undefined && proposal.decidedAt === undefined && proposal.publishedAt === undefined;
  }
  if (proposal.status === "approved" || proposal.status === "rejected") {
    return isIdentifier(proposal.reviewerId) && isCanonicalUtcTimestamp(proposal.decidedAt) &&
      Date.parse(proposal.decidedAt) >= Date.parse(proposal.proposedAt) && proposal.publishedAt === undefined;
  }
  if (proposal.status === "published") {
    return isIdentifier(proposal.reviewerId) && isCanonicalUtcTimestamp(proposal.decidedAt) &&
      Date.parse(proposal.decidedAt) >= Date.parse(proposal.proposedAt) &&
      isCanonicalUtcTimestamp(proposal.publishedAt) && Date.parse(proposal.publishedAt) >= Date.parse(proposal.decidedAt);
  }
  return false;
}

function isClassification(value: unknown): value is FindingClassification {
  return value === "fact" || value === "inference" || value === "assumption" || value === "insufficient_evidence";
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !hasDisallowedControl(value, 0x00, 0x1f);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    !hasDisallowedControl(value, 0x00, 0x08, 0x0b, 0x0c, 0x0e, 0x1f);
}

function hasDisallowedControl(value: string, ...ranges: number[]): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x7f) {
      return true;
    }
    for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex += 2) {
      if (code >= ranges[rangeIndex] && code <= ranges[rangeIndex + 1]) {
        return true;
      }
    }
  }
  return false;
}

function isCanonicalUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
