import { describe, expect, it, vi } from "vitest";
import { createInitialWorkspaceState } from "../../features/workflow/workspace-reducer";
import type { WorkspaceRepository } from "../../ports/workspace-repository";
import { LocalFirstWorkspaceRepository } from "./local-first-workspace-repository";

function repository(
  loaded: Awaited<ReturnType<WorkspaceRepository["load"]>> = null
): WorkspaceRepository & {
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
} {
  return {
    load: vi.fn(async () => loaded),
    save: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined)
  };
}

describe("LocalFirstWorkspaceRepository", () => {
  it("restores the local session without waiting for the remote repository", async () => {
    const localWorkspace = createInitialWorkspaceState({
      runId: "local-run",
      now: "2026-07-16T08:00:00.000Z"
    });
    const local = repository(localWorkspace);
    const remote = repository();

    const result = await new LocalFirstWorkspaceRepository(local, remote).load();

    expect(result?.activeRunId).toBe("local-run");
    expect(remote.load).not.toHaveBeenCalled();
  });

  it("falls back to the cloud workspace once and caches it locally", async () => {
    const remoteWorkspace = createInitialWorkspaceState({
      runId: "remote-run",
      now: "2026-07-16T08:00:00.000Z"
    });
    const local = repository();
    const remote = repository(remoteWorkspace);

    const result = await new LocalFirstWorkspaceRepository(local, remote).load();

    expect(result?.activeRunId).toBe("remote-run");
    expect(local.save).toHaveBeenCalledWith(remoteWorkspace);
  });

  it("saves locally before syncing the same workspace to the cloud", async () => {
    const workspace = createInitialWorkspaceState({
      runId: "saved-run",
      now: "2026-07-16T08:00:00.000Z"
    });
    const calls: string[] = [];
    const local = repository();
    const remote = repository();
    local.save.mockImplementation(async () => {
      calls.push("local");
    });
    remote.save.mockImplementation(async () => {
      calls.push("remote");
    });

    await new LocalFirstWorkspaceRepository(local, remote).save(workspace);

    expect(calls).toEqual(["local", "remote"]);
  });
});
