import { NextResponse } from 'next/server';
import { apiUrl, bearerToken, problem, proxyHeaders, safeFetch, upstreamProblem } from '@/lib/server-api';

interface RouteContext {
  readonly params: Promise<{ workspaceId: string; intakeId: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const token = await bearerToken();
  if (!token) {
    return problem(401, 'unauthorized', 'Sign in to view this evidence inventory.');
  }
  const { workspaceId, intakeId } = await context.params;
  const result = await safeFetch(apiUrl(`/v1/workspaces/${encodeURIComponent(workspaceId)}/evidence/archives/${encodeURIComponent(intakeId)}`), {
    headers: proxyHeaders(token),
  });
  if (result instanceof NextResponse) {
    return result;
  }
  if (!result.ok) {
    return upstreamProblem(result);
  }
  const inventory = await result.json().catch(() => undefined) as Record<string, unknown> | undefined;
  if (!inventory || inventory.status !== 'accepted' || inventory.workspaceId !== workspaceId ||
    inventory.intakeId !== intakeId || typeof inventory.archiveSha256 !== 'string' ||
    typeof inventory.createdAt !== 'string' || typeof inventory.updatedAt !== 'string' ||
    !isManifest(inventory.manifest) || !Array.isArray(inventory.digests)) {
    return problem(503, 'service_unavailable', 'ArchGauge returned an unexpected inventory response.');
  }
  return NextResponse.json({
    intakeId: inventory.intakeId,
    status: 'accepted',
    workspaceId: inventory.workspaceId,
    archiveSha256: inventory.archiveSha256,
    createdAt: inventory.createdAt,
    updatedAt: inventory.updatedAt,
    manifest: {
      totalBytes: inventory.manifest.totalBytes,
      entries: inventory.manifest.entries.map((entry) => ({
        path: entry.path,
        byteSize: entry.byteSize,
        ...(typeof entry.mediaType === 'string' ? { mediaType: entry.mediaType } : {}),
      })),
    },
    digests: inventory.digests,
  }, { headers: { 'cache-control': 'no-store' } });
}

function isManifest(value: unknown): value is { totalBytes: number; entries: Array<Record<string, unknown>> } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const manifest = value as { totalBytes?: unknown; entries?: unknown };
  return Number.isSafeInteger(manifest.totalBytes) && Array.isArray(manifest.entries) &&
    manifest.entries.every((entry) => entry !== null && typeof entry === 'object' && !Array.isArray(entry) &&
      typeof entry.path === 'string' && Number.isSafeInteger(entry.byteSize));
}
