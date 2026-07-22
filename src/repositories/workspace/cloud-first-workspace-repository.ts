import type { WorkspaceState } from "../../features/workflow/model";
import type {
  WorkspaceCheckpoint,
  WorkspaceCheckpointReason,
  WorkspaceRepository
} from "../../ports/workspace-repository";

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

  async createCheckpoint(
    workspace: WorkspaceState,
    runId: string,
    reason: WorkspaceCheckpointReason
  ): Promise<WorkspaceCheckpoint> {
    const localCheckpoint = await this.local.createCheckpoint?.(
      workspace,
      runId,
      reason
    );
    if (!this.remote.createCheckpoint) {
      if (localCheckpoint) return localCheckpoint;
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
    await this.local.save(restored);
    return restored;
  }
}
