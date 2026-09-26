import type { UserId } from '../../identity/domain/user.js';
import type { Workspace, WorkspaceId } from '../domain/workspace.js';

export const WORKSPACE_REPOSITORY = Symbol('WORKSPACE_REPOSITORY');

export interface WorkspaceRepository {
  createOwned(name: string, ownerId: UserId): Promise<Workspace>;
  findByIdForMember(id: WorkspaceId, memberId: UserId): Promise<Workspace | undefined>;
  listForMember(memberId: UserId): Promise<readonly Workspace[]>;
}
