import type { WorkspaceState } from "../../features/workflow/model";
import type { WorkspaceRepository } from "../../ports/workspace-repository";

/** Uses shared cloud state when available and keeps a per-user local fallback. */
export class CloudFirstWorkspaceRepository implements WorkspaceRepository {
  constructor(
    private readonly local: WorkspaceRepository,
    private readonly remote: WorkspaceRepository
  ) {}

  async load(): Promise<WorkspaceState | null> {
    const localWorkspace = await this.local.load();
    try {
      const remoteWorkspace = await this.remote.load();
      if (remoteWorkspace) {
        await this.local.save(remoteWorkspace);
        return remoteWorkspace;
      }
      return localWorkspace;
    } catch (error) {
      if (localWorkspace) return localWorkspace;
      throw error;
    }
  }

  async save(workspace: WorkspaceState): Promise<void> {
    await this.local.save(workspace);
    await this.remote.save(workspace);
  }

  async clear(): Promise<void> {
    await this.local.clear();
    await this.remote.clear();
  }
}
