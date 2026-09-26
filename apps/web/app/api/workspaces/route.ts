import { NextResponse } from 'next/server';
import { apiUrl, bearerToken, problem, proxyHeaders, readBoundedBody, requireSameOrigin, safeFetch, upstreamProblem } from '@/lib/server-api';

export async function GET() {
  const token = await bearerToken();
  if (!token) {
    return problem(401, 'unauthorized', 'Sign in to view your workspaces.');
  }
  const result = await safeFetch(apiUrl('/v1/workspaces'), { headers: proxyHeaders(token) });
  if (result instanceof NextResponse) {
    return result;
  }
  if (!result.ok) {
    return upstreamProblem(result);
  }
  return NextResponse.json(await result.json());
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }
  const token = await bearerToken();
  if (!token) {
    return problem(401, 'unauthorized', 'Sign in to create a workspace.');
  }
  const body = await readBoundedBody(request, 8_192);
  if (!body) {
    return problem(413, 'payload_too_large', 'The request body is too large.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    return problem(400, 'invalid_request', 'Enter a workspace name.');
  }
  const result = await safeFetch(apiUrl('/v1/workspaces'), {
    method: 'POST',
    headers: { ...proxyHeaders(token), 'content-type': 'application/json' },
    body: JSON.stringify(parsed),
  });
  if (result instanceof NextResponse) {
    return result;
  }
  if (!result.ok) {
    return upstreamProblem(result);
  }
  return NextResponse.json(await result.json(), { status: 201 });
}
