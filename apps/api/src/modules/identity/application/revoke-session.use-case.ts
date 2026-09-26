import { Inject, Injectable } from '@nestjs/common';
import { SESSION_REPOSITORY } from './session-repository.port.js';
import type { SessionRepository } from './session-repository.port.js';
import { SESSION_TOKENS } from './security.port.js';
import type { SessionTokens } from './security.port.js';

/** Revokes a presented session without persisting or logging its raw token. */
@Injectable()
export class RevokeSession {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(SESSION_TOKENS) private readonly tokens: SessionTokens,
  ) {}

  execute(token: string): Promise<void> {
    return this.sessions.revoke(this.tokens.digest(token));
  }
}
