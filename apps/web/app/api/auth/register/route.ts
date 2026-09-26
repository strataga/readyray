import { NextResponse } from 'next/server';
import { apiUrl, problem, readBoundedBody, requireSameOrigin, safeFetch, upstreamProblem } from '@/lib/server-api';

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
  const result = await safeFetch(apiUrl('/v1/users'), {
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
  const user = await result.json().catch(() => undefined);
  if (!user || typeof user.email !== 'string') {
    return problem(503, 'service_unavailable', 'ArchGauge returned an unexpected response.');
  }
  return NextResponse.json(user, { status: 201 });
}
