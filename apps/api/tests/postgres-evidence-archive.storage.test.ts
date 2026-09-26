import { createHash } from 'node:crypto';
import { describe, expect, it } from 'bun:test';
import { PostgresEvidenceArchiveStorage } from '../dist/persistence/postgres/postgres-evidence-archive.storage.js';

const workspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const intakeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const archiveBytes = Buffer.from('zip archive bytes');

function inventoryRow() {
  return {
    workspace_id: workspaceId,
    intake_id: intakeId,
    archive_sha256: 'a'.repeat(64),
    accepted_metadata: {
      status: 'accepted',
      intakeId,
      workspaceId,
      intake: {
        id: intakeId,
        status: 'accepted',
        createdAt: '2026-09-25T12:00:00.000Z',
        updatedAt: '2026-09-25T12:00:01.000Z',
      },
    },
    manifest: { entries: [{ path: 'src/main.ts', byteSize: 3 }], totalBytes: 3 },
    digests: [{ path: 'src/main.ts', algorithm: 'sha256', hexDigest: 'c'.repeat(64), byteSize: 3 }],
  };
}

function acceptedArchive(bytes: Uint8Array = archiveBytes) {
  return {
    workspaceId,
    archiveBytes: bytes,
    intake: {
      status: 'accepted' as const,
      workspaceId,
      archiveSha256: createHash('sha256').update(bytes).digest('hex'),
      intake: {
        id: intakeId,
        status: 'accepted' as const,
        createdAt: '2026-09-25T12:00:00.000Z',
        updatedAt: '2026-09-25T12:00:01.000Z',
      },
      manifest: { entries: [{ path: 'src/main.ts', byteSize: 3 }], totalBytes: 3 },
      digests: [{ path: 'src/main.ts', algorithm: 'sha256' as const, hexDigest: 'c'.repeat(64), byteSize: 3 }],
    },
  };
}

describe('PostgresEvidenceArchiveStorage', () => {
  it('copies bytes and resolves only after its single atomic INSERT completes', async () => {
    const source = Buffer.from(archiveBytes);
    let capturedSql = '';
    let capturedValues: readonly unknown[] = [];
    let queryCount = 0;
    let releaseInsert!: () => void;
    const insertGate = new Promise<void>((resolve) => { releaseInsert = resolve; });
    const storage = new PostgresEvidenceArchiveStorage({
      query: async (sql: string, values: unknown[]) => {
        queryCount += 1;
        capturedSql = sql;
        capturedValues = values;
        await insertGate;
        return { rows: [], rowCount: 1 };
      },
    } as never);

    let resolved = false;
    const pending = storage.storeAcceptedArchive(acceptedArchive(source)).then(() => { resolved = true; });
    expect(capturedSql).toContain('INSERT INTO evidence_archives');
    expect(capturedValues).toHaveLength(8);
    expect(capturedValues[3]).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(capturedValues[3] as Uint8Array)).toEqual(archiveBytes);
    source.fill(0);
    expect(Buffer.from(capturedValues[3] as Uint8Array)).toEqual(archiveBytes);
    expect(resolved).toBe(false);

    releaseInsert();
    await pending;
    expect(resolved).toBe(true);
    expect(queryCount).toBe(1);
    expect(JSON.parse(capturedValues[4] as string)).toMatchObject({ status: 'accepted', intakeId, workspaceId });
    expect(JSON.parse(capturedValues[5] as string)).toMatchObject({ totalBytes: 3 });
    expect(JSON.parse(capturedValues[6] as string)[0]).toMatchObject({ algorithm: 'sha256', path: 'src/main.ts' });
  });

  it('maps duplicate intake IDs to a safe stable error without retaining PostgreSQL details', async () => {
    const storage = new PostgresEvidenceArchiveStorage({
      query: async () => { throw Object.assign(new Error('duplicate key with private detail'), { code: '23505' }); },
    } as never);

    await expect(storage.storeAcceptedArchive(acceptedArchive())).rejects.toMatchObject({
      name: 'EvidenceArchiveStorageError',
      code: 'duplicate_id',
      message: 'Evidence archive storage failed (duplicate_id).',
    });
  });

  it('rejects mismatched archive digests before persistence with no diagnostic detail', async () => {
    let queryCalled = false;
    const storage = new PostgresEvidenceArchiveStorage({
      query: async () => { queryCalled = true; return { rows: [], rowCount: 1 }; },
    } as never);
    const invalid = acceptedArchive();
    invalid.intake.archiveSha256 = '0'.repeat(64);

    await expect(storage.storeAcceptedArchive(invalid)).rejects.toMatchObject({
      name: 'EvidenceArchiveStorageError',
      code: 'invalid_input',
    });
    expect(queryCalled).toBe(false);
  });

  it('returns validated accepted inventory scoped to workspace and intake without selecting archive bytes', async () => {
    let capturedSql = '';
    let capturedValues: readonly unknown[] = [];
    const storage = new PostgresEvidenceArchiveStorage({
      query: async (sql: string, values: unknown[]) => {
        capturedSql = sql;
        capturedValues = values;
        return { rows: [inventoryRow()], rowCount: 1 };
      },
    } as never);

    const inventory = await storage.findAcceptedArchive({ workspaceId, intakeId });

    expect(inventory).toMatchObject({
      status: 'accepted',
      workspaceId,
      archiveSha256: 'a'.repeat(64),
      intake: { id: intakeId, status: 'accepted' },
      manifest: { totalBytes: 3 },
      digests: [{ algorithm: 'sha256', path: 'src/main.ts', byteSize: 3 }],
    });
    expect(capturedValues).toEqual([workspaceId, intakeId]);
    expect(capturedSql).toContain('workspace_id = $1 AND intake_id = $2');
    expect(capturedSql).toContain('accepted_metadata, manifest, digests');
    expect(capturedSql).not.toMatch(/archive_bytes/i);
    expect(inventory).not.toHaveProperty('archiveBytes');
    expect(inventory?.intake).not.toHaveProperty('workspaceId');
  });

  it('returns undefined when the scoped accepted archive row is absent', async () => {
    const storage = new PostgresEvidenceArchiveStorage({
      query: async () => ({ rows: [], rowCount: 0 }),
    } as never);

    await expect(storage.findAcceptedArchive({ workspaceId, intakeId })).resolves.toBeUndefined();
  });

  it('turns malformed stored inventory JSON into a generic storage error', async () => {
    const row = inventoryRow();
    row.manifest = { entries: 'private malformed row', totalBytes: 3 };
    const storage = new PostgresEvidenceArchiveStorage({
      query: async () => ({ rows: [row], rowCount: 1 }),
    } as never);

    await expect(storage.findAcceptedArchive({ workspaceId, intakeId })).rejects.toMatchObject({
      name: 'EvidenceArchiveStorageError',
      code: 'storage_failed',
      message: 'Evidence archive storage failed (storage_failed).',
    });
  });
});
