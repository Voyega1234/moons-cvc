import { describe, expect, it, vi } from "vitest";
import { createInitialWorkspaceState } from "../../features/workflow/workspace-reducer";
import type { StorageLike } from "./local-workspace-repository";
import { ScopedLocalWorkspaceRepository } from "./scoped-local-workspace-repository";

class MemoryStorage implements StorageLike {
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

describe("ScopedLocalWorkspaceRepository", () => {
  it("keeps each signed-in user's workspace in a separate key", async () => {
    const storage = new MemoryStorage();
    const first = new ScopedLocalWorkspaceRepository(
      storage,
      async () => "user-a",
      "test.workspace"
    );
    const second = new ScopedLocalWorkspaceRepository(
      storage,
      async () => "user-b",
      "test.workspace"
    );
    await first.save(
      createInitialWorkspaceState({
        runId: "run-a",
        now: "2026-07-16T08:00:00.000Z"
      })
    );

    expect((await first.load())?.activeRunId).toBe("run-a");
    expect(await second.load()).toBeNull();
  });

  it("writes to localStorage immediately after the user scope is loaded", async () => {
    const storage = new MemoryStorage();
    const getScope = vi.fn(async () => "user-a");
    const repository = new ScopedLocalWorkspaceRepository(
      storage,
      getScope,
      "test.workspace"
    );
    await repository.load();

    void repository.save(
      createInitialWorkspaceState({
        runId: "saved-before-refresh",
        now: "2026-07-16T08:00:00.000Z"
      })
    );

    expect(storage.getItem("test.workspace.user-a")).not.toBeNull();
    expect(getScope).toHaveBeenCalledTimes(1);
  });

  it("refreshes the cached scope when a new session loads", async () => {
    const storage = new MemoryStorage();
    let userId = "user-a";
    const repository = new ScopedLocalWorkspaceRepository(
      storage,
      async () => userId,
      "test.workspace"
    );
    await repository.load();
    await repository.save(
      createInitialWorkspaceState({
        runId: "run-a",
        now: "2026-07-16T08:00:00.000Z"
      })
    );

    userId = "user-b";
    expect(await repository.load()).toBeNull();
    void repository.save(
      createInitialWorkspaceState({
        runId: "run-b",
        now: "2026-07-16T08:01:00.000Z"
      })
    );

    expect(storage.getItem("test.workspace.user-a")).not.toBeNull();
    expect(storage.getItem("test.workspace.user-b")).not.toBeNull();
  });
});
