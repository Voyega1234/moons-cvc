import type { WorkspaceState } from "../../features/workflow/model";
import type {
  WorkspaceCheckpoint,
  WorkspaceCheckpointReason,
  WorkspaceRepository
} from "../../ports/workspace-repository";

/** Uses shared cloud state as the source of truth and local state only for migration. */
export class CloudFirstWorkspaceRepository implements WorkspaceRepository {
  private localCleanupAttempted = false;

  constructor(
    private readonly local: WorkspaceRepository,
    private readonly remote: WorkspaceRepository
  ) {}

  async load(): Promise<WorkspaceState | null> {
    let remoteWorkspace: WorkspaceState | null;
    try {
      remoteWorkspace = await this.remote.load();
    } catch {
      // One immediate retry covers short-lived auth/network startup failures.
      // If it still fails, do not expose stale local state as editable because
      // WorkspaceProvider would autosave it back over an unknown cloud state.
      remoteWorkspace = await this.remote.load();
    }
    if (remoteWorkspace) {
      await this.discardLocalCache();
      return remoteWorkspace;
    }
    return this.local.load();
  }

  async save(workspace: WorkspaceState): Promise<void> {
    await this.remote.save(workspace);
    await this.discardLocalCache();
  }

  async clear(): Promise<void> {
    await this.remote.clear();
    try {
      await this.local.clear();
    } catch {
      // Cloud state is authoritative; local cleanup must not report a cloud failure.
    }
  }

  async createCheckpoint(
    workspace: WorkspaceState,
    runId: string,
    reason: WorkspaceCheckpointReason
  ): Promise<WorkspaceCheckpoint> {
    if (!this.remote.createCheckpoint) {
      throw new Error("Recovery points are unavailable.");
    }
    return this.remote.createCheckpoint(workspace, runId, reason);
  }

  async listCheckpoints(
    runId: string
  ): Promise<readonly WorkspaceCheckpoint[]> {
    try {
      if (this.remote.listCheckpoints) {
        return await this.remote.listCheckpoints(runId);
      }
    } catch {
      // Keep recovery available from this browser if the cloud is offline.
    }
    return (await this.local.listCheckpoints?.(runId)) ?? [];
  }

  async restoreCheckpoint(
    workspace: WorkspaceState,
    runId: string,
    checkpointId: string
  ): Promise<WorkspaceState> {
    if (checkpointId.startsWith("checkpoint-") && this.local.restoreCheckpoint) {
      return this.local.restoreCheckpoint(workspace, runId, checkpointId);
    }
    if (!this.remote.restoreCheckpoint) {
      if (!this.local.restoreCheckpoint) {
        throw new Error("Recovery points are unavailable.");
      }
      return this.local.restoreCheckpoint(workspace, runId, checkpointId);
    }
    const restored = await this.remote.restoreCheckpoint(
      workspace,
      runId,
      checkpointId
    );
    return restored;
  }

  private async discardLocalCache(): Promise<void> {
    if (this.localCleanupAttempted) return;
    this.localCleanupAttempted = true;
    try {
      await this.local.clear();
    } catch {
      // A full or unavailable browser cache must not block verified cloud state.
    }
  }
}
