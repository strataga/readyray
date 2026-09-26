import type { Request } from 'express';
import type { UserId } from '../modules/identity/domain/user.js';

export type AuthenticatedRequest = Request & { userId: UserId };
