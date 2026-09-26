import { createHmac, randomBytes } from 'node:crypto';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { normalizeEmail } from '../modules/identity/domain/user.js';

const WINDOW_MS = 15 * 60 * 1000;
const SWEEP_INTERVAL_MS = 30 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 10;
const MAX_TRACKED_KEYS_PER_DIMENSION = 10_000;
const RATE_LIMIT_SECRET = randomBytes(32);

interface AttemptWindow {
  attempts: number;
  expiresAt: number;
}

type WindowCheck =
  | { readonly allowed: true; readonly track: boolean; readonly window?: AttemptWindow }
  | { readonly allowed: false; readonly retryAfterMs: number };

type SaturationPolicy = 'reject' | 'allow-untracked';

class BoundedAttemptWindows {
  private readonly windows = new Map<string, AttemptWindow>();
  private nextSweepAt = 0;
  private saturatedUntil?: number;

  constructor(private readonly saturationPolicy: SaturationPolicy) {}

  check(key: string, now: number): WindowCheck {
    let window = this.windows.get(key);
    if (window && window.expiresAt <= now) {
      this.windows.delete(key);
      window = undefined;
    }

    if (window) {
      return window.attempts >= MAX_ATTEMPTS_PER_WINDOW
        ? { allowed: false, retryAfterMs: window.expiresAt - now }
        : { allowed: true, track: true, window };
    }

    this.sweepExpired(now);
    if (this.windows.size >= MAX_TRACKED_KEYS_PER_DIMENSION) {
      this.saturatedUntil ??= this.findSaturationExpiry(now);
      if (this.saturationPolicy === 'allow-untracked') {
        return { allowed: true, track: false };
      }
      return { allowed: false, retryAfterMs: this.saturatedUntil - now };
    }

    return { allowed: true, track: true };
  }

  consume(key: string, check: WindowCheck, now: number): void {
    if (!check.allowed || !check.track) {
      return;
    }
    const window = check.window ?? { attempts: 0, expiresAt: now + WINDOW_MS };
    window.attempts += 1;
    this.windows.set(key, window);
  }

  private sweepExpired(now: number): void {
    if (now < this.nextSweepAt) {
      return;
    }
    this.nextSweepAt = now + SWEEP_INTERVAL_MS;
    this.saturatedUntil = undefined;
    for (const [key, window] of this.windows) {
      if (window.expiresAt <= now) {
        this.windows.delete(key);
      }
    }
  }

  private findSaturationExpiry(now: number): number {
    let earliestExpiry = Number.POSITIVE_INFINITY;
    for (const window of this.windows.values()) {
      earliestExpiry = Math.min(earliestExpiry, window.expiresAt);
    }
    return Math.max(earliestExpiry, this.nextSweepAt, now + 1);
  }
}

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private readonly sourceWindows = new BoundedAttemptWindows('reject');
  private readonly accountWindows = new BoundedAttemptWindows('allow-untracked');

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const now = Date.now();
    const sourceKey = hmacKey('source', request.ip ?? 'unknown');
    const sourceCheck = this.sourceWindows.check(sourceKey, now);
    const account = normalizedRequestEmail(request.body);
    const accountKey = account === undefined ? undefined : hmacKey('account', account);
    const accountCheck = accountKey === undefined
      ? undefined
      : this.accountWindows.check(accountKey, now);
    const blockedFor = [sourceCheck, accountCheck]
      .filter((check): check is Extract<WindowCheck, { readonly allowed: false }> =>
        check !== undefined && !check.allowed)
      .map((check) => check.retryAfterMs);

    if (blockedFor.length > 0) {
      const retryAfterSeconds = Math.max(1, Math.ceil(Math.max(...blockedFor) / 1000));
      response.setHeader('retry-after', String(retryAfterSeconds));
      throw new HttpException('Login rate limit exceeded.', HttpStatus.TOO_MANY_REQUESTS);
    }

    this.sourceWindows.consume(sourceKey, sourceCheck, now);
    if (accountKey !== undefined && accountCheck !== undefined) {
      this.accountWindows.consume(accountKey, accountCheck, now);
    }
    return true;
  }
}

function normalizedRequestEmail(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('email' in body) ||
      typeof body.email !== 'string' || body.email.length > 254) {
    return undefined;
  }
  try {
    return normalizeEmail(body.email);
  } catch {
    return undefined;
  }
}

function hmacKey(dimension: 'source' | 'account', value: string): string {
  return createHmac('sha256', RATE_LIMIT_SECRET)
    .update(`${dimension}\0${value}`)
    .digest('hex');
}
