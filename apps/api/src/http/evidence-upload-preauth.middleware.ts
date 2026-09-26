import type { RequestHandler } from 'express';
import type { WorkspaceEvidenceAuthorizationPort } from '@archgauge/evidence/application';
import type { ResolveSession } from '../modules/identity/application/resolve-session.use-case.js';

/** Rejects unauthenticated or non-member uploads before Express buffers their ZIP body. */
export function evidenceUploadPreauth(
  resolveSession: ResolveSession,
  authorization: WorkspaceEvidenceAuthorizationPort,
): RequestHandler {
  let activeUploads = 0;
  return async (request, response, next) => {
    if (request.method !== 'POST' || request.path !== '/') {
      next();
      return;
    }
    const path = request.originalUrl.split('?', 1)[0] ?? request.path;
    const token = request.header('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!token) {
      sendProblem(response, path, 401, 'unauthorized', 'Unauthorized', 'A valid session is required.');
      return;
    }

    try {
      const userId = await resolveSession.execute(token);
      if (!userId) {
        sendProblem(response, path, 401, 'unauthorized', 'Unauthorized', 'A valid session is required.');
        return;
      }
      const allowed = await authorization.canIngestEvidence({
        actorId: userId,
        workspaceId: request.params.workspaceId as string,
      });
      if (!allowed) {
        sendProblem(response, path, 403, 'workspace_forbidden', 'Forbidden', 'The caller cannot ingest evidence into this workspace.');
        return;
      }
      if (activeUploads >= 1) {
        response.setHeader('Retry-After', '1');
        sendProblem(response, path, 429, 'upload_busy', 'Too Many Requests', 'An evidence upload is already in progress.');
        return;
      }
      activeUploads += 1;
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          activeUploads -= 1;
        }
      };
      response.once('finish', release);
      response.once('close', release);
      next();
    } catch {
      sendProblem(response, path, 503, 'service_unavailable', 'Service Unavailable', 'The service is temporarily unavailable.');
    }
  };
}

function sendProblem(
  response: Parameters<RequestHandler>[1],
  path: string,
  status: number,
  code: string,
  title: string,
  detail: string,
): void {
  response.status(status).type('application/problem+json').json({
    type: `urn:archgauge:problem:${code}`,
    title,
    status,
    detail,
    instance: path,
    code,
    requestId: response.getHeader('x-request-id'),
  });
}
