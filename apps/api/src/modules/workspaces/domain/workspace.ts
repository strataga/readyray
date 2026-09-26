export type WorkspaceId = string & { readonly __brand: 'WorkspaceId' };

export interface Workspace {
  readonly id: WorkspaceId;
  readonly name: string;
  readonly createdAt: Date;
}

export type WorkspaceRole = 'owner' | 'member';

export class WorkspaceInputError extends Error {
  constructor() {
    super('invalid_workspace_name');
    this.name = 'WorkspaceInputError';
  }
}

export function normalizeWorkspaceName(input: string): string {
  const name = input.trim();
  if (name.length < 1 || [...name].length > 120) {
    throw new WorkspaceInputError();
  }
  return name;
}
