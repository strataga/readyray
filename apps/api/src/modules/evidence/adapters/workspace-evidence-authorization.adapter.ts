import { Inject, Injectable } from '@nestjs/common';
import type { WorkspaceEvidenceAuthorizationPort } from '@archgauge/evidence/application';
import type { UserId } from '../../identity/domain/user.js';
import { WORKSPACE_REPOSITORY } from '../../workspaces/application/workspace-repository.port.js';
import type { WorkspaceRepository } from '../../workspaces/application/workspace-repository.port.js';
import type { WorkspaceId } from '../../workspaces/domain/workspace.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class WorkspaceEvidenceAuthorizationAdapter implements WorkspaceEvidenceAuthorizationPort {
  constructor(@Inject(WORKSPACE_REPOSITORY) private readonly workspaces: WorkspaceRepository) {}

  async canIngestEvidence(input: { readonly actorId: string; readonly workspaceId: string }): Promise<boolean> {
    if (!UUID_PATTERN.test(input.workspaceId)) {
      return false;
    }
    const workspace = await this.workspaces.findByIdForMember(
      input.workspaceId as WorkspaceId,
      input.actorId as UserId,
    );
    return workspace !== undefined;
  }
}
