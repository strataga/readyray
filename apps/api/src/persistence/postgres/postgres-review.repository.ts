import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import type { FindingProposal, EvidenceCitation } from '@archgauge/reviews';
import type { ReviewRecord, ReviewRepository } from '../../modules/reviews/application/reviews.port.js';
import { POSTGRES_POOL } from './postgres.tokens.js';

interface ReviewRow { id: string; workspace_id: string; evidence_intake_id: string; source_commit_sha: string | null; created_by: string; created_at: Date; status: 'draft' | 'published'; published_at: Date | null; version: number; }
interface FindingRow { id: string; classification: FindingProposal['classification']; title: string; description: string; citations: EvidenceCitation[]; status: FindingProposal['status']; proposed_at: Date; reviewer_id: string | null; decided_at: Date | null; published_at: Date | null; }

@Injectable()
export class PostgresReviewRepository implements ReviewRepository {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async create(input: Omit<ReviewRecord, 'findings'>): Promise<ReviewRecord> {
    const result = await this.pool.query<ReviewRow>(`INSERT INTO reviews (id, workspace_id, evidence_intake_id, source_commit_sha, created_by, created_at, status, version)
      VALUES ($1,$2,$3,$4,$5,$6,'draft',0) RETURNING *`, [input.id, input.workspaceId, input.evidenceIntakeId, input.sourceCommitSha ?? null, input.createdBy, input.createdAt]);
    return mapReview(result.rows[0]!, []);
  }
  async list(workspaceId: string): Promise<readonly ReviewRecord[]> {
    const result = await this.pool.query<ReviewRow>(`SELECT * FROM reviews WHERE workspace_id=$1 ORDER BY created_at,id`, [workspaceId]);
    return Promise.all(result.rows.map(async (row) => mapReview(row, await this.findings(row.id))));
  }
  async find(workspaceId: string, reviewId: string): Promise<ReviewRecord | undefined> {
    const result = await this.pool.query<ReviewRow>('SELECT * FROM reviews WHERE workspace_id=$1 AND id=$2', [workspaceId, reviewId]);
    const row = result.rows[0];
    return row ? mapReview(row, await this.findings(row.id)) : undefined;
  }
  async addFinding(workspaceId: string, reviewId: string, expectedVersion: number, finding: FindingProposal): Promise<ReviewRecord | undefined> {
    return this.mutate(workspaceId, reviewId, expectedVersion, async (client) => {
      const count = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM review_findings WHERE review_id=$1', [reviewId]);
      await insertFinding(client, reviewId, Number(count.rows[0]!.count), finding);
    });
  }
  async decideFinding(workspaceId: string, reviewId: string, expectedVersion: number, findingId: string, finding: FindingProposal): Promise<ReviewRecord | undefined> {
    return this.mutate(workspaceId, reviewId, expectedVersion, async (client) => {
      const changed = await updateFinding(client, reviewId, findingId, finding);
      if (changed.rowCount !== 1) {throw new ConcurrentMutation();}
    });
  }
  async publish(workspaceId: string, reviewId: string, expectedVersion: number, findings: readonly FindingProposal[], publishedAt: string): Promise<ReviewRecord | undefined> {
    return this.mutate(workspaceId, reviewId, expectedVersion, async (client) => {
      for (const finding of findings) {await updateFinding(client, reviewId, finding.id, finding);}
      const changed = await client.query(`UPDATE reviews SET status='published',published_at=$4
        WHERE workspace_id=$1 AND id=$2 AND version=$3 AND status='draft'`, [workspaceId, reviewId, expectedVersion, publishedAt]);
      if (changed.rowCount !== 1) {throw new ConcurrentMutation();}
    });
  }

  private async findings(reviewId: string): Promise<readonly FindingProposal[]> {
    const result = await this.pool.query<FindingRow>('SELECT * FROM review_findings WHERE review_id=$1 ORDER BY ordinal', [reviewId]);
    return result.rows.map(mapFinding);
  }
  private async mutate(workspaceId: string, reviewId: string, expectedVersion: number, mutation: (client: PoolClient) => Promise<void>): Promise<ReviewRecord | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const lock = await client.query<ReviewRow>(`SELECT * FROM reviews WHERE workspace_id=$1 AND id=$2 AND status='draft' AND version=$3 FOR UPDATE`, [workspaceId, reviewId, expectedVersion]);
      if (!lock.rows[0]) { await client.query('ROLLBACK'); return undefined; }
      await mutation(client);
      const updated = await client.query<ReviewRow>('UPDATE reviews SET version=version+1 WHERE id=$1 RETURNING *', [reviewId]);
      await client.query('COMMIT');
      return mapReview(updated.rows[0]!, await this.findings(reviewId));
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof ConcurrentMutation) {return undefined;}
      throw error;
    } finally { client.release(); }
  }
}

async function insertFinding(client: PoolClient, reviewId: string, ordinal: number, finding: FindingProposal): Promise<void> {
  await client.query(`INSERT INTO review_findings (id,review_id,ordinal,classification,title,description,citations,status,proposed_at,reviewer_id,decided_at,published_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12)`, [finding.id,reviewId,ordinal,finding.classification,finding.title,finding.description,JSON.stringify(finding.citations),finding.status,finding.proposedAt,finding.reviewerId ?? null,finding.decidedAt ?? null,finding.publishedAt ?? null]);
}
async function updateFinding(client: PoolClient, reviewId: string, findingId: string, finding: FindingProposal) {
  return client.query(`UPDATE review_findings SET status=$3,reviewer_id=$4,decided_at=$5,published_at=$6
    WHERE review_id=$1 AND id=$2`, [reviewId,findingId,finding.status,finding.reviewerId ?? null,finding.decidedAt ?? null,finding.publishedAt ?? null]);
}
function mapReview(row: ReviewRow, findings: readonly FindingProposal[]): ReviewRecord {
  return Object.freeze({ id: row.id, workspaceId: row.workspace_id, evidenceIntakeId: row.evidence_intake_id, ...(row.source_commit_sha ? { sourceCommitSha: row.source_commit_sha.trim() } : {}), createdBy: row.created_by, createdAt: row.created_at.toISOString(), status: row.status, ...(row.published_at ? { publishedAt: row.published_at.toISOString() } : {}), version: row.version, findings: Object.freeze([...findings]) });
}
function mapFinding(row: FindingRow): FindingProposal {
  return Object.freeze({ id: row.id, classification: row.classification, title: row.title, description: row.description, citations: Object.freeze(row.citations.map((citation) => Object.freeze({ ...citation }))), status: row.status, proposedAt: row.proposed_at.toISOString(), ...(row.reviewer_id ? { reviewerId: row.reviewer_id } : {}), ...(row.decided_at ? { decidedAt: row.decided_at.toISOString() } : {}), ...(row.published_at ? { publishedAt: row.published_at.toISOString() } : {}) });
}
class ConcurrentMutation extends Error {}
