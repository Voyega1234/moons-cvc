import { describe, expect, it } from "vitest";
import {
  createInitialWorkspaceState,
  getActiveRun
} from "../../features/workflow/workspace-reducer";
import { brands } from "../../data/mock-brands";
import { LocalWorkspaceRepository } from "./local-workspace-repository";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("LocalWorkspaceRepository", () => {
  it("saves and restores a workspace", async () => {
    const storage = new MemoryStorage();
    const repository = new LocalWorkspaceRepository(
      storage,
      "test.workspace",
      () => "2026-06-23T10:05:00.000Z"
    );
    const workspace = createInitialWorkspaceState({
      runId: "run-1",
      now: "2026-06-23T10:00:00.000Z"
    });

    await repository.save(workspace);

    expect((await repository.load())?.activeRunId).toBe("run-1");
  });

  it("removes corrupted persisted data and recovers with null", async () => {
    const storage = new MemoryStorage();
    storage.setItem("test.workspace", "broken");
    const repository = new LocalWorkspaceRepository(
      storage,
      "test.workspace"
    );

    expect(await repository.load()).toBeNull();
    expect(storage.getItem("test.workspace")).toBeNull();
  });

  it("clears persisted data", async () => {
    const storage = new MemoryStorage();
    storage.setItem("test.workspace", "value");
    const repository = new LocalWorkspaceRepository(
      storage,
      "test.workspace"
    );

    await repository.clear();

    expect(storage.getItem("test.workspace")).toBeNull();
  });

  it("keeps only the latest three recovery points for each project", async () => {
    const storage = new MemoryStorage();
    let tick = 0;
    const repository = new LocalWorkspaceRepository(
      storage,
      "test.workspace",
      () => `2026-07-20T10:0${tick++}:00.000Z`
    );
    const workspace = createInitialWorkspaceState({
      runId: "run-1",
      now: "2026-07-20T10:00:00.000Z"
    });

    await repository.createCheckpoint(workspace, "run-1", "regenerate");
    await repository.createCheckpoint(workspace, "run-1", "replace-image");
    await repository.createCheckpoint(workspace, "run-1", "send-to-qc");
    await repository.createCheckpoint(workspace, "run-1", "regenerate");

    const checkpoints = await repository.listCheckpoints("run-1");
    expect(checkpoints).toHaveLength(3);
    expect(checkpoints.map((item) => item.reason)).toEqual([
      "regenerate",
      "send-to-qc",
      "replace-image"
    ]);
  });

  it("restores one run without replacing the rest of the workspace", async () => {
    const storage = new MemoryStorage();
    const repository = new LocalWorkspaceRepository(
      storage,
      "test.workspace",
      () => "2026-07-20T10:05:00.000Z"
    );
    const original = createInitialWorkspaceState({
      runId: "run-1",
      now: "2026-07-20T10:00:00.000Z"
    });
    const checkpoint = await repository.createCheckpoint(
      original,
      "run-1",
      "regenerate"
    );
    const changed = {
      ...original,
      runsById: {
        ...original.runsById,
        "run-1": { ...getActiveRun(original), brief: "Changed brief" }
      }
    };

    const restored = await repository.restoreCheckpoint(
      changed,
      "run-1",
      checkpoint.id
    );

    expect(getActiveRun(restored).brief).toBe(getActiveRun(original).brief);
    expect(await repository.load()).toEqual(restored);
  });

  it("rejects a recovery point created for a different client", async () => {
    const [brandA, brandB] = brands;
    if (!brandA || !brandB) throw new Error("Mock brand fixtures are missing.");
    const storage = new MemoryStorage();
    const repository = new LocalWorkspaceRepository(
      storage,
      "test.workspace",
      () => "2026-07-27T10:05:00.000Z"
    );
    const base = createInitialWorkspaceState({
      runId: "run-1",
      now: "2026-07-27T10:00:00.000Z"
    });
    const brandAWorkspace = {
      ...base,
      runsById: {
        ...base.runsById,
        "run-1": { ...getActiveRun(base), brand: brandA }
      }
    };
    const checkpoint = await repository.createCheckpoint(
      brandAWorkspace,
      "run-1",
      "regenerate"
    );
    const currentWorkspace = {
      ...brandAWorkspace,
      runsById: {
        ...brandAWorkspace.runsById,
        "run-1": { ...getActiveRun(brandAWorkspace), brand: brandB }
      }
    };

    await expect(
      repository.restoreCheckpoint(
        currentWorkspace,
        "run-1",
        checkpoint.id
      )
    ).rejects.toThrow(
      "This recovery point belongs to a different client"
    );
  });
});
