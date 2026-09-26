import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { User, UserId } from '../../modules/identity/domain/user.js';
import type { UserRepository } from '../../modules/identity/application/user-repository.port.js';
import { POSTGRES_POOL } from './postgres.tokens.js';

interface UserRow { id: string; email: string; password_hash?: string; created_at: Date; }

@Injectable()
export class PostgresUserRepository implements UserRepository {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async create(email: string, passwordHash: string): Promise<User> {
    const result = await this.pool.query<UserRow>(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at',
      [email, passwordHash],
    );
    return mapUser(result.rows[0]!);
  }

  async findByEmail(email: string): Promise<(User & { readonly passwordHash: string }) | undefined> {
    const result = await this.pool.query<UserRow>(
      'SELECT id, email, password_hash, created_at FROM users WHERE email = $1', [email],
    );
    const row = result.rows[0];
    return row?.password_hash ? { ...mapUser(row), passwordHash: row.password_hash } : undefined;
  }

  async findById(id: UserId): Promise<User | undefined> {
    const result = await this.pool.query<UserRow>(
      'SELECT id, email, created_at FROM users WHERE id = $1', [id],
    );
    const row = result.rows[0];
    return row ? mapUser(row) : undefined;
  }
}

function mapUser(row: UserRow): User {
  return { id: row.id as UserId, email: row.email, createdAt: row.created_at };
}
