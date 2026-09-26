import type { UserId } from '../domain/user.js';

export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');

export interface SessionRepository {
  create(userId: UserId, tokenDigest: string, expiresAt: Date): Promise<void>;
  findActiveUser(tokenDigest: string, at: Date): Promise<UserId | undefined>;
  revoke(tokenDigest: string): Promise<void>;
}
