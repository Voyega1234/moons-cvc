import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceState } from "../../features/workflow/model";
import {
  createInitialWorkspaceState,
  getActiveRun
} from "../../features/workflow/workspace-reducer";
import type { WorkspaceRepository } from "../../ports/workspace-repository";
import { WorkspaceProvider, useWorkspace } from "./workspace-provider";

afterEach(cleanup);

function WorkspaceProbe() {
  const {
    workspace,
    dispatch,
    persistenceError,
    persistenceStatus,
    lastSavedAt,
    flush,
    checkpoints,
    checkpointError,
    createCheckpoint,
    restoreCheckpoint
  } = useWorkspace();
  return (
    <div>
      <span>{workspace.activeRunId}</span>
      <span>{persistenceStatus}</span>
      <span>{lastSavedAt ? "has-save-time" : "no-save-time"}</span>
      {persistenceError ? <span>{persistenceError.message}</span> : null}
      {checkpointError ? <span>{checkpointError.message}</span> : null}
      <span data-testid="workspace-brief">{getActiveRun(workspace).brief}</span>
      <span>checkpoints-{checkpoints.length}</span>
      <button type="button" onClick={() => dispatch({ type: "set-view", view: "overview" })}>
        Overview
      </button>
      <button type="button" onClick={() => dispatch({ type: "set-view", view: "studio" })}>
        Studio
      </button>
      <button type="button" onClick={() => void flush()}>
        Flush
      </button>
      <button type="button" onClick={() => void createCheckpoint("regenerate")}>
        Checkpoint
      </button>
      <button
        type="button"
        onClick={() => {
          const first = checkpoints[0];
          if (first) void restoreCheckpoint(first.id);
        }}
      >
        Restore
      </button>
    </div>
  );
}

describe("WorkspaceProvider", () => {
  it("loads persisted state before starting autosave", async () => {
    const persisted = createInitialWorkspaceState({
      runId: "persisted-run",
      now: "2026-06-23T10:00:00.000Z"
    });
    let resolveLoad: ((value: WorkspaceState | null) => void) | undefined;
    const load = vi.fn(
      () =>
        new Promise<WorkspaceState | null>((resolve) => {
          resolveLoad = resolve;
        })
    );
    const save = vi.fn(async (_workspace: WorkspaceState) => undefined);
    const repository: WorkspaceRepository = {
      load,
      save,
      clear: vi.fn(async () => undefined)
    };

    render(
      <WorkspaceProvider repository={repository}>
        <WorkspaceProbe />
      </WorkspaceProvider>
    );

    expect(screen.getByText("Loading Creative Compass...")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      resolveLoad?.(persisted);
    });

    expect(await screen.findByText("persisted-run")).toBeTruthy();
    await waitFor(() => expect(save).toHaveBeenCalledWith(persisted));
    expect(await screen.findByText("saved")).toBeTruthy();
    expect(screen.getByText("has-save-time")).toBeTruthy();
  });

  it("coalesces rapid edits and saves the latest workspace", async () => {
    const persisted = createInitialWorkspaceState({
      runId: "debounced-run",
      now: "2026-07-20T15:00:00.000Z"
    });
    const save = vi.fn(async (_workspace: WorkspaceState) => undefined);
    const repository: WorkspaceRepository = {
      load: vi.fn(async () => persisted),
      save,
      clear: vi.fn(async () => undefined)
    };

    render(
      <WorkspaceProvider repository={repository}>
        <WorkspaceProbe />
      </WorkspaceProvider>
    );

    expect(await screen.findByText("saved")).toBeTruthy();
    save.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    fireEvent.click(screen.getByRole("button", { name: "Studio" }));
    expect(screen.getByText("saving")).toBeTruthy();

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), {
      timeout: 1_500
    });
    expect(save.mock.calls[0]?.[0].view).toBe("studio");
    expect(await screen.findByText("saved")).toBeTruthy();
  });

  it("flushes pending changes immediately", async () => {
    const persisted = createInitialWorkspaceState({
      runId: "flush-run",
      now: "2026-07-20T15:00:00.000Z"
    });
    const save = vi.fn(async (_workspace: WorkspaceState) => undefined);
    const repository: WorkspaceRepository = {
      load: vi.fn(async () => persisted),
      save,
      clear: vi.fn(async () => undefined)
    };

    render(
      <WorkspaceProvider repository={repository}>
        <WorkspaceProbe />
      </WorkspaceProvider>
    );

    expect(await screen.findByText("saved")).toBeTruthy();
    save.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(screen.getByText("saving")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Flush" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0].view).toBe("overview");
    expect(await screen.findByText("saved")).toBeTruthy();
  });

  it("keeps the workspace open and exposes save failures", async () => {
    const persisted = createInitialWorkspaceState({
      runId: "failed-save-run",
      now: "2026-07-20T15:00:00.000Z"
    });
    const repository: WorkspaceRepository = {
      load: vi.fn(async () => persisted),
      save: vi.fn(async () => {
        throw new Error("Cloud unavailable");
      }),
      clear: vi.fn(async () => undefined)
    };

    render(
      <WorkspaceProvider repository={repository}>
        <WorkspaceProbe />
      </WorkspaceProvider>
    );

    expect(await screen.findByText("failed-save-run")).toBeTruthy();
    expect(await screen.findByText("error", {}, { timeout: 1_500 })).toBeTruthy();
    expect(screen.getByText("Cloud unavailable")).toBeTruthy();
  });

  it("creates and restores a recovery point around the active project", async () => {
    const persisted = createInitialWorkspaceState({
      runId: "checkpoint-run",
      now: "2026-07-20T15:00:00.000Z"
    });
    const restored = {
      ...persisted,
      runsById: {
        ...persisted.runsById,
        "checkpoint-run": {
          ...getActiveRun(persisted),
          brief: "Recovered brief"
        }
      }
    };
    const checkpoint = {
      id: "checkpoint-1",
      runId: "checkpoint-run",
      reason: "regenerate" as const,
      createdAt: "2026-07-20T15:05:00.000Z",
      createdBy: "Tester",
      sourceVersion: 2
    };
    let created = false;
    const repository: WorkspaceRepository = {
      load: vi.fn(async () => persisted),
      save: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
      createCheckpoint: vi.fn(async () => {
        created = true;
        return checkpoint;
      }),
      listCheckpoints: vi.fn(async () => (created ? [checkpoint] : [])),
      restoreCheckpoint: vi.fn(async () => restored)
    };

    render(
      <WorkspaceProvider repository={repository}>
        <WorkspaceProbe />
      </WorkspaceProvider>
    );

    expect(await screen.findByText("saved")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Checkpoint" }));
    expect(await screen.findByText("checkpoints-1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() =>
      expect(screen.getByTestId("workspace-brief").textContent).toBe(
        "Recovered brief"
      )
    );
    expect(repository.restoreCheckpoint).toHaveBeenCalledWith(
      persisted,
      "checkpoint-run",
      "checkpoint-1"
    );
  });
});
