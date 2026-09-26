import type { FindingClassification, EvidenceCitationInput, FindingProposal } from '@archgauge/reviews';

export const REVIEW_REPOSITORY = Symbol('REVIEW_REPOSITORY');

export interface ReviewRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly evidenceIntakeId: string;
  readonly sourceCommitSha?: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly status: 'draft' | 'published';
  readonly publishedAt?: string;
  readonly version: number;
  readonly findings: readonly FindingProposal[];
}

export interface ReviewRepository {
  create(input: Omit<ReviewRecord, 'findings'>): Promise<ReviewRecord>;
  list(workspaceId: string): Promise<readonly ReviewRecord[]>;
  find(workspaceId: string, reviewId: string): Promise<ReviewRecord | undefined>;
  addFinding(workspaceId: string, reviewId: string, expectedVersion: number, finding: FindingProposal): Promise<ReviewRecord | undefined>;
  decideFinding(workspaceId: string, reviewId: string, expectedVersion: number, findingId: string, finding: FindingProposal): Promise<ReviewRecord | undefined>;
  publish(workspaceId: string, reviewId: string, expectedVersion: number, findings: readonly FindingProposal[], publishedAt: string): Promise<ReviewRecord | undefined>;
}

export interface AddFindingInput {
  readonly classification: FindingClassification;
  readonly title: string;
  readonly description: string;
  readonly citations: readonly EvidenceCitationInput[];
}
