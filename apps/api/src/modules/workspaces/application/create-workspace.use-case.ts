import { Inject, Injectable } from '@nestjs/common';
import { WORKSPACE_REPOSITORY } from './workspace-repository.port.js';
import type { WorkspaceRepository } from './workspace-repository.port.js';
import type { UserId } from '../../identity/domain/user.js';
import { normalizeWorkspaceName } from '../domain/workspace.js';

@Injectable()
export class CreateWorkspace {
  constructor(@Inject(WORKSPACE_REPOSITORY) private readonly workspaces: WorkspaceRepository) {}

  execute(name: string, ownerId: UserId) {
    return this.workspaces.createOwned(normalizeWorkspaceName(name), ownerId);
  }
}
