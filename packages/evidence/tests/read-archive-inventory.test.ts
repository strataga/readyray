import { describe, expect, test } from 'bun:test';
import {
  EvidenceArchiveInventoryError,
  EvidenceArchiveInventoryErrorCode,
  getEvidenceArchiveInventory,
} from '../application/read-archive-inventory.js';

const workspaceId = '15bbec55-254c-4ed8-871e-448c89b3ccda';
const intakeId = '67c76dcb-7084-4bca-bf4c-fdf877582c21';
const actorId = '5fb955ee-c022-4485-a842-e1b923029d4d';

const accepted = {
  status: 'accepted' as const,
  intake: {
    id: intakeId,
    status: 'accepted' as const,
    createdAt: '2026-09-26T00:00:00.000Z',
    updatedAt: '2026-09-26T00:00:02.000Z',
  },
  workspaceId,
  archiveSha256: 'a'.repeat(64),
  manifest: {
    entries: [{ path: 'src/main.ts' as never, byteSize: 12 }],
    totalBytes: 12,
  },
  digests: [{ path: 'src/main.ts' as never, algorithm: 'sha256' as const, hexDigest: 'b'.repeat(64), byteSize: 12 }],
};

describe('getEvidenceArchiveInventory', () => {
  test('authorizes before looking up accepted metadata', async () => {
    let reads = 0;
    let thrown: unknown;
    try {
      await getEvidenceArchiveInventory({ actorId, workspaceId, intakeId }, {
        async canIngestEvidence() { return false; },
      }, {
        async findAcceptedArchive() { reads += 1; return accepted; },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(EvidenceArchiveInventoryError);
    expect(thrown).toMatchObject({ code: EvidenceArchiveInventoryErrorCode.WORKSPACE_FORBIDDEN });
    expect(reads).toBe(0);
  });

  test('returns only accepted metadata for the authorized workspace and intake', async () => {
    const requested: string[] = [];
    const result = await getEvidenceArchiveInventory({ actorId, workspaceId, intakeId }, {
      async canIngestEvidence(input) { requested.push(input.actorId, input.workspaceId); return true; },
    }, {
      async findAcceptedArchive(input) { requested.push(input.workspaceId, input.intakeId); return accepted; },
    });
    expect(requested).toEqual([actorId, workspaceId, workspaceId, intakeId]);
    expect(result).toEqual(accepted);
    expect(JSON.stringify(result)).not.toContain('archiveBytes');
  });

  test('rejects invalid identifiers before authorization or storage access', async () => {
    let calls = 0;
    let thrown: unknown;
    try {
      await getEvidenceArchiveInventory({ actorId, workspaceId, intakeId: 'bad-id' }, {
        async canIngestEvidence() { calls += 1; return true; },
      }, {
        async findAcceptedArchive() { calls += 1; return accepted; },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: EvidenceArchiveInventoryErrorCode.INVALID_INPUT });
    expect(calls).toBe(0);
  });

  test('returns a stable not-found error for absent accepted archives', async () => {
    let thrown: unknown;
    try {
      await getEvidenceArchiveInventory({ actorId, workspaceId, intakeId }, {
        async canIngestEvidence() { return true; },
      }, {
        async findAcceptedArchive() { return undefined; },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: EvidenceArchiveInventoryErrorCode.NOT_FOUND });
  });

  test('sanitizes authorization and storage failures', async () => {
    await expect(getEvidenceArchiveInventory({ actorId, workspaceId, intakeId }, {
      async canIngestEvidence() { throw new Error('database secret'); },
    }, {
      async findAcceptedArchive() { return accepted; },
    })).rejects.toMatchObject({ code: EvidenceArchiveInventoryErrorCode.AUTHORIZATION_UNAVAILABLE });
    await expect(getEvidenceArchiveInventory({ actorId, workspaceId, intakeId }, {
      async canIngestEvidence() { return true; },
    }, {
      async findAcceptedArchive() { throw new Error('database secret'); },
    })).rejects.toMatchObject({ code: EvidenceArchiveInventoryErrorCode.STORAGE_UNAVAILABLE });
  });
});
