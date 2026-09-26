import { EventEmitter } from 'node:events';
import { strict as assert } from 'node:assert';
import { test } from 'bun:test';
import type { Request, Response } from 'express';
import { evidenceUploadPreauth } from '../dist/http/evidence-upload-preauth.middleware.js';

test('evidence upload admission limits buffered requests and releases on response finish', async () => {
  const middleware = evidenceUploadPreauth(
    { async execute() { return 'actor-1'; } } as never,
    { async canIngestEvidence() { return true; } },
  );
  const first = fakeResponse();
  let firstAdmitted = false;
  await middleware(fakeRequest(), first.response, () => { firstAdmitted = true; });
  assert.equal(firstAdmitted, true);

  const second = fakeResponse();
  let secondAdmitted = false;
  await middleware(fakeRequest(), second.response, () => { secondAdmitted = true; });
  assert.equal(secondAdmitted, false);
  assert.equal(second.status, 429);
  assert.equal(second.headers['Retry-After'], '1');
  assert.equal((second.body as { code: string }).code, 'upload_busy');

  first.events.emit('finish');
  first.events.emit('close');
  const third = fakeResponse();
  let thirdAdmitted = false;
  await middleware(fakeRequest(), third.response, () => { thirdAdmitted = true; });
  assert.equal(thirdAdmitted, true);
  third.events.emit('finish');
});

function fakeRequest(): Request {
  return {
    method: 'POST',
    originalUrl: '/v1/workspaces/workspace-1/evidence/archives',
    path: '/',
    params: { workspaceId: 'workspace-1' },
    header(name: string) { return name === 'authorization' ? `Bearer ${'A'.repeat(43)}` : undefined; },
  } as unknown as Request;
}

function fakeResponse(): {
  response: Response;
  events: EventEmitter;
  status: number;
  headers: Record<string, string>;
  body: unknown;
} {
  const state = { status: 0, headers: {} as Record<string, string>, body: undefined as unknown };
  const events = new EventEmitter();
  const response = Object.assign(events, {
    setHeader(name: string, value: string) { state.headers[name] = value; return this; },
    getHeader() { return 'request-id'; },
    status(value: number) { state.status = value; return this; },
    type() { return this; },
    json(value: unknown) { state.body = value; return this; },
  }) as unknown as Response;
  return {
    response,
    events,
    get status() { return state.status; },
    headers: state.headers,
    get body() { return state.body; },
  };
}
