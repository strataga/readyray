import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import {
  createEvidenceDigestRecord,
  createEvidenceIntake,
  createEvidenceManifest,
  transitionEvidenceIntake,
} from '@archgauge/evidence/domain';
import type {
  AcceptedEvidenceArchiveIntake,
  EvidenceArchiveInventoryReadPort,
  EvidenceArchiveStoragePort,
  StoreAcceptedEvidenceArchive,
} from '@archgauge/evidence/application';
import { POSTGRES_POOL } from './postgres.tokens.js';

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 250 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 5_000;
const MAX_PATH_CHARACTERS = 4_096;
const MAX_MEDIA_TYPE_CHARACTERS = 255;

export type EvidenceArchiveStorageErrorCode = 'invalid_input' | 'duplicate_id' | 'storage_failed';

/** A persistence failure with no database or evidence content attached. */
export class EvidenceArchiveStorageError extends Error {
  constructor(readonly code: EvidenceArchiveStorageErrorCode) {
    super(`Evidence archive storage failed (${code}).`);
    this.name = 'EvidenceArchiveStorageError';
  }
}

interface PreparedArchive {
  readonly intakeId: string;
  readonly workspaceId: string;
  readonly archiveSha256: string;
  readonly archiveBytes: Buffer;
  readonly acceptedMetadata: string;
  readonly manifest: string;
  readonly digests: string;
  readonly acceptedAt: string;
}

interface EvidenceArchiveInventoryRow {
  readonly workspace_id: unknown;
  readonly intake_id: unknown;
  readonly archive_sha256: unknown;
  readonly accepted_metadata: unknown;
  readonly manifest: unknown;
  readonly digests: unknown;
}

/** Persists one complete accepted snapshot with one atomic PostgreSQL INSERT. */
@Injectable()
export class PostgresEvidenceArchiveStorage implements EvidenceArchiveStoragePort, EvidenceArchiveInventoryReadPort {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async storeAcceptedArchive(input: StoreAcceptedEvidenceArchive): Promise<void> {
    let archiveSnapshot: Buffer | undefined;
    try {
      if (!(input?.archiveBytes instanceof Uint8Array)) {
        throw new EvidenceArchiveStorageError('invalid_input');
      }
      archiveSnapshot = Buffer.from(input.archiveBytes);
      const prepared = prepareArchive(input, archiveSnapshot);
      await this.pool.query(
        `INSERT INTO evidence_archives
          (intake_id, workspace_id, archive_sha256, archive_bytes, accepted_metadata, manifest, digests, accepted_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8)`,
        [
          prepared.intakeId,
          prepared.workspaceId,
          prepared.archiveSha256,
          prepared.archiveBytes,
          prepared.acceptedMetadata,
          prepared.manifest,
          prepared.digests,
          prepared.acceptedAt,
        ],
      );
    } catch (error) {
      if (error instanceof EvidenceArchiveStorageError) {
        throw error;
      }
      if (hasPostgresCode(error, '23505')) {
        throw new EvidenceArchiveStorageError('duplicate_id');
      }
      throw new EvidenceArchiveStorageError('storage_failed');
    } finally {
      archiveSnapshot?.fill(0);
    }
  }

  async findAcceptedArchive(input: {
    readonly workspaceId: string;
    readonly intakeId: string;
  }): Promise<AcceptedEvidenceArchiveIntake | undefined> {
    try {
      if (!input || !isUuid(input.workspaceId) || !isUuid(input.intakeId)) {
        throw new EvidenceArchiveStorageError('invalid_input');
      }
      const workspaceId = input.workspaceId.toLowerCase();
      const intakeId = input.intakeId.toLowerCase();
      const result = await this.pool.query<EvidenceArchiveInventoryRow>(
        `SELECT workspace_id, intake_id, archive_sha256, accepted_metadata, manifest, digests
         FROM evidence_archives
         WHERE workspace_id = $1 AND intake_id = $2`,
        [workspaceId, intakeId],
      );
      const row = result.rows[0];
      return row ? mapInventoryRow(row, workspaceId, intakeId) : undefined;
    } catch (error) {
      if (error instanceof EvidenceArchiveStorageError) {
        throw error;
      }
      throw new EvidenceArchiveStorageError('storage_failed');
    }
  }
}

