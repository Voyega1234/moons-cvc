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
  it("prefers shared cloud state and refreshes the local cache", async () => {
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
    expect(local.save).toHaveBeenCalledWith(shared);
  });

  it("uses the local cache when shared state cannot be loaded", async () => {
    const cached = createInitialWorkspaceState({
      runId: "cached",
      now: "2026-07-16T10:00:00Z"
    });
    const local = repository(cached);
    const remote = repository();
    vi.mocked(remote.load).mockRejectedValue(new Error("offline"));

    await expect(
      new CloudFirstWorkspaceRepository(local, remote).load()
    ).resolves.toEqual(cached);
  });
});
