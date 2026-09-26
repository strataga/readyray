import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const SESSION_COOKIE = 'archgauge_session';
export const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;

export async function readBoundedBody(request: Request, limit: number): Promise<Uint8Array | undefined> {
  if (!request.body) {return new Uint8Array();}
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) {break;}
    size += part.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function apiUrl(path: string): string {
  const base = process.env.ARCHGAUGE_API_URL ?? 'http://localhost:3000';
  return new URL(path, base).toString();
}

export function requireSameOrigin(request: Request): NextResponse | undefined {
  const origin = request.headers.get('origin');
  if (origin === new URL(request.url).origin) {
    return undefined;
  }
  return problem(403, 'forbidden', 'This request could not be verified.');
}

export function problem(status: number, code: string, detail: string): NextResponse {
  const titles: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    413: 'Payload Too Large',
    415: 'Unsupported Media Type',
    422: 'Unprocessable Content',
    429: 'Too Many Requests',
    503: 'Service Unavailable',
  };
  const title = titles[status] ?? 'Request Failed';
  const requestId = crypto.randomUUID();
  return NextResponse.json(
    {
      type: `https://archgauge.dev/problems/${code}`,
      title,
      status,
      detail,
      instance: '/',
      code,
      requestId,
    },
    { status, headers: { 'content-type': 'application/problem+json', 'x-request-id': requestId, 'cache-control': 'no-store' } },
  );
}

export async function upstreamProblem(response: Response): Promise<NextResponse> {
  const status = response.status;
  const retryAfter = response.headers.get('retry-after');
  const safe: Record<number, { code: string; detail: string }> = {
    400: { code: 'invalid_request', detail: 'Check the submitted information and try again.' },
    401: { code: 'unauthorized', detail: 'Your session or credentials could not be verified.' },
    403: { code: 'forbidden', detail: 'You do not have access to this workspace.' },
    404: { code: 'not_found', detail: 'The requested item could not be found.' },
    409: { code: 'conflict', detail: 'An account with this email already exists.' },
    413: { code: 'payload_too_large', detail: 'This archive is larger than the 50 MB upload limit.' },
    415: { code: 'unsupported_media_type', detail: 'Choose a ZIP archive to continue.' },
    422: { code: 'archive_rejected', detail: 'This archive did not pass evidence validation.' },
    429: { code: 'rate_limited', detail: 'Too many attempts. Wait a moment and try again.' },
    503: { code: 'service_unavailable', detail: 'ArchGauge is temporarily unavailable. Try again shortly.' },
  };
  const fallback = status >= 500
    ? { code: 'service_unavailable', detail: 'ArchGauge is temporarily unavailable. Try again shortly.' }
    : { code: 'request_failed', detail: 'The request could not be completed.' };
  const entry = safe[status] ?? fallback;
  const result = problem(status, entry.code, entry.detail);
  if (status === 429) {
    if (retryAfter && /^\d{1,6}$/.test(retryAfter)) {
      result.headers.set('retry-after', retryAfter);
    }
  }
  return result;
}

export async function bearerToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export function proxyHeaders(token?: string): HeadersInit {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function safeFetch(url: string, init: RequestInit): Promise<Response | NextResponse> {
  try {
    return await fetch(url, { ...init, cache: 'no-store' });
  } catch {
    return problem(503, 'service_unavailable', 'ArchGauge is temporarily unavailable. Try again shortly.');
  }
}
