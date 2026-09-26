import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { describe, test } from 'bun:test';
import { HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { EvidenceArchivesController } from '../dist/modules/evidence/http/evidence-archives.controller.js';
import { EvidenceUploadHttpError } from '../dist/modules/evidence/http/evidence-upload.error.js';
import type {
  AcceptedEvidenceArchiveIntake,
  EvidenceArchiveInventoryReadPort,
  EvidenceArchiveStoragePort,
  WorkspaceEvidenceAuthorizationPort,
} from '@archgauge/evidence/application';
import { EvidenceArchiveIntakeResponseDto } from '../dist/modules/evidence/http/evidence-upload.dto.js';
import { ProblemDetailsFilter } from '../dist/http/problem-details.filter.js';

const workspaceId = '8e063200-fd32-4c06-9c83-01744c74929a';
const actorId = 'aa34667b-d6a5-40f5-b072-0e9fe1f3b2df';
const intakeId = '2a759711-3a0f-483a-9bc9-840af908288e';

describe('evidence archive HTTP adapter', () => {
  test('ingests only raw Buffer ZIP data and returns intake and digest metadata', async () => {
    const archiveBytes = createZip('src/main.ts', Buffer.from('export const answer = 42;\n'));
    const expectedBytes = Buffer.from(archiveBytes);
    const accepted: Buffer[] = [];
    let authorizedActor: string | undefined;
    let authorizedWorkspace: string | undefined;
    const controller = createController({
      authorization: {
        async canIngestEvidence({ actorId: id, workspaceId: idWorkspace }) {
          authorizedActor = id;
          authorizedWorkspace = idWorkspace;
          return true;
        },
      },
      storage: {
        async storeAcceptedArchive({ archiveBytes: stored }) {
          accepted.push(Buffer.from(stored));
        },
      },
    });

    const result = await controller.upload(workspaceId, authenticatedRequest(), archiveBytes);

    assert.equal(authorizedActor, actorId);
    assert.equal(authorizedWorkspace, workspaceId);
    assert.equal(result.status, 'accepted');
    assert.match(result.intakeId, /^[0-9a-f-]{36}$/i);
    assert.equal(result.workspaceId, workspaceId);
    assert.equal(result.archiveSha256, createHash('sha256').update(expectedBytes).digest('hex'));
    assert.deepEqual(result.digests, [{
      path: 'src/main.ts',
      algorithm: 'sha256',
      hexDigest: createHash('sha256').update('export const answer = 42;\n').digest('hex'),
      byteSize: Buffer.byteLength('export const answer = 42;\n'),
    }]);
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0]?.compare(expectedBytes), 0);
    assert.ok(archiveBytes.every((byte) => byte === 0));
    assert.equal(JSON.stringify(result).includes('export const answer'), false);
    assert.equal(JSON.stringify(result).includes('archiveBytes'), false);
    assert.equal(result instanceof EvidenceArchiveIntakeResponseDto, false);
  });

  test('rejects non-Buffer bodies and non-ZIP content types with safe errors', async () => {
    const controller = createController();
    const request = authenticatedRequest();
    await expectHttpError(controller.upload(workspaceId, request, new Uint8Array([1, 2])), 400, 'invalid_input');

    const wrongTypeRequest = authenticatedRequest('application/octet-stream');
    await expectHttpError(controller.upload(workspaceId, wrongTypeRequest, Buffer.from('not relevant')), 415, 'unsupported_media_type');
  });

  test('maps workspace denial to a stable forbidden Problem Details response', async () => {
    const controller = createController({
      authorization: { async canIngestEvidence() { return false; } },
    });
    const error = await expectHttpError(
      controller.upload(workspaceId, authenticatedRequest(), createZip('safe.txt', Buffer.from('safe'))),
      HttpStatus.FORBIDDEN,
      'workspace_forbidden',
    );
    const problem = renderProblem(error);
    assert.equal(problem.status, HttpStatus.FORBIDDEN);
    assert.equal(problem.body.code, 'workspace_forbidden');
    assert.equal(problem.body.detail, 'The caller cannot ingest evidence into this workspace.');
    assert.equal(problem.contentType, 'application/problem+json');
  });

  test('maps secret rejection without exposing the uploaded credential', async () => {
    const secret = ['ghp_', '123456789012345678901234567890123456'].join('');
    const controller = createController();
    const error = await expectHttpError(
      controller.upload(workspaceId, authenticatedRequest(), createZip('config.txt', Buffer.from(`token=${secret}\n`))),
      HttpStatus.UNPROCESSABLE_ENTITY,
      'secret_detected',
    );
    const problem = renderProblem(error);
    assert.equal(problem.body.code, 'secret_detected');
    assert.equal(JSON.stringify(problem.body).includes(secret), false);
  });

  test('maps storage failures without exposing the adapter error', async () => {
    const controller = createController({
      storage: { async storeAcceptedArchive() { throw new Error('storage credentials leaked'); } },
    });
    const archiveBytes = createZip('safe.txt', Buffer.from('safe'));
    const error = await expectHttpError(
      controller.upload(workspaceId, authenticatedRequest(), archiveBytes),
      HttpStatus.SERVICE_UNAVAILABLE,
      'storage_unavailable',
    );
    const problem = renderProblem(error);
    assert.equal(problem.body.code, 'storage_unavailable');
    assert.equal(JSON.stringify(problem.body).includes('storage credentials leaked'), false);
    assert.ok(archiveBytes.every((byte) => byte === 0));
  });

  test('returns accepted inventory metadata, timestamps, manifest, and digests without bytes', async () => {
    const privateBytes = Buffer.from('private original archive bytes');
    const inventory = {
      ...acceptedInventory(),
      archiveBytes: privateBytes,
    } as unknown as AcceptedEvidenceArchiveIntake;
    let authorizedActor: string | undefined;
    let authorizedWorkspace: string | undefined;
    let requestedIntake: string | undefined;
    const controller = createController({
      authorization: {
        async canIngestEvidence({ actorId: id, workspaceId: idWorkspace }) {
          authorizedActor = id;
          authorizedWorkspace = idWorkspace;
          return true;
        },
      },
      storage: {
        async findAcceptedArchive(input) {
          requestedIntake = input.intakeId;
          return inventory;
        },
      },
    });

    const result = await controller.getInventory(workspaceId, intakeId, authenticatedRequest());

    assert.equal(authorizedActor, actorId);
    assert.equal(authorizedWorkspace, workspaceId);
    assert.equal(requestedIntake, intakeId);
    assert.deepEqual(result, {
      intakeId,
      status: 'accepted',
      workspaceId,
      archiveSha256: 'b'.repeat(64),
      createdAt: '2026-09-26T12:00:00.000Z',
      updatedAt: '2026-09-26T12:01:00.000Z',
      manifest: {
        totalBytes: 4,
        entries: [{ path: 'src/main.ts', byteSize: 4, mediaType: 'text/plain' }],
      },
      digests: [{ path: 'src/main.ts', algorithm: 'sha256', hexDigest: 'a'.repeat(64), byteSize: 4 }],
    });
    assert.equal(JSON.stringify(result).includes('private original archive bytes'), false);
    assert.equal(JSON.stringify(result).includes('archiveBytes'), false);
  });

  test('rejects an invalid workspace or intake ID before authorization', async () => {
    let authorizationCalls = 0;
    const controller = createController({
      authorization: { async canIngestEvidence() { authorizationCalls += 1; return true; } },
    });
    const error = await expectHttpError(
      controller.getInventory(workspaceId, 'invalid-id', authenticatedRequest()),
      HttpStatus.BAD_REQUEST,
      'invalid_input',
    );
    assert.equal(renderProblem(error).body.detail, 'The workspace or intake identifier is invalid.');
    assert.equal(authorizationCalls, 0);
  });

  test('returns forbidden without querying inventory for a workspace the caller cannot access', async () => {
    let inventoryCalls = 0;
    const controller = createController({
      authorization: { async canIngestEvidence() { return false; } },
      storage: {
        async findAcceptedArchive() { inventoryCalls += 1; return acceptedInventory(); },
      },
    });
    const error = await expectHttpError(
      controller.getInventory(workspaceId, intakeId, authenticatedRequest()),
      HttpStatus.FORBIDDEN,
      'workspace_forbidden',
    );
    assert.equal(renderProblem(error).body.code, 'workspace_forbidden');
    assert.equal(inventoryCalls, 0);
  });

  test('returns not found for an absent accepted intake', async () => {
    const controller = createController({ storage: { async findAcceptedArchive() { return undefined; } } });
    const error = await expectHttpError(
      controller.getInventory(workspaceId, intakeId, authenticatedRequest()),
      HttpStatus.NOT_FOUND,
      'not_found',
    );
    const problem = renderProblem(error);
    assert.equal(problem.body.code, 'not_found');
    assert.equal(problem.body.detail, 'The accepted evidence archive was not found.');
  });

  test('maps inventory storage errors to a safe service-unavailable problem', async () => {
    const controller = createController({
      storage: { async findAcceptedArchive() { throw new Error('database password exposed'); } },
    });
    const error = await expectHttpError(
      controller.getInventory(workspaceId, intakeId, authenticatedRequest()),
      HttpStatus.SERVICE_UNAVAILABLE,
      'storage_unavailable',
    );
    const problem = renderProblem(error);
    assert.equal(problem.body.code, 'storage_unavailable');
    assert.equal(JSON.stringify(problem.body).includes('database password exposed'), false);
  });
});

