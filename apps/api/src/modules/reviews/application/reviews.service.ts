import { randomUUID } from 'node:crypto';
import { createFindingProposal, decideFindingProposal, publishFindingProposal } from '@archgauge/reviews';
import type { FindingProposal, HumanDecision } from '@archgauge/reviews';
import { getEvidenceArchiveInventory } from '@archgauge/evidence/application';
import type { EvidenceArchiveInventoryReadPort, WorkspaceEvidenceAuthorizationPort } from '@archgauge/evidence/application';
import type { AddFindingInput, ReviewRecord, ReviewRepository } from './reviews.port.js';

export class ReviewsApplicationError extends Error {
  constructor(readonly code: 'invalid_input' | 'forbidden' | 'not_found' | 'conflict' | 'unavailable') {
    super(`Review operation failed (${code}).`);
    this.name = 'ReviewsApplicationError';
  }
}

export class ReviewsService {
  constructor(
    private readonly repository: ReviewRepository,
    private readonly authorization: WorkspaceEvidenceAuthorizationPort,
    private readonly inventory: EvidenceArchiveInventoryReadPort,
  ) {}

  async create(actorId: string, workspaceId: string, intakeId: string, sourceCommitSha?: string): Promise<ReviewRecord> {
    await this.authorize(actorId, workspaceId);
    if (sourceCommitSha !== undefined && !/^[a-fA-F0-9]{40}$/u.test(sourceCommitSha)) {throw new ReviewsApplicationError('invalid_input');}
    const accepted = await this.acceptedIntake(actorId, workspaceId, intakeId);
    return this.run(() => this.repository.create({
      id: randomUUID(), workspaceId, evidenceIntakeId: accepted.intake.id, ...(sourceCommitSha ? { sourceCommitSha: sourceCommitSha.toLowerCase() } : {}), createdBy: actorId,
      createdAt: new Date().toISOString(), status: 'draft', version: 0,
    }));
  }

  async list(actorId: string, workspaceId: string): Promise<readonly ReviewRecord[]> {
    await this.authorize(actorId, workspaceId);
    return this.run(() => this.repository.list(workspaceId));
  }

  async get(actorId: string, workspaceId: string, reviewId: string): Promise<ReviewRecord> {
    await this.authorize(actorId, workspaceId);
    return this.find(workspaceId, reviewId);
  }

  async addFinding(actorId: string, workspaceId: string, reviewId: string, input: AddFindingInput): Promise<ReviewRecord> {
    await this.authorize(actorId, workspaceId);
    const review = await this.find(workspaceId, reviewId);
    if (review.status !== 'draft') {throw new ReviewsApplicationError('conflict');}
    const accepted = await this.acceptedIntake(actorId, workspaceId, review.evidenceIntakeId);
    if (!Array.isArray(input?.citations) || input.citations.length === 0) {throw new ReviewsApplicationError('invalid_input');}
    let finding: FindingProposal;
    try {
      finding = createFindingProposal({ ...input, id: randomUUID(), proposedAt: new Date().toISOString() });
    } catch {
      throw new ReviewsApplicationError('invalid_input');
    }
    const digests = new Map<string, string>(accepted.digests.map((digest) => [digest.path, digest.hexDigest.toLowerCase()]));
    if (finding.citations.some((citation, index) => citation.path !== input.citations[index]?.path || digests.get(citation.path) !== citation.sha256)) {throw new ReviewsApplicationError('invalid_input');}
    const result = await this.run(() => this.repository.addFinding(workspaceId, reviewId, review.version, finding));
    if (!result) {throw new ReviewsApplicationError('conflict');}
    return result;
  }

  async decide(actorId: string, workspaceId: string, reviewId: string, findingId: string, decision: HumanDecision): Promise<ReviewRecord> {
    await this.authorize(actorId, workspaceId);
    const review = await this.find(workspaceId, reviewId);
    if (review.status !== 'draft') {throw new ReviewsApplicationError('conflict');}
    const prior = review.findings.find((finding) => finding.id === findingId);
    if (!prior) {throw new ReviewsApplicationError('not_found');}
    let finding: FindingProposal;
    try { finding = decideFindingProposal(prior, decision, actorId, new Date().toISOString()); }
    catch { throw new ReviewsApplicationError('conflict'); }
    const result = await this.run(() => this.repository.decideFinding(workspaceId, reviewId, review.version, findingId, finding));
    if (!result) {throw new ReviewsApplicationError('conflict');}
    return result;
  }

  async publish(actorId: string, workspaceId: string, reviewId: string): Promise<ReviewRecord> {
    await this.authorize(actorId, workspaceId);
    const review = await this.find(workspaceId, reviewId);
    if (review.status !== 'draft' || review.findings.length === 0 || review.findings.some((finding) => finding.status === 'proposed') || !review.findings.some((finding) => finding.status === 'approved')) {
      throw new ReviewsApplicationError('conflict');
    }
    const publishedAt = new Date().toISOString();
    const findings = review.findings.map((finding) => {
      if (finding.status === 'rejected') {return finding;}
      try {
        // Database hydration is plain data; recreate explicit decision provenance only from the stored human decision fields.
        const proposed = createFindingProposal({ ...finding, proposedAt: finding.proposedAt });
        const approved = decideFindingProposal(proposed, 'approve', finding.reviewerId!, finding.decidedAt!);
        return publishFindingProposal(approved, publishedAt);
      }
      catch { throw new ReviewsApplicationError('conflict'); }
    });
    const result = await this.run(() => this.repository.publish(workspaceId, reviewId, review.version, findings, publishedAt));
    if (!result) {throw new ReviewsApplicationError('conflict');}
    return result;
  }

  private async find(workspaceId: string, reviewId: string): Promise<ReviewRecord> {
    if (!isUuid(reviewId)) {throw new ReviewsApplicationError('invalid_input');}
    const record = await this.run(() => this.repository.find(workspaceId, reviewId));
    if (!record) {throw new ReviewsApplicationError('not_found');}
    return record;
  }
  private async acceptedIntake(actorId: string, workspaceId: string, intakeId: string) {
    try { return await getEvidenceArchiveInventory({ actorId, workspaceId, intakeId }, this.authorization, this.inventory); }
    catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'workspace_forbidden') {throw new ReviewsApplicationError('forbidden');}
      if (code === 'invalid_input') {throw new ReviewsApplicationError('invalid_input');}
      if (code === 'not_found') {throw new ReviewsApplicationError('not_found');}
      throw new ReviewsApplicationError('unavailable');
    }
  }
  private async authorize(actorId: string, workspaceId: string): Promise<void> {
    if (!isUuid(workspaceId)) {throw new ReviewsApplicationError('invalid_input');}
    try { if (!(await this.authorization.canIngestEvidence({ actorId, workspaceId }))) {throw new ReviewsApplicationError('forbidden');} }
    catch (error) { if (error instanceof ReviewsApplicationError) {throw error;} throw new ReviewsApplicationError('unavailable'); }
  }
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error) { if (error instanceof ReviewsApplicationError) {throw error;} throw new ReviewsApplicationError('unavailable'); }
  }
}

function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value); }
