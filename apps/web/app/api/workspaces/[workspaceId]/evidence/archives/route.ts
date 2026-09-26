import { NextResponse } from 'next/server';
import { apiUrl, bearerToken, MAX_ARCHIVE_BYTES, problem, proxyHeaders, requireSameOrigin, safeFetch, upstreamProblem } from '@/lib/server-api';

interface RouteContext {
  readonly params: Promise<{ workspaceId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }
  const token = await bearerToken();
  if (!token) {
    return problem(401, 'unauthorized', 'Sign in before uploading evidence.');
  }
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/zip') {
    return problem(415, 'unsupported_media_type', 'Choose a ZIP archive to continue.');
  }
  const contentLength = request.headers.get('content-length');
  if (contentLength && (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_ARCHIVE_BYTES)) {
    return problem(413, 'payload_too_large', 'This archive is larger than the 50 MB upload limit.');
  }
  if (!request.body) {
    return problem(400, 'invalid_request', 'A ZIP archive body is required.');
  }

  const { workspaceId } = await context.params;
  const headers = new Headers(proxyHeaders(token));
  headers.set('content-type', 'application/zip');
  if (contentLength) {
    headers.set('content-length', contentLength);
  }
  const result = await safeFetch(apiUrl(`/v1/workspaces/${encodeURIComponent(workspaceId)}/evidence/archives`), {
    method: 'POST',
    headers,
    body: request.body,
    duplex: 'half',
  } as RequestInit);
  if (result instanceof NextResponse) {
    return result;
  }
  if (!result.ok) {
    return upstreamProblem(result);
  }
  const accepted = await result.json().catch(() => undefined) as Record<string, unknown> | undefined;
  if (!accepted || typeof accepted.intakeId !== 'string' || accepted.status !== 'accepted' ||
    accepted.workspaceId !== workspaceId || typeof accepted.archiveSha256 !== 'string' || !Array.isArray(accepted.digests)) {
    return problem(503, 'service_unavailable', 'ArchGauge returned an unexpected upload response.');
  }
  return NextResponse.json({
    intakeId: accepted.intakeId,
    status: 'accepted',
    workspaceId: accepted.workspaceId,
    archiveSha256: accepted.archiveSha256,
    digests: accepted.digests,
  }, { status: result.status, headers: { 'cache-control': 'no-store' } });
}