function createController(overrides: {
  readonly authorization?: WorkspaceEvidenceAuthorizationPort;
  readonly storage?: Partial<EvidenceArchiveStoragePort & EvidenceArchiveInventoryReadPort>;
} = {}): EvidenceArchivesController {
  const storage: EvidenceArchiveStoragePort & EvidenceArchiveInventoryReadPort = {
    storeAcceptedArchive: overrides.storage?.storeAcceptedArchive ?? (async () => {}),
    findAcceptedArchive: overrides.storage?.findAcceptedArchive ?? (async () => undefined),
  };
  return new EvidenceArchivesController(
    overrides.authorization ?? { async canIngestEvidence() { return true; } },
    storage,
  );
}

function acceptedInventory(): AcceptedEvidenceArchiveIntake {
  return {
    status: 'accepted',
    intake: {
      id: intakeId,
      status: 'accepted',
      createdAt: '2026-09-26T12:00:00.000Z',
      updatedAt: '2026-09-26T12:01:00.000Z',
    },
    workspaceId,
    archiveSha256: 'b'.repeat(64),
    manifest: {
      totalBytes: 4,
      entries: [{ path: 'src/main.ts', byteSize: 4, mediaType: 'text/plain' }],
    },
    digests: [{ path: 'src/main.ts', algorithm: 'sha256', hexDigest: 'a'.repeat(64), byteSize: 4 }],
  };
}

