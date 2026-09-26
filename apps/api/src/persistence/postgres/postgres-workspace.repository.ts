import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { WorkspaceRepository } from '../../modules/workspaces/application/workspace-repository.port.js';
import type { UserId } from '../../modules/identity/domain/user.js';
import type { Workspace, WorkspaceId } from '../../modules/workspaces/domain/workspace.js';
import { POSTGRES_POOL } from './postgres.tokens.js';

interface WorkspaceRow { id: string; name: string; created_at: Date; }

@Injectable()
export class PostgresWorkspaceRepository implements WorkspaceRepository {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async createOwned(name: string, ownerId: UserId): Promise<Workspace> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<WorkspaceRow>(
        'INSERT INTO workspaces (name) VALUES ($1) RETURNING id, name, created_at', [name],
      );
      const row = result.rows[0]!;
      await client.query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
        [row.id, ownerId],
      );
      await client.query('COMMIT');
      return mapWorkspace(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findByIdForMember(id: WorkspaceId, memberId: UserId): Promise<Workspace | undefined> {
    const result = await this.pool.query<WorkspaceRow>(
      `SELECT w.id, w.name, w.created_at
       FROM workspaces w
       INNER JOIN workspace_memberships m ON m.workspace_id = w.id
       WHERE w.id = $1 AND m.user_id = $2`, [id, memberId],
    );
    const row = result.rows[0];
    return row ? mapWorkspace(row) : undefined;
  }

  async listForMember(memberId: UserId): Promise<readonly Workspace[]> {
    const result = await this.pool.query<WorkspaceRow>(
      `SELECT w.id, w.name, w.created_at
       FROM workspaces w
       INNER JOIN workspace_memberships m ON m.workspace_id = w.id
       WHERE m.user_id = $1
       ORDER BY w.created_at ASC, w.id ASC`, [memberId],
    );
    return result.rows.map(mapWorkspace);
  }

}

function mapWorkspace(row: WorkspaceRow): Workspace {
  return { id: row.id as WorkspaceId, name: row.name, createdAt: row.created_at };
}
