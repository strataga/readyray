import { Inject, Injectable } from '@nestjs/common';
import { WORKSPACE_REPOSITORY } from './workspace-repository.port.js';
import type { WorkspaceRepository } from './workspace-repository.port.js';
import type { UserId } from '../../identity/domain/user.js';

@Injectable()
export class ListWorkspaces {
  constructor(@Inject(WORKSPACE_REPOSITORY) private readonly workspaces: WorkspaceRepository) {}

  execute(memberId: UserId) {
    return this.workspaces.listForMember(memberId);
  }
}
