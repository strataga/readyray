import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, it } from 'bun:test';
import type { DynamicModule } from '@nestjs/common';
import type { User, UserId } from '../dist/modules/identity/domain/user.js';
import { PASSWORD_HASHER, SESSION_TOKENS } from '../dist/modules/identity/application/security.port.js';
import { SESSION_REPOSITORY } from '../dist/modules/identity/application/session-repository.port.js';
import { USER_REPOSITORY } from '../dist/modules/identity/application/user-repository.port.js';
import { CreateSession } from '../dist/modules/identity/application/create-session.use-case.js';
import { RegisterUser } from '../dist/modules/identity/application/register-user.use-case.js';
import { ResolveSession } from '../dist/modules/identity/application/resolve-session.use-case.js';
import { RevokeSession } from '../dist/modules/identity/application/revoke-session.use-case.js';
import { IdentityController } from '../dist/modules/identity/http/identity.controller.js';
import { READINESS_PROBE } from '../dist/operations/readiness.port.js';
import { CreateWorkspace } from '../dist/modules/workspaces/application/create-workspace.use-case.js';
import { ListWorkspaces } from '../dist/modules/workspaces/application/list-workspaces.use-case.js';
import { WORKSPACE_REPOSITORY } from '../dist/modules/workspaces/application/workspace-repository.port.js';
import { WorkspacesController } from '../dist/modules/workspaces/http/workspaces.controller.js';
import { EvidenceArchivesController } from '../dist/modules/evidence/http/evidence-archives.controller.js';
import { EVIDENCE_ARCHIVE_STORAGE, EVIDENCE_WORKSPACE_AUTHORIZATION } from '../dist/modules/evidence/http/evidence.tokens.js';
import { HealthController } from '../dist/operations/health.controller.js';
import { createApiApp } from '../dist/api-app.js';
import type { AcceptedEvidenceArchiveIntake } from '@archgauge/evidence/application';

type FakeWorkspace = { id: string; name: string; createdAt: Date };
const users = new Map<string, User & { passwordHash: string }>();
const sessions = new Map<string, UserId>();
const workspaces = new Map<string, { workspace: FakeWorkspace; ownerId: UserId }>();
const evidenceArchives = new Map<string, AcceptedEvidenceArchiveIntake>();
let tokenSequence = 0;

const userRepository = {
  async create(email: string, passwordHash: string) {
    const user = { id: randomUUID() as UserId, email, passwordHash, createdAt: new Date() };
    users.set(email, user);
    return user;
  },
  async findByEmail(email: string) { return users.get(email); },
  async findById(id: UserId) { return [...users.values()].find((user) => user.id === id); },
};
const sessionRepository = {
  async create(userId: UserId, digest: string) { sessions.set(digest, userId); },
  async findActiveUser(digest: string) { return sessions.get(digest); },
  async revoke(digest: string) { sessions.delete(digest); },
};
const workspaceRepository = {
  async createOwned(name: string, ownerId: UserId) {
    const workspace = { id: randomUUID(), name, createdAt: new Date() };
    workspaces.set(workspace.id, { workspace, ownerId });
    return workspace;
  },
  async findByIdForMember(id: string, memberId: UserId) {
    const record = workspaces.get(id);
    return record?.ownerId === memberId ? record.workspace : undefined;
  },
  async listForMember(memberId: UserId) {
    return [...workspaces.values()]
      .filter(({ ownerId }) => ownerId === memberId)
      .map(({ workspace }) => workspace);
  },
};
const passwordHasher = {
  async hash(password: string) { return `test-hash:${password}`; },
  async verify(password: string, encodedHash: string) { return encodedHash === `test-hash:${password}`; },
  async verifyDummy() {},
};
const sessionTokens = {
  issue() {
    const token = Buffer.alloc(32, ++tokenSequence).toString('base64url');
    return { token, digest: `digest:${token}` };
  },
  digest(token: string) { return `digest:${token}`; },
};
const evidenceArchiveStorage = {
  async storeAcceptedArchive({ workspaceId, intake }: { workspaceId: string; intake: AcceptedEvidenceArchiveIntake }) {
    evidenceArchives.set(`${workspaceId}:${intake.intake.id}`, intake);
  },
  async findAcceptedArchive({ workspaceId, intakeId }: { workspaceId: string; intakeId: string }) {
    return evidenceArchives.get(`${workspaceId}:${intakeId}`);
  },
};

