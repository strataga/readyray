import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { apiUrl, problem, readBoundedBody, requireSameOrigin, safeFetch, SESSION_COOKIE, upstreamProblem } from '@/lib/server-api';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }
  const body = await readBoundedBody(request, 16_384);
  if (!body) {
    return problem(413, 'payload_too_large', 'The request body is too large.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    return problem(400, 'invalid_request', 'Enter a valid email and password.');
  }
  const result = await safeFetch(apiUrl('/v1/sessions'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(parsed),
  });
  if (result instanceof NextResponse) {
    return result;
  }
  if (!result.ok) {
    return upstreamProblem(result);
  }
  const session = await result.json().catch(() => undefined);
  if (!session || typeof session.accessToken !== 'string' || typeof session.expiresAt !== 'string') {
    return problem(503, 'service_unavailable', 'ArchGauge returned an unexpected response.');
  }
  const expiry = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    return problem(503, 'service_unavailable', 'ArchGauge returned an unexpected response.');
  }
  const response = NextResponse.json({ authenticated: true });
  (await cookies()).set(SESSION_COOKIE, session.accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(expiry),
  });
  return response;
}