function mapInventoryRow(
  row: EvidenceArchiveInventoryRow,
  expectedWorkspaceId: string,
  expectedIntakeId: string,
): AcceptedEvidenceArchiveIntake {
  try {
    if (row.workspace_id !== expectedWorkspaceId || row.intake_id !== expectedIntakeId ||
      typeof row.archive_sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(row.archive_sha256)) {
      throw new Error();
    }
    const metadata = parseJsonbObject(row.accepted_metadata);
    if (metadata.status !== 'accepted' || metadata.intakeId !== expectedIntakeId ||
      metadata.workspaceId !== expectedWorkspaceId) {
      throw new Error();
    }
    const intakeMetadata = asRecord(metadata.intake);
    if (intakeMetadata.status !== 'accepted' || intakeMetadata.id !== expectedIntakeId ||
      Object.hasOwn(intakeMetadata, 'rejectionCode') ||
      typeof intakeMetadata.createdAt !== 'string' || typeof intakeMetadata.updatedAt !== 'string') {
      throw new Error();
    }
    const received = createEvidenceIntake(expectedIntakeId, intakeMetadata.createdAt);
    const validating = transitionEvidenceIntake(received, 'validating', intakeMetadata.updatedAt);
    const intake = transitionEvidenceIntake(validating, 'accepted', intakeMetadata.updatedAt) as
      ReturnType<typeof transitionEvidenceIntake> & { readonly status: 'accepted' };

    const storedManifest = parseJsonbObject(row.manifest);
    const manifest = createEvidenceManifest(storedManifest.entries as Parameters<typeof createEvidenceManifest>[0], {
      maxEntries: MAX_ARCHIVE_ENTRIES,
      maxTotalBytes: MAX_EXPANDED_BYTES,
      maxPathCharacters: MAX_PATH_CHARACTERS,
      maxMediaTypeCharacters: MAX_MEDIA_TYPE_CHARACTERS,
    });
    if (storedManifest.totalBytes !== manifest.totalBytes) {
      throw new Error();
    }
    const storedDigests = parseJsonbArray(row.digests);
    if (storedDigests.length !== manifest.entries.length) {
      throw new Error();
    }
    const digests = storedDigests.map((value, index) => {
      const digest = createEvidenceDigestRecord(asRecord(value) as unknown as Parameters<typeof createEvidenceDigestRecord>[0]);
      const entry = manifest.entries[index];
      if (!entry || digest.path !== entry.path || digest.byteSize !== entry.byteSize) {
        throw new Error();
      }
      return digest;
    });

    return Object.freeze({
      status: 'accepted',
      intake,
      workspaceId: expectedWorkspaceId,
      archiveSha256: row.archive_sha256,
      manifest,
      digests: Object.freeze(digests),
    });
  } catch {
    throw new EvidenceArchiveStorageError('storage_failed');
  }
}

function parseJsonbObject(value: unknown): Record<string, unknown> {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  return asRecord(parsed);
}

function parseJsonbArray(value: unknown): unknown[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed)) {
    throw new Error();
  }
  return parsed;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error();
  }
  return value as Record<string, unknown>;
}

function prepareArchive(input: StoreAcceptedEvidenceArchive, archiveSnapshot: Buffer): PreparedArchive {
  try {
    if (!input || typeof input !== 'object' || !isUuid(input.workspaceId) ||
      input.workspaceId !== input.intake?.workspaceId ||
      !(input.archiveBytes instanceof Uint8Array) || input.archiveBytes.byteLength < 1 ||
      input.archiveBytes.byteLength > MAX_ARCHIVE_BYTES || archiveSnapshot.byteLength !== input.archiveBytes.byteLength) {
      throw new Error();
    }

    const intakeResult = input.intake;
    const intake = intakeResult.intake;
    if (intakeResult.status !== 'accepted' || !intake || intake.status !== 'accepted' ||
      !isUuid(intake.id) || intake.rejectionCode !== undefined) {
      throw new Error();
    }
    const received = createEvidenceIntake(intake.id, intake.createdAt);
    const validating = transitionEvidenceIntake(received, 'validating', intake.updatedAt);
    const accepted = transitionEvidenceIntake(validating, 'accepted', intake.updatedAt);

    const archiveSha256 = createHash('sha256').update(archiveSnapshot).digest('hex');
    if (intakeResult.archiveSha256 !== archiveSha256) {
      throw new Error();
    }

    const manifest = createEvidenceManifest(intakeResult.manifest.entries, {
      maxEntries: MAX_ARCHIVE_ENTRIES,
      maxTotalBytes: MAX_EXPANDED_BYTES,
      maxPathCharacters: MAX_PATH_CHARACTERS,
      maxMediaTypeCharacters: MAX_MEDIA_TYPE_CHARACTERS,
    });
    if (intakeResult.manifest.totalBytes !== manifest.totalBytes ||
      !Array.isArray(intakeResult.digests) || intakeResult.digests.length !== manifest.entries.length) {
      throw new Error();
    }
    const digests = intakeResult.digests.map((digest, index) => {
      const normalized = createEvidenceDigestRecord(digest);
      const entry = manifest.entries[index];
      if (!entry || normalized.path !== entry.path || normalized.byteSize !== entry.byteSize) {
        throw new Error();
      }
      return normalized;
    });

    const acceptedMetadata = {
      status: 'accepted',
      intakeId: accepted.id,
      workspaceId: input.workspaceId,
      intake: {
        id: accepted.id,
        status: accepted.status,
        createdAt: accepted.createdAt,
        updatedAt: accepted.updatedAt,
      },
    };
    return {
      intakeId: accepted.id,
      workspaceId: input.workspaceId,
      archiveSha256,
      archiveBytes: archiveSnapshot,
      acceptedMetadata: JSON.stringify(acceptedMetadata),
      manifest: JSON.stringify(manifest),
      digests: JSON.stringify(digests),
      acceptedAt: accepted.updatedAt,
    };
  } catch {
    throw new EvidenceArchiveStorageError('invalid_input');
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
}

function hasPostgresCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
