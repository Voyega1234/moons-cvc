import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceState } from "../../features/workflow/model";
import { createInitialWorkspaceState } from "../../features/workflow/workspace-reducer";
import type { WorkspaceRepository } from "../../ports/workspace-repository";
import { WorkspaceProvider, useWorkspace } from "./workspace-provider";

function WorkspaceProbe() {
  const { workspace } = useWorkspace();
  return <span>{workspace.activeRunId}</span>;
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
    const save = vi.fn(async () => undefined);
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

    expect(screen.getByText("Loading Moons...")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      resolveLoad?.(persisted);
    });

    expect(await screen.findByText("persisted-run")).toBeTruthy();
    await waitFor(() => expect(save).toHaveBeenCalledWith(persisted));
  });
});
