import type { AcceptedEvidenceArchiveIntake, WorkspaceEvidenceAuthorizationPort } from './ingest-archive.js';

export interface EvidenceArchiveInventoryReadPort {
  findAcceptedArchive(input: {
    readonly workspaceId: string;
    readonly intakeId: string;
  }): Promise<AcceptedEvidenceArchiveIntake | undefined>;
}

export const EvidenceArchiveInventoryErrorCode = {
  INVALID_INPUT: 'invalid_input',
  WORKSPACE_FORBIDDEN: 'workspace_forbidden',
  AUTHORIZATION_UNAVAILABLE: 'authorization_unavailable',
  NOT_FOUND: 'not_found',
  STORAGE_UNAVAILABLE: 'storage_unavailable',
} as const;

export type EvidenceArchiveInventoryErrorCode =
  (typeof EvidenceArchiveInventoryErrorCode)[keyof typeof EvidenceArchiveInventoryErrorCode];

export class EvidenceArchiveInventoryError extends Error {
  constructor(readonly code: EvidenceArchiveInventoryErrorCode) {
    super(`Evidence archive inventory failed (${code}).`);
    this.name = 'EvidenceArchiveInventoryError';
  }
}

export interface GetEvidenceArchiveInventoryInput {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly intakeId: string;
}

/** Returns only accepted metadata and digests after proving workspace membership. */
export async function getEvidenceArchiveInventory(
  input: GetEvidenceArchiveInventoryInput,
  authorization: WorkspaceEvidenceAuthorizationPort,
  inventory: EvidenceArchiveInventoryReadPort,
): Promise<AcceptedEvidenceArchiveIntake> {
  if (!isUuid(input?.workspaceId) || !isUuid(input?.intakeId)) {
    throw new EvidenceArchiveInventoryError(EvidenceArchiveInventoryErrorCode.INVALID_INPUT);
  }

  let authorized: boolean;
  try {
    authorized = await authorization.canIngestEvidence({
      actorId: input.actorId,
      workspaceId: input.workspaceId,
    });
  } catch {
    throw new EvidenceArchiveInventoryError(EvidenceArchiveInventoryErrorCode.AUTHORIZATION_UNAVAILABLE);
  }
  if (!authorized) {
    throw new EvidenceArchiveInventoryError(EvidenceArchiveInventoryErrorCode.WORKSPACE_FORBIDDEN);
  }

  try {
    const result = await inventory.findAcceptedArchive({
      workspaceId: input.workspaceId,
      intakeId: input.intakeId,
    });
    if (!result) {
      throw new EvidenceArchiveInventoryError(EvidenceArchiveInventoryErrorCode.NOT_FOUND);
    }
    return result;
  } catch (error) {
    if (error instanceof EvidenceArchiveInventoryError) {
      throw error;
    }
    throw new EvidenceArchiveInventoryError(EvidenceArchiveInventoryErrorCode.STORAGE_UNAVAILABLE);
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
}
