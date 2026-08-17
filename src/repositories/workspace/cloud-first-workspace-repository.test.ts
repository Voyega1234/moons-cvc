import { describe, expect, it, vi } from "vitest";
import { createInitialWorkspaceState } from "../../features/workflow/workspace-reducer";
import type { WorkspaceRepository } from "../../ports/workspace-repository";
import { CloudFirstWorkspaceRepository } from "./cloud-first-workspace-repository";

function repository(
  loaded: Awaited<ReturnType<WorkspaceRepository["load"]>> = null
): WorkspaceRepository {
  return {
    load: vi.fn(async () => loaded),
    save: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined)
  };
}

describe("CloudFirstWorkspaceRepository", () => {
  it("loads shared cloud state first and discards the local migration cache", async () => {
    const local = repository(
      createInitialWorkspaceState({ runId: "local", now: "2026-07-16T10:00:00Z" })
    );
    const shared = createInitialWorkspaceState({
      runId: "shared",
      now: "2026-07-16T11:00:00Z"
    });
    const remote = repository(shared);

    const result = await new CloudFirstWorkspaceRepository(local, remote).load();

    expect(result?.activeRunId).toBe("shared");
    expect(local.load).not.toHaveBeenCalled();
    expect(local.save).not.toHaveBeenCalled();
    expect(local.clear).toHaveBeenCalledOnce();
  });

  it("loads legacy local state only when the cloud has no workspace", async () => {
    const cached = createInitialWorkspaceState({
      runId: "cached",
      now: "2026-07-16T10:00:00Z"
    });
    const local = repository(cached);
    const remote = repository();

    const result = await new CloudFirstWorkspaceRepository(local, remote).load();

    expect(result?.activeRunId).toBe("cached");
    expect(local.load).toHaveBeenCalledOnce();
  });

  it("loads the latest cloud state without falling back to stale local state", async () => {
    const cached = createInitialWorkspaceState({
      runId: "cached",
      now: "2026-07-16T10:00:00Z"
    });
    const latest = createInitialWorkspaceState({
      runId: "latest",
      now: "2026-07-16T11:00:00Z"
    });
    const local = repository(cached);
    const remote = {
      ...repository(),
      loadLatest: vi.fn(async () => latest)
    };

    const result = await new CloudFirstWorkspaceRepository(
      local,
      remote
    ).loadLatest();

    expect(result?.activeRunId).toBe("latest");
    expect(remote.loadLatest).toHaveBeenCalledOnce();
    expect(remote.load).not.toHaveBeenCalled();
    expect(local.load).not.toHaveBeenCalled();
  });

  it("returns an empty cloud reload without reopening the local cache", async () => {
    const local = repository(
      createInitialWorkspaceState({
        runId: "cached",
        now: "2026-07-16T10:00:00Z"
      })
    );
    const remote = repository();

    const result = await new CloudFirstWorkspaceRepository(
      local,
      remote
    ).loadLatest();

    expect(result).toBeNull();
    expect(local.load).not.toHaveBeenCalled();
  });

  it("does not expose the local cache as editable when cloud state cannot be verified", async () => {
    const cached = createInitialWorkspaceState({
      runId: "cached",
      now: "2026-07-16T10:00:00Z"
    });
    const local = repository(cached);
    const remote = repository();
    vi.mocked(remote.load).mockRejectedValue(new Error("offline"));

    await expect(
      new CloudFirstWorkspaceRepository(local, remote).load()
    ).rejects.toThrow("offline");
    expect(remote.load).toHaveBeenCalledTimes(2);
    expect(local.load).not.toHaveBeenCalled();
  });

  it("saves to the cloud when local storage cleanup fails", async () => {
    const workspace = createInitialWorkspaceState({
      runId: "shared",
      now: "2026-07-16T11:00:00Z"
    });
    const local = repository();
    vi.mocked(local.clear).mockRejectedValue(new Error("quota exceeded"));
    const remote = repository();

    await expect(
      new CloudFirstWorkspaceRepository(local, remote).save(workspace)
    ).resolves.toBeUndefined();

    expect(remote.save).toHaveBeenCalledWith(workspace);
    expect(local.save).not.toHaveBeenCalled();
  });

  it("creates recovery points in the cloud without duplicating local snapshots", async () => {
    const workspace = createInitialWorkspaceState({
      runId: "shared",
      now: "2026-07-16T11:00:00Z"
    });
    const local = {
      ...repository(),
      createCheckpoint: vi.fn(async () => {
        throw new Error("quota exceeded");
      })
    };
    const checkpoint = {
      id: "remote-checkpoint",
      runId: "shared",
      reason: "regenerate" as const,
      createdAt: "2026-07-16T12:00:00Z",
      createdBy: "You",
      sourceVersion: 1
    };
    const remote = {
      ...repository(),
      createCheckpoint: vi.fn(async () => checkpoint)
    };

    await expect(
      new CloudFirstWorkspaceRepository(local, remote).createCheckpoint(
        workspace,
        "shared",
        "regenerate"
      )
    ).resolves.toEqual(checkpoint);

    expect(remote.createCheckpoint).toHaveBeenCalledOnce();
    expect(local.createCheckpoint).not.toHaveBeenCalled();
  });
});
