import { Inject, Injectable } from '@nestjs/common';
import { SESSION_TOKENS } from './security.port.js';
import type { SessionTokens } from './security.port.js';
import { SESSION_REPOSITORY } from './session-repository.port.js';
import type { SessionRepository } from './session-repository.port.js';
import type { UserId } from '../domain/user.js';

@Injectable()
export class ResolveSession {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(SESSION_TOKENS) private readonly tokens: SessionTokens,
  ) {}

  execute(token: string): Promise<UserId | undefined> {
    return this.sessions.findActiveUser(this.tokens.digest(token), new Date());
  }
}
