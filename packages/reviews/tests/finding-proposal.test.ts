import { describe, expect, test } from "bun:test";
import {
  createFindingProposal,
  decideFindingProposal,
  publishFindingProposal,
  ReviewDomainError,
  ReviewErrorCode,
} from "../index.js";
import type { EvidenceCitation, FindingClassification, FindingProposal } from "../index.js";

const timestamp = "2026-09-25T12:00:00.000Z";
const digest = "b".repeat(64);

describe("finding proposals", () => {
  test.each<FindingClassification>(["fact", "inference", "assumption", "insufficient_evidence"])(
    "accepts the PRD classification %s",
    (classification) => {
      const citations = classification === "insufficient_evidence" ? [] : [validCitation()];
      expect(createFindingProposal({ ...proposalInput(), classification, citations }).classification).toBe(classification);
    },
  );

  test("requires citations for claims but permits an evidence-gap proposal without them", () => {
    expectReviewError(
      () => createFindingProposal({ ...proposalInput(), citations: [] }),
      ReviewErrorCode.INVALID_PROPOSAL,
    );
    expect(createFindingProposal({
      ...proposalInput(),
      classification: "insufficient_evidence",
      citations: [],
    }).citations).toEqual([]);
  });

  test.each([
    ["unknown classification", { classification: "opinion" }],
    ["empty identifier", { id: "  " }],
    ["control character identifier", { id: "review\u0000id" }],
    ["empty title", { title: " \t\n " }],
    ["control character description", { description: "unsafe\u0001text" }],
    ["noncanonical timestamp", { proposedAt: "2026-09-25T12:00:00Z" }],
    ["impossible calendar date", { proposedAt: "2026-02-30T12:00:00.000Z" }],
  ] as const)("rejects %s", (_label, overrides) => {
    expectReviewError(
      () => createFindingProposal({ ...proposalInput(), ...overrides } as never),
      ReviewErrorCode.INVALID_PROPOSAL,
    );
  });

  test("freezes the proposal, citation list, and citation records", () => {
    const proposal = createFindingProposal(proposalInput());

    expect(Object.isFrozen(proposal)).toBe(true);
    expect(Object.isFrozen(proposal.citations)).toBe(true);
    expect(Object.isFrozen(proposal.citations[0])).toBe(true);
  });

  test("rejects publication before approval and rejects structurally forged approval", () => {
    const proposal = createFindingProposal(proposalInput());
    expectReviewError(
      () => publishFindingProposal(proposal, timestamp),
      ReviewErrorCode.APPROVAL_REQUIRED,
    );

    const forged = {
      ...proposal,
      status: "approved",
      reviewerId: "reviewer-1",
      decidedAt: timestamp,
    } as unknown as FindingProposal;
    expectReviewError(
      () => publishFindingProposal(forged, timestamp),
      ReviewErrorCode.APPROVAL_REQUIRED,
    );
  });

  test("publishes only after an explicit approval and keeps each transition immutable", () => {
    const proposed = createFindingProposal(proposalInput());
    const approved = decideFindingProposal(proposed, "approve", "reviewer-1", timestamp);
    const published = publishFindingProposal(approved, "2026-09-25T12:05:00.000Z");

    expect(approved.status).toBe("approved");
    expect(approved.reviewerId).toBe("reviewer-1");
    expect(published.status).toBe("published");
    expect(published.publishedAt).toBe("2026-09-25T12:05:00.000Z");
    expect(proposed.status).toBe("proposed");
    expect(Object.isFrozen(approved.citations)).toBe(true);
    expect(Object.isFrozen(approved.citations[0])).toBe(true);
    expect(Object.isFrozen(published.citations)).toBe(true);
    expect(Object.isFrozen(published.citations[0])).toBe(true);
  });

  test("re-snapshots citations from structurally supplied proposals during decision", () => {
    const mutableCitation = {
      path: "src/architecture.md",
      startLine: 1,
      endLine: 3,
      sha256: digest,
    };
    const structurallySupplied = {
      ...proposalInput(),
      status: "proposed",
      citations: [mutableCitation],
    } as unknown as FindingProposal;

    const approved = decideFindingProposal(structurallySupplied, "approve", "reviewer-1", timestamp);
    mutableCitation.path = "../../secret";

    expect(approved.citations[0]?.path).toBe("src/architecture.md");
    expect(Object.isFrozen(approved.citations)).toBe(true);
    expect(Object.isFrozen(approved.citations[0])).toBe(true);
  });

  test("reject decisions are terminal and cannot publish", () => {
    const proposed = createFindingProposal(proposalInput());
    const rejected = decideFindingProposal(proposed, "reject", "reviewer-2", timestamp);

    expect(rejected.status).toBe("rejected");
    expectReviewError(
      () => publishFindingProposal(rejected, timestamp),
      ReviewErrorCode.APPROVAL_REQUIRED,
    );
    expectReviewError(
      () => decideFindingProposal(rejected, "approve", "reviewer-1", timestamp),
      ReviewErrorCode.INVALID_LIFECYCLE_TRANSITION,
    );
  });

  test("prevents repeat decisions, repeat publication, and time reversal", () => {
    const proposed = createFindingProposal(proposalInput());
    const approved = decideFindingProposal(proposed, "approve", "reviewer-1", timestamp);
    const published = publishFindingProposal(approved, "2026-09-25T12:05:00.000Z");

    expectReviewError(
      () => decideFindingProposal(approved, "reject", "reviewer-2", timestamp),
      ReviewErrorCode.INVALID_LIFECYCLE_TRANSITION,
    );
    expectReviewError(
      () => publishFindingProposal(published, "2026-09-25T12:06:00.000Z"),
      ReviewErrorCode.APPROVAL_REQUIRED,
    );
    expectReviewError(
      () => decideFindingProposal(proposed, "approve", "reviewer-1", "2026-09-25T11:59:59.999Z"),
      ReviewErrorCode.INVALID_DECISION,
    );
    expectReviewError(
      () => publishFindingProposal(approved, "2026-09-25T11:59:59.999Z"),
      ReviewErrorCode.INVALID_PROPOSAL,
    );
  });

  test("requires a valid reviewer identifier and canonical decision time", () => {
    const proposal = createFindingProposal(proposalInput());
    expectReviewError(
      () => decideFindingProposal(proposal, "approve", "\u0000", timestamp),
      ReviewErrorCode.INVALID_DECISION,
    );
    expectReviewError(
      () => decideFindingProposal(proposal, "approve", "reviewer-1", "2026-09-25T12:00:00Z"),
      ReviewErrorCode.INVALID_DECISION,
    );
    expectReviewError(
      () => decideFindingProposal(proposal, "maybe" as never, "reviewer-1", timestamp),
      ReviewErrorCode.INVALID_DECISION,
    );
  });

  test("does not preserve approval provenance across serialization or object copying", () => {
    const approved = decideFindingProposal(createFindingProposal(proposalInput()), "approve", "reviewer-1", timestamp);
    const serialized = JSON.parse(JSON.stringify(approved)) as FindingProposal;
    const copied = { ...approved };

    expectReviewError(
      () => publishFindingProposal(serialized, timestamp),
      ReviewErrorCode.APPROVAL_REQUIRED,
    );
    expectReviewError(
      () => publishFindingProposal(copied, timestamp),
      ReviewErrorCode.APPROVAL_REQUIRED,
    );
  });
});

function proposalInput() {
  return {
    id: "finding-1",
    classification: "fact" as const,
    title: "Database migrations are versioned",
    description: "The repository contains a numbered PostgreSQL migration.",
    citations: [validCitation()],
    proposedAt: timestamp,
  };
}

function validCitation(): EvidenceCitation {
  return {
    path: "apps/api/migrations/001.sql",
    startLine: 1,
    endLine: 4,
    sha256: digest,
  } as EvidenceCitation;
}

function expectReviewError(action: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ReviewDomainError);
  expect((thrown as ReviewDomainError).code).toBe(code);
}
