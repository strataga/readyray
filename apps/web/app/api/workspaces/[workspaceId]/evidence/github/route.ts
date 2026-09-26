import { NextResponse } from 'next/server';
import {
  apiUrl,
  bearerToken,
  MAX_ARCHIVE_BYTES,
  problem,
  proxyHeaders,
  readBoundedBody,
  requireSameOrigin,
  safeFetch,
  upstreamProblem,
} from '@/lib/server-api';
import { isGithubCommitSha, parseGithubRepositoryUrl } from '@/lib/github-source';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ workspaceId: string }>;
}

interface PublicRepositoryMetadata {
  readonly private?: boolean;
  readonly visibility?: string;
  readonly default_branch?: string;
}

async function readBoundedStream(stream: ReadableStream<Uint8Array> | null, limit: number): Promise<ArrayBuffer | undefined> {
  if (!stream) {return undefined;}
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) {break;}
    total += part.value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(part.value);
  }
  const archive = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    archive.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return archive.buffer as ArrayBuffer;
}

async function readMetadata(response: Response): Promise<PublicRepositoryMetadata | undefined> {
  const size = Number(response.headers.get('content-length'));
  if (Number.isFinite(size) && size > 64 * 1024) {return undefined;}
  const body = await readBoundedStream(response.body, 64 * 1024);
  if (!body) {return undefined;}
  try {
    return JSON.parse(new TextDecoder().decode(body)) as PublicRepositoryMetadata;
  } catch {
    return undefined;
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const originError = requireSameOrigin(request);
  if (originError) {return originError;}
  const token = await bearerToken();
  if (!token) {return problem(401, 'unauthorized', 'Sign in before importing a repository.');}

  const { workspaceId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId)) {
    return problem(400, 'invalid_request', 'Choose a valid workspace.');
  }
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {return problem(415, 'unsupported_media_type', 'Submit a GitHub repository URL.');}

  const bodyChunks = await readBoundedBody(request, 4_096);
  if (!bodyChunks) {return problem(413, 'payload_too_large', 'The request body is too large.');}
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bodyChunks));
  } catch {
    return problem(400, 'invalid_request', 'Enter a public GitHub repository URL.');
  }
  const repoUrl = (value as { repositoryUrl?: unknown } | null)?.repositoryUrl;
  const repository = parseGithubRepositoryUrl(repoUrl);
  if (!repository) {return problem(400, 'invalid_request', 'Enter a URL such as https://github.com/owner/repository.');}

  let metadataResponse: Response;
  try {
    metadataResponse = await fetch(`https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'ArchGauge-evidence-intake' },
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
      cache: 'no-store',
    });
  } catch {
    return problem(503, 'service_unavailable', 'GitHub is temporarily unavailable. Try again shortly.');
  }
  if (!metadataResponse.ok) {return problem(422, 'repository_unavailable', 'That public repository could not be accessed.');}
  const metadata = await readMetadata(metadataResponse);
  if (!metadata || (metadata.private !== false && metadata.visibility !== 'public') || typeof metadata.default_branch !== 'string' || metadata.default_branch.length > 200 ||
    metadata.default_branch.includes('\\') || Array.from(metadata.default_branch).some((character) => character.charCodeAt(0) < 32)) {
    return problem(422, 'repository_unavailable', 'That public repository could not be accessed.');
  }

  const commitsUrl = new URL(`https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}/commits`);
  commitsUrl.searchParams.set('sha', metadata.default_branch);
  commitsUrl.searchParams.set('per_page', '1');
  let commitResponse: Response;
  try {
    commitResponse = await fetch(commitsUrl, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'ArchGauge-evidence-intake' },
      redirect: 'error', signal: AbortSignal.timeout(12_000), cache: 'no-store',
    });
  } catch {
    return problem(503, 'service_unavailable', 'GitHub is temporarily unavailable. Try again shortly.');
  }
  if (!commitResponse.ok) {return problem(422, 'repository_unavailable', 'That public repository could not be accessed.');}
  const commitsBody = await readBoundedStream(commitResponse.body, 64 * 1024);
  let commitSha: unknown;
  try {
    const commits: unknown = commitsBody ? JSON.parse(new TextDecoder().decode(commitsBody)) : undefined;
    commitSha = Array.isArray(commits) && commits[0] && typeof commits[0] === 'object'
      ? (commits[0] as { sha?: unknown }).sha : undefined;
  } catch {
    commitSha = undefined;
  }
  if (!isGithubCommitSha(commitSha)) {return problem(422, 'repository_unavailable', 'That public repository revision could not be pinned.');}

  const archiveUrl = `https://codeload.github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}/zip/${commitSha}`;
  let archiveResponse: Response;
  try {
    archiveResponse = await fetch(archiveUrl, {
      headers: { accept: 'application/zip', 'user-agent': 'ArchGauge-evidence-intake' },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      cache: 'no-store',
    });
  } catch {
    return problem(503, 'service_unavailable', 'GitHub is temporarily unavailable. Try again shortly.');
  }
  if (!archiveResponse.ok) {return problem(422, 'repository_unavailable', 'That public repository archive could not be fetched.');}
  const archiveContentType = archiveResponse.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (archiveContentType !== 'application/zip' && archiveContentType !== 'application/octet-stream') {
    await archiveResponse.body?.cancel();
    return problem(422, 'repository_unavailable', 'That public repository archive could not be fetched.');
  }
  const archiveSize = Number(archiveResponse.headers.get('content-length'));
  if (Number.isFinite(archiveSize) && archiveSize > MAX_ARCHIVE_BYTES) {
    await archiveResponse.body?.cancel();
    return problem(413, 'payload_too_large', 'This repository archive is larger than the 50 MB evidence limit.');
  }
  const archive = await readBoundedStream(archiveResponse.body, MAX_ARCHIVE_BYTES);
  if (!archive) {return problem(413, 'payload_too_large', 'This repository archive is larger than the 50 MB evidence limit.');}

  const headers = new Headers(proxyHeaders(token));
  headers.set('content-type', 'application/zip');
  headers.set('content-length', String(archive.byteLength));
  const result = await safeFetch(apiUrl(`/v1/workspaces/${encodeURIComponent(workspaceId)}/evidence/archives`), {
    method: 'POST',
    headers,
    body: archive,
  });
  if (result instanceof NextResponse) {return result;}
  if (!result.ok) {return upstreamProblem(result);}
  const accepted = await result.json().catch(() => undefined) as Record<string, unknown> | undefined;
  if (!accepted || typeof accepted.intakeId !== 'string' || accepted.status !== 'accepted' ||
    accepted.workspaceId !== workspaceId || typeof accepted.archiveSha256 !== 'string' || !Array.isArray(accepted.digests)) {
    return problem(503, 'service_unavailable', 'ArchGauge returned an unexpected import response.');
  }
  return NextResponse.json({
    intakeId: accepted.intakeId,
    status: 'accepted',
    workspaceId: accepted.workspaceId,
    archiveSha256: accepted.archiveSha256,
    sourceCommitSha: commitSha,
    digests: accepted.digests,
  }, { status: result.status, headers: { 'cache-control': 'no-store' } });
}
