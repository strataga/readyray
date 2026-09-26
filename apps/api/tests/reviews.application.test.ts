import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'bun:test';
import type { AcceptedEvidenceArchiveIntake } from '@archgauge/evidence/application';
import { ReviewsApplicationError, ReviewsService } from '../src/modules/reviews/application/reviews.service.js';
import type { ReviewRecord, ReviewRepository } from '../src/modules/reviews/application/reviews.port.js';

describe('ReviewsService', () => {
  it('requires accepted, matching citation digests and an explicit decision before persisted publication', async () => {
    const workspaceId = randomUUID();
    const intakeId = randomUUID();
    const digest = 'b'.repeat(64);
    const archive: AcceptedEvidenceArchiveIntake = {
      status: 'accepted', workspaceId, archiveSha256: 'a'.repeat(64),
      intake: { id: intakeId, status: 'accepted', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z' },
      manifest: { entries: [{ path: 'README.md' as never, byteSize: 12 }], totalBytes: 12 },
      digests: [{ path: 'README.md' as never, algorithm: 'sha256', hexDigest: digest, byteSize: 12 }],
    };
    const records = new Map<string, ReviewRecord>();
    const repository: ReviewRepository = {
      async create(input) { const review = { ...input, findings: [] }; records.set(review.id, review); return review; },
      async list(id) { return [...records.values()].filter((review) => review.workspaceId === id); },
      async find(workspace, id) { const review = records.get(id); return review?.workspaceId === workspace ? review : undefined; },
      async addFinding(_workspace, id, version, finding) { const review = records.get(id); if (!review || review.version !== version) {return undefined;} const updated = { ...review, version: version + 1, findings: [...review.findings, finding] }; records.set(id, updated); return updated; },
      async decideFinding(_workspace, id, version, findingId, finding) { const review = records.get(id); if (!review || review.version !== version) {return undefined;} const updated = { ...review, version: version + 1, findings: review.findings.map((item) => item.id === findingId ? finding : item) }; records.set(id, updated); return updated; },
      async publish(_workspace, id, version, findings, publishedAt) { const review = records.get(id); if (!review || review.version !== version) {return undefined;} const updated = { ...review, version: version + 1, status: 'published' as const, publishedAt, findings }; records.set(id, updated); return updated; },
    };
    const service = new ReviewsService(repository, { async canIngestEvidence(input) { return input.workspaceId === workspaceId; } }, { async findAcceptedArchive(input) { return input.intakeId === intakeId ? archive : undefined; } });
    const review = await service.create(randomUUID(), workspaceId, intakeId);
    await assert.rejects(service.addFinding(randomUUID(), workspaceId, review.id, {
      classification: 'fact', title: 'Finding', description: 'Observed evidence',
      citations: [{ path: 'README.md', startLine: 1, endLine: 1, sha256: 'c'.repeat(64) }],
    }), ReviewsApplicationError);
    const proposed = await service.addFinding(randomUUID(), workspaceId, review.id, {
      classification: 'fact', title: 'Finding', description: 'Observed evidence',
      citations: [{ path: 'README.md', startLine: 1, endLine: 1, sha256: digest }],
    });
    await assert.rejects(service.publish(randomUUID(), workspaceId, review.id), ReviewsApplicationError);
    const findingId = proposed.findings[0]!.id;
    const approved = await service.decide(randomUUID(), workspaceId, review.id, findingId, 'approve');
    // Simulate a persisted reload, where the domain's in-memory provenance marker is absent.
    records.set(review.id, { ...approved, findings: approved.findings.map((finding) => ({ ...finding })) });
    const published = await service.publish(randomUUID(), workspaceId, review.id);
    assert.equal(published.status, 'published');
    assert.equal(published.findings[0]?.status, 'published');
  });

  it('retains an optional full source commit SHA and rejects malformed values', async () => {
    const workspaceId = randomUUID();
    const intakeId = randomUUID();
    const archive: AcceptedEvidenceArchiveIntake = {
      status: 'accepted', workspaceId, archiveSha256: 'a'.repeat(64),
      intake: { id: intakeId, status: 'accepted', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z' },
      manifest: { entries: [], totalBytes: 0 }, digests: [],
    };
    const records = new Map<string, ReviewRecord>();
    const repository = {
      async create(input: Omit<ReviewRecord, 'findings'>) { const item = { ...input, findings: [] }; records.set(item.id, item); return item; },
      async list() { return []; }, async find() { return undefined; }, async addFinding() { return undefined; }, async decideFinding() { return undefined; }, async publish() { return undefined; },
    } as unknown as ReviewRepository;
    const service = new ReviewsService(repository, { async canIngestEvidence() { return true; } }, { async findAcceptedArchive() { return archive; } });
    const created = await service.create(randomUUID(), workspaceId, intakeId, 'A'.repeat(40));
    assert.equal(created.sourceCommitSha, 'a'.repeat(40));
    await assert.rejects(service.create(randomUUID(), workspaceId, intakeId, 'bad'), ReviewsApplicationError);
  });
});
