import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { SessionRepository } from '../../modules/identity/application/session-repository.port.js';
import type { UserId } from '../../modules/identity/domain/user.js';
import { POSTGRES_POOL } from './postgres.tokens.js';

const expiredSessionCleanupBatchSize = 100;

@Injectable()
export class PostgresSessionRepository implements SessionRepository {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async create(userId: UserId, tokenDigest: string, expiresAt: Date): Promise<void> {
    await this.pool.query(
      `WITH expired_sessions AS (
         SELECT token_digest
         FROM sessions
         WHERE expires_at <= now()
         ORDER BY expires_at, token_digest
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       DELETE FROM sessions AS session
       USING expired_sessions
       WHERE session.token_digest = expired_sessions.token_digest`,
      [expiredSessionCleanupBatchSize],
    );
    await this.pool.query(
      'INSERT INTO sessions (token_digest, user_id, expires_at) VALUES ($1, $2, $3)',
      [tokenDigest, userId, expiresAt],
    );
  }

  async findActiveUser(tokenDigest: string, at: Date): Promise<UserId | undefined> {
    const result = await this.pool.query<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_digest = $1 AND expires_at > $2',
      [tokenDigest, at],
    );
    return result.rows[0]?.user_id as UserId | undefined;
  }

  async revoke(tokenDigest: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE token_digest = $1', [tokenDigest]);
  }
}
