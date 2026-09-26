import { NextResponse } from 'next/server';
import { apiUrl, bearerToken, problem, proxyHeaders, readBoundedBody, requireSameOrigin, safeFetch, upstreamProblem } from './server-api';

export async function forwardReviewJson(request: Request, apiPath: string, method: 'GET' | 'POST'): Promise<Response> {
  if (method === 'POST') {
    const originError = requireSameOrigin(request);
    if (originError) {return originError;}
  }
  const token = await bearerToken();
  if (!token) {return problem(401, 'unauthorized', 'Sign in to use the review workspace.');}
  let body: string | undefined;
  if (method === 'POST') {
    const bytes = await readBoundedBody(request, 64 * 1024);
    if (!bytes) {return problem(413, 'payload_too_large', 'This request is larger than the allowed limit.');}
    try { body = JSON.stringify(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); }
    catch { return problem(400, 'invalid_request', 'Submit a valid JSON request.'); }
  }
  const headers = new Headers(proxyHeaders(token));
  if (body !== undefined) {headers.set('content-type', 'application/json');}
  const upstream = await safeFetch(apiUrl(apiPath), { method, headers, ...(body !== undefined ? { body } : {}) });
  if (upstream instanceof NextResponse) {return upstream;}
  if (!upstream.ok) {return upstreamProblem(upstream);}
  const result = await upstream.json().catch(() => undefined);
  if (result === undefined) {return problem(503, 'service_unavailable', 'ArchGauge returned an unexpected review response.');}
  return NextResponse.json(result, { status: upstream.status, headers: { 'cache-control': 'no-store' } });
}

export async function forwardReviewExport(request: Request, apiPath: string): Promise<Response> {
  const token = await bearerToken();
  if (!token) {return problem(401, 'unauthorized', 'Sign in to export this review.');}
  const upstream = await safeFetch(apiUrl(apiPath), { headers: proxyHeaders(token) });
  if (upstream instanceof NextResponse) {return upstream;}
  if (!upstream.ok) {return upstreamProblem(upstream);}
  const headers = new Headers({ 'cache-control': 'no-store' });
  for (const name of ['content-type', 'content-disposition', 'x-request-id']) {
    const value = upstream.headers.get(name);
    if (value) {headers.set(name, value);}
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

export function workspaceReviewPath(workspaceId: string, ...segments: string[]): string {
  return `/v1/workspaces/${encodeURIComponent(workspaceId)}/reviews${segments.length ? `/${segments.map(encodeURIComponent).join('/')}` : ''}`;
}
