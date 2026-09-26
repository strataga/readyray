import { Inject, Injectable } from '@nestjs/common';
import { IdentityUseCaseError } from './identity-errors.js';
import { PASSWORD_HASHER, SESSION_TOKENS } from './security.port.js';
import type { PasswordHasher, SessionTokens } from './security.port.js';
import { SESSION_REPOSITORY } from './session-repository.port.js';
import type { SessionRepository } from './session-repository.port.js';
import { USER_REPOSITORY } from './user-repository.port.js';
import type { UserRepository } from './user-repository.port.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class CreateSession {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
    @Inject(SESSION_TOKENS) private readonly tokens: SessionTokens,
  ) {}

  async execute(email: string, password: string) {
    const user = await this.users.findByEmail(email.trim().toLowerCase());
    if (!user) {
      await this.passwords.verifyDummy(password);
      throw new IdentityUseCaseError('invalid_credentials');
    }
    if (!(await this.passwords.verify(password, user.passwordHash))) {
      throw new IdentityUseCaseError('invalid_credentials');
    }
    const issued = this.tokens.issue();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.sessions.create(user.id, issued.digest, expiresAt);
    return { token: issued.token, expiresAt };
  }
}
