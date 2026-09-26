import type { User, UserId } from '../domain/user.js';

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface UserRepository {
  create(email: string, passwordHash: string): Promise<User>;
  findByEmail(email: string): Promise<(User & { readonly passwordHash: string }) | undefined>;
  findById(id: UserId): Promise<User | undefined>;
}