const FakePersistenceApiModule: DynamicModule = {
  module: class FakePersistenceApiModule {},
  controllers: [HealthController, IdentityController, WorkspacesController, EvidenceArchivesController],
  providers: [
    { provide: USER_REPOSITORY, useValue: userRepository },
    { provide: SESSION_REPOSITORY, useValue: sessionRepository },
    { provide: WORKSPACE_REPOSITORY, useValue: workspaceRepository },
    { provide: EVIDENCE_WORKSPACE_AUTHORIZATION, useValue: {
      async canIngestEvidence({ actorId, workspaceId }: { actorId: UserId; workspaceId: string }) {
        return (await workspaceRepository.findByIdForMember(workspaceId, actorId)) !== undefined;
      },
    } },
    { provide: EVIDENCE_ARCHIVE_STORAGE, useValue: evidenceArchiveStorage },
    { provide: PASSWORD_HASHER, useValue: passwordHasher },
    { provide: SESSION_TOKENS, useValue: sessionTokens },
    { provide: READINESS_PROBE, useValue: { async check() {} } },
    RegisterUser, CreateSession, ResolveSession, RevokeSession, CreateWorkspace, ListWorkspaces,
  ],
};

describe('API HTTP integration', () => {
  let app: Awaited<ReturnType<typeof createApiApp>>;
  let baseUrl: string;

  beforeAll(async () => {
    users.clear();
    sessions.clear();
    workspaces.clear();
    evidenceArchives.clear();
    tokenSequence = 0;
    app = await createApiApp(FakePersistenceApiModule);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    assert(address && typeof address === 'object');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => { await app?.close(); });

  it('adds a request ID to successful responses', async () => {
    const response = await fetch(`${baseUrl}/v1/health/live`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/i);
  });

  it('returns RFC 9457 problems for malformed and oversized JSON', async () => {
    const malformed = await fetch(`${baseUrl}/v1/users`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
    });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.headers.get('content-type')?.split(';')[0], 'application/problem+json');
    assert.match(malformed.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/i);
    assert.equal((await malformed.json() as { code: string }).code, 'malformed_request_body');

    const oversized = await fetch(`${baseUrl}/v1/users`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: 'x'.repeat(33 * 1024) }),
    });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.headers.get('content-type')?.split(';')[0], 'application/problem+json');
    assert.equal((await oversized.json() as { code: string }).code, 'payload_too_large');
  });

  it('returns a generic RFC 9457 problem for an unknown session', async () => {
    const response = await fetch(`${baseUrl}/v1/workspaces`, {
      headers: { authorization: `Bearer ${'A'.repeat(43)}` },
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('content-type')?.split(';')[0], 'application/problem+json');
    const problem = await response.json() as { code: string; detail: string; requestId: string };
    assert.equal(problem.code, 'unauthorized');
    assert.equal(problem.detail, 'A valid session is required.');
    assert.match(problem.requestId, /^[0-9a-f-]{36}$/i);
  });

  it('rejects unauthenticated evidence requests before parsing their body', async () => {
    const path = `/v1/workspaces/${randomUUID()}/evidence/archives`;
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: 'x'.repeat(33 * 1024) }),
    });
    assert.equal(response.status, 401);
    const problem = await response.json() as { code: string; instance: string };
    assert.equal(problem.code, 'unauthorized');
    assert.equal(problem.instance, path);
  });

  it('registers, logs in, creates an owned workspace, and lists it', async () => {
    const registration = await fetch(`${baseUrl}/v1/users`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.test', password: 'a-long-enough-password' }),
    });
    assert.equal(registration.status, 201);

    const login = await fetch(`${baseUrl}/v1/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.test', password: 'a-long-enough-password' }),
    });
    assert.equal(login.status, 201);
    const session = await login.json() as { accessToken: string };
    assert.ok(session.accessToken);

    const created = await fetch(`${baseUrl}/v1/workspaces`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'My workspace' }),
    });
    assert.equal(created.status, 201);
    const workspace = await created.json() as { id: string; name: string };
    assert.equal(workspace.name, 'My workspace');

    const intakeId = randomUUID();
    evidenceArchives.set(`${workspace.id}:${intakeId}`, {
      status: 'accepted',
      intake: {
        id: intakeId,
        status: 'accepted',
        createdAt: '2026-09-26T00:00:00.000Z',
        updatedAt: '2026-09-26T00:00:02.000Z',
      },
      workspaceId: workspace.id,
      archiveSha256: 'a'.repeat(64),
      manifest: { entries: [{ path: 'README.md' as never, byteSize: 6 }], totalBytes: 6 },
      digests: [{ path: 'README.md' as never, algorithm: 'sha256', hexDigest: 'b'.repeat(64), byteSize: 6 }],
    });
    const inventoryResponse = await fetch(`${baseUrl}/v1/workspaces/${workspace.id}/evidence/archives/${intakeId}`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    assert.equal(inventoryResponse.status, 200);
    const inventory = await inventoryResponse.json() as {
      intakeId: string;
      manifest: { totalBytes: number; entries: { path: string }[] };
      digests: { hexDigest: string }[];
    };
    assert.equal(inventory.intakeId, intakeId);
    assert.equal(inventory.manifest.totalBytes, 6);
    assert.equal(inventory.manifest.entries[0]?.path, 'README.md');
    assert.equal(inventory.digests[0]?.hexDigest, 'b'.repeat(64));
    assert.equal(JSON.stringify(inventory).includes('archiveBytes'), false);
    const missingInventory = await fetch(`${baseUrl}/v1/workspaces/${workspace.id}/evidence/archives/${randomUUID()}`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    assert.equal(missingInventory.status, 404);
    assert.equal((await missingInventory.json() as { code: string }).code, 'not_found');

    const listed = await fetch(`${baseUrl}/v1/workspaces`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    assert.equal(listed.status, 200);
    const listedWorkspaces = await listed.json() as { id: string; name: string }[];
    assert.equal(listedWorkspaces.length, 1);
    assert.equal(listedWorkspaces[0]?.id, workspace.id);
    assert.equal(listedWorkspaces[0]?.name, workspace.name);

    const malformedEvidence = await fetch(`${baseUrl}/v1/workspaces/${workspace.id}/evidence/archives`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.accessToken}`, 'content-type': 'application/zip' },
      body: Buffer.from('not a ZIP'),
    });
    assert.equal(malformedEvidence.status, 422);
    assert.equal(malformedEvidence.headers.get('content-type')?.split(';')[0], 'application/problem+json');
    assert.equal((await malformedEvidence.json() as { code: string }).code, 'invalid_archive');

    const secondRegistration = await fetch(`${baseUrl}/v1/users`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'other@example.test', password: 'another-long-password' }),
    });
    assert.equal(secondRegistration.status, 201);
    const secondLogin = await fetch(`${baseUrl}/v1/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'other@example.test', password: 'another-long-password' }),
    });
    assert.equal(secondLogin.status, 201);
    const secondSession = await secondLogin.json() as { accessToken: string };
    const forbiddenEvidence = await fetch(`${baseUrl}/v1/workspaces/${workspace.id}/evidence/archives`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secondSession.accessToken}`, 'content-type': 'application/zip' },
      body: Buffer.from('not a ZIP'),
    });
    assert.equal(forbiddenEvidence.status, 403);
    assert.equal((await forbiddenEvidence.json() as { code: string }).code, 'workspace_forbidden');
    const secondUsersList = await fetch(`${baseUrl}/v1/workspaces`, {
      headers: { authorization: `Bearer ${secondSession.accessToken}` },
    });
    assert.equal(secondUsersList.status, 200);
    assert.deepEqual(await secondUsersList.json(), []);
    const logout = await fetch(`${baseUrl}/v1/sessions/current`, {
      method: 'DELETE', headers: { authorization: `Bearer ${session.accessToken}` },
    });
    assert.equal(logout.status, 204);
    const revokedSessionAccess = await fetch(`${baseUrl}/v1/workspaces`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    assert.equal(revokedSessionAccess.status, 401);
  });

  it('publishes OpenAPI 3.1 session and problem response schemas', async () => {
    const response = await fetch(`${baseUrl}/openapi.json`);
    assert.equal(response.status, 200);
    const document = await response.json() as {
      openapi: string;
      paths: Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }> }>>;
      components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
    };
    assert.equal(document.openapi, '3.1.0');
    assert.ok(document.paths['/v1/sessions/current']?.delete?.responses['204']);
    assert.ok(document.paths['/v1/sessions/current']?.delete?.responses['401']?.content?.['application/problem+json']?.schema?.$ref);
    const sessionPath = Object.keys(document.paths).find((path) => path.endsWith('/sessions'));
    assert.ok(sessionPath);
    const sessionResponse = document.paths[sessionPath]?.post?.responses['201'];
    const sessionSchema = sessionResponse?.content?.['application/json']?.schema?.$ref?.split('/').at(-1);
    assert.ok(sessionSchema);
    assert.ok(document.components.schemas[sessionSchema]?.properties?.accessToken);
    assert.ok(document.paths[sessionPath]?.post?.responses['401']?.content?.['application/problem+json']?.schema?.$ref);
    assert.ok(document.paths[sessionPath]?.post?.responses['413']?.content?.['application/problem+json']?.schema?.$ref);
    const evidencePath = Object.keys(document.paths).find((path) => path.endsWith('/evidence/archives'));
    assert.ok(evidencePath);
    assert.ok(document.paths[evidencePath]?.post?.responses['201']?.content?.['application/json']?.schema?.$ref);
    assert.ok(document.paths[evidencePath]?.post?.responses['422']?.content?.['application/problem+json']?.schema?.$ref);
    assert.ok(document.paths[evidencePath]?.post?.responses['429']?.content?.['application/problem+json']?.schema?.$ref);
    const inventoryPath = Object.keys(document.paths).find((path) => path.includes('/evidence/archives/'));
    assert.ok(inventoryPath);
    assert.ok(document.paths[inventoryPath]?.get?.responses['200']?.content?.['application/json']?.schema?.$ref);
  });
});
