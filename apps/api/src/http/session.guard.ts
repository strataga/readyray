import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { ResolveSession } from '../modules/identity/application/resolve-session.use-case.js';
import { IdentityUseCaseError } from '../modules/identity/application/identity-errors.js';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(ResolveSession) private readonly resolveSession: ResolveSession) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { userId?: string }>();
    const authorization = request.header('authorization');
    const token = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!token) {
      throw new IdentityUseCaseError('unauthorized');
    }
    const userId = await this.resolveSession.execute(token);
    if (!userId) {
      throw new IdentityUseCaseError('unauthorized');
    }
    request.userId = userId;
    return true;
  }
}
