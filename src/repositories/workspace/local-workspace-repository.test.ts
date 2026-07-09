import { describe, expect, it } from "vitest";
import { createInitialWorkspaceState } from "../../features/workflow/workspace-reducer";
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
});