function authenticatedRequest(contentType = 'application/zip') {
  return {
    userId: actorId,
    header(name: string) { return name.toLowerCase() === 'content-type' ? contentType : undefined; },
  } as never;
}

async function expectHttpError(
  action: Promise<unknown>,
  status: number,
  problemCode: string,
): Promise<EvidenceUploadHttpError> {
  let thrown: unknown;
  try {
    await action;
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof EvidenceUploadHttpError);
  assert.equal(thrown.getStatus(), status);
  assert.equal(thrown.problemCode, problemCode);
  return thrown;
}

function renderProblem(error: EvidenceUploadHttpError): {
  readonly status: number;
  readonly contentType: string | undefined;
  readonly body: { readonly code: string; readonly detail: string; readonly status: number };
} {
  let status = 0;
  let contentType: string | undefined;
  let body: { code: string; detail: string; status: number } | undefined;
  const response = {
    getHeader() { return 'request-id'; },
    status(value: number) { status = value; return this; },
    type(value: string) { contentType = value; return this; },
    json(value: typeof body) { body = value; return this; },
  };
  const host = {
    switchToHttp() {
      return { getRequest: () => ({ path: `/v1/workspaces/${workspaceId}/evidence/archives` }), getResponse: () => response };
    },
  } as unknown as ArgumentsHost;
  new ProblemDetailsFilter().catch(error, host);
  assert.ok(body);
  return { status, contentType, body };
}

function createZip(path: string, content: Uint8Array): Buffer {
  const name = Buffer.from(path);
  const data = Buffer.from(content);
  const crc = crc32(data);
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);

  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x0314, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  name.copy(central, 46);
  const directoryOffset = local.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(directoryOffset, 16);
  return Buffer.concat([local, data, central, end]);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
