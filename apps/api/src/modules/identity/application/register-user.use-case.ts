import { Inject, Injectable } from '@nestjs/common';
import { PASSWORD_HASHER } from './security.port.js';
import type { PasswordHasher } from './security.port.js';
import { USER_REPOSITORY } from './user-repository.port.js';
import type { UserRepository } from './user-repository.port.js';
import { normalizeEmail, validatePassword } from '../domain/user.js';
import { IdentityUseCaseError } from './identity-errors.js';

@Injectable()
export class RegisterUser {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
  ) {}

  async execute(email: string, password: string) {
    const normalizedEmail = normalizeEmail(email);
    validatePassword(password);
    const passwordHash = await this.passwords.hash(password);
    try {
      return await this.users.create(normalizedEmail, passwordHash);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new IdentityUseCaseError('email_conflict');
      }
      throw error;
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
