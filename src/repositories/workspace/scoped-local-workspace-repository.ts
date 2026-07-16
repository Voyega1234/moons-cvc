import type { WorkspaceState } from "../../features/workflow/model";
import type { WorkspaceRepository } from "../../ports/workspace-repository";
import {
  DEFAULT_WORKSPACE_STORAGE_KEY,
  LocalWorkspaceRepository,
  type StorageLike
} from "./local-workspace-repository";

/** Keeps local workspace data separated when multiple users share a browser. */
export class ScopedLocalWorkspaceRepository implements WorkspaceRepository {
  constructor(
    private readonly storage: StorageLike,
    private readonly getScope: () => Promise<string>,
    private readonly storageKey = DEFAULT_WORKSPACE_STORAGE_KEY,
    private readonly getNow = () => new Date().toISOString()
  ) {}

  async load(): Promise<WorkspaceState | null> {
    return (await this.repository()).load();
  }

  async save(workspace: WorkspaceState): Promise<void> {
    await (await this.repository()).save(workspace);
  }

  async clear(): Promise<void> {
    await (await this.repository()).clear();
  }

  private async repository(): Promise<LocalWorkspaceRepository> {
    const scope = await this.getScope();
    if (!scope.trim()) throw new Error("Workspace storage scope is missing.");
    return new LocalWorkspaceRepository(
      this.storage,
      `${this.storageKey}.${scope}`,
      this.getNow
    );
  }
}
