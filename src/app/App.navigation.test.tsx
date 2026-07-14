import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { stages } from "../features/workflow/config";
import { createInitialWorkspaceState, getActiveRun } from "../features/workflow/workspace-reducer";
import { NavigationRail } from "./App";

describe("redesigned application navigation", () => {
  it("keeps the stable stage IDs while presenting the new labels", () => {
    expect(stages.map(({ id, name }) => [id, name])).toEqual([
      ["start", "Signal"],
      ["brief", "Brief"],
      ["directions", "Angles"],
      ["studio", "Build"],
      ["approval", "Internal QC"],
      ["client", "Client"],
      ["summary", "Learn"]
    ]);
  });

  it("maps rail destinations to existing workspace and workflow actions", async () => {
    const user = userEvent.setup();
    const workspace = createInitialWorkspaceState({
      runId: "run-navigation",
      now: "2026-07-13T00:00:00.000Z"
    });
    const state = getActiveRun(workspace);
    const dispatch = vi.fn();
    const workspaceDispatch = vi.fn();
    const createRun = vi.fn();

    render(
      <NavigationRail
        workspace={workspace}
        state={state}
        dispatch={dispatch}
        workspaceDispatch={workspaceDispatch}
        createRun={createRun}
      />
    );

    expect(
      screen.getByRole("button", { name: "Open Neo studio" }).textContent
    ).toBe("neo");

    await user.click(screen.getByRole("button", { name: "Workboard" }));
    expect(workspaceDispatch).toHaveBeenCalledWith({
      type: "set-view",
      view: "overview"
    });

    await user.click(screen.getByRole("button", { name: "Library" }));
    expect(workspaceDispatch).toHaveBeenCalledWith({
      type: "set-view",
      view: "studio"
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "set-stage",
      stage: "start"
    });

    await user.click(screen.getByRole("button", { name: "New" }));
    expect(createRun).toHaveBeenCalledWith(true);

    expect(
      (screen.getByRole("button", { name: "Learnings" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });
});
