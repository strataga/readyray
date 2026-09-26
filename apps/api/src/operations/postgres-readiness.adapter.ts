import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import type { Pool } from 'pg';
import type { ReadinessProbe } from './readiness.port.js';
import { POSTGRES_POOL } from '../persistence/postgres/postgres.tokens.js';

@Injectable()
export class PostgresReadinessProbe implements ReadinessProbe, OnModuleDestroy {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async check(): Promise<void> {
    const result = await this.pool.query<{ ready: number }>(
      'SELECT 1 AS ready FROM schema_migrations WHERE version = $1 LIMIT 1',
      ['001_identity_workspaces'],
    );
    if (result.rows.length !== 1) {
      throw new Error('Required schema migration is not applied');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}
