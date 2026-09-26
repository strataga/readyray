import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function requestContextMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const requestId = randomUUID();
  response.setHeader('x-request-id', requestId);
  const path = request.path;
  const started = process.hrtime.bigint();
  response.once('finish', () => {
    process.stdout.write(`${JSON.stringify({
      level: 'info',
      event: 'http_request_complete',
      requestId,
      method: request.method,
      path,
      status: response.statusCode,
      durationMs: Number(process.hrtime.bigint() - started) / 1_000_000,
    })}\n`);
  });
  next();
}
