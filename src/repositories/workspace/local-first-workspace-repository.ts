import type { WorkspaceState } from "../../features/workflow/model";
import type { WorkspaceRepository } from "../../ports/workspace-repository";

/**
 * Keeps refreshes fast and reliable while preserving the existing cloud backup.
 */
export class LocalFirstWorkspaceRepository implements WorkspaceRepository {
  constructor(
    private readonly local: WorkspaceRepository,
    private readonly remote: WorkspaceRepository
  ) {}

  async load(): Promise<WorkspaceState | null> {
    const localWorkspace = await this.local.load();
    if (localWorkspace) return localWorkspace;

    const remoteWorkspace = await this.remote.load();
    if (remoteWorkspace) await this.local.save(remoteWorkspace);
    return remoteWorkspace;
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
