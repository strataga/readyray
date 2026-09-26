import { describe, expect, test } from "bun:test";
import { CreateWorkspace } from "../dist/modules/workspaces/application/create-workspace.use-case.js";
import { ListWorkspaces } from "../dist/modules/workspaces/application/list-workspaces.use-case.js";
import type { WorkspaceRepository } from "../dist/modules/workspaces/application/workspace-repository.port.js";
import type { UserId } from "../dist/modules/identity/domain/user.js";
import { WorkspaceInputError, type Workspace, type WorkspaceId } from "../dist/modules/workspaces/domain/workspace.js";

describe("workspace application use cases", () => {
  test("normalizes the name and passes the authenticated creator as the owner", async () => {
    const repository = new MemoryWorkspaces();
    const create = new CreateWorkspace(repository);

    const workspace = await create.execute("  Platform Engineering  ", "owner-1" as UserId);

    expect(workspace.name).toBe("Platform Engineering");
    expect(repository.ownerOf(workspace.id)).toBe("owner-1");
    expect(repository.createdNames).toEqual(["Platform Engineering"]);
  });

  test("rejects blank or overlong names before creating a workspace", async () => {
    const repository = new MemoryWorkspaces();
    const create = new CreateWorkspace(repository);

    await expectWorkspaceError(() => create.execute(" \t\n ", "owner-1" as UserId));
    await expectWorkspaceError(() => create.execute("x".repeat(121), "owner-1" as UserId));

    expect(repository.createdNames).toHaveLength(0);
  });

  test("lists only memberships for the caller supplied to the use case", async () => {
    const repository = new MemoryWorkspaces();
    const create = new CreateWorkspace(repository);
    const list = new ListWorkspaces(repository);
    const owned = await create.execute("Owned workspace", "owner-1" as UserId);
    const other = await create.execute("Other workspace", "owner-2" as UserId);

    await expect(list.execute("owner-1" as UserId)).resolves.toEqual([owned]);
    await expect(list.execute("owner-2" as UserId)).resolves.toEqual([other]);
    await expect(list.execute("stranger" as UserId)).resolves.toEqual([]);
  });
});

class MemoryWorkspaces implements WorkspaceRepository {
  private readonly workspaces: Workspace[] = [];
  private readonly owners = new Map<WorkspaceId, UserId>();
  readonly createdNames: string[] = [];

  async createOwned(name: string, ownerId: UserId): Promise<Workspace> {
    this.createdNames.push(name);
    const workspace: Workspace = {
      id: `workspace-${this.workspaces.length + 1}` as WorkspaceId,
      name,
      createdAt: new Date(),
    };
    this.workspaces.push(workspace);
    this.owners.set(workspace.id, ownerId);
    return workspace;
  }

  async findByIdForMember(id: WorkspaceId, memberId: UserId): Promise<Workspace | undefined> {
    const workspace = this.workspaces.find((candidate) => candidate.id === id);
    return workspace && this.owners.get(id) === memberId ? workspace : undefined;
  }

  async listForMember(memberId: UserId): Promise<readonly Workspace[]> {
    return this.workspaces.filter((workspace) => this.owners.get(workspace.id) === memberId);
  }

  ownerOf(id: WorkspaceId): UserId | undefined {
    return this.owners.get(id);
  }
}

async function expectWorkspaceError(action: () => Promise<unknown>): Promise<void> {
  let thrown: unknown;
  try {
    await action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(WorkspaceInputError);
}
