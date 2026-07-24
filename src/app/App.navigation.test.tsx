import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { stages } from "../features/workflow/config";
import { createInitialWorkspaceState, getActiveRun } from "../features/workflow/workspace-reducer";
import { Journey, NavigationRail } from "./App";

describe("redesigned application navigation", () => {
  it("keeps the stable stage IDs while presenting the new labels", () => {
    expect(stages.map(({ id, name }) => [id, name])).toEqual([
      ["start", "Signal"],
      ["brief", "Brief"],
      ["directions", "Hook"],
      ["studio", "Create"],
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
        canEdit
      />
    );

    const productHome = screen.getByRole("button", {
      name: "Open Creative Compass studio"
    });
    expect(productHome.textContent).toBe("Creative Compass");

    await user.click(productHome);
    expect(workspaceDispatch).toHaveBeenCalledWith({
      type: "set-view",
      view: "studio"
    });

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

    await user.click(screen.getByRole("button", { name: "New project" }));
    expect(createRun).toHaveBeenCalledWith(false);

    expect(
      (screen.getByRole("button", { name: "Learnings" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it("lets viewers inspect every workflow tab without unlocking edit actions", async () => {
    const user = userEvent.setup();
    const workspace = createInitialWorkspaceState({
      runId: "run-viewer-navigation",
      now: "2026-07-24T00:00:00.000Z"
    });
    const state = getActiveRun(workspace);
    const dispatch = vi.fn();

    render(<Journey state={state} dispatch={dispatch} canEdit={false} />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(stages.length);
    expect(
      tabs.every((tab) => !(tab as HTMLButtonElement).disabled)
    ).toBe(true);

    await user.click(screen.getByRole("tab", { name: "Client" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "set-stage",
      stage: "client"
    });
  });

  it("keeps new-project controls unavailable to viewers", () => {
    const workspace = createInitialWorkspaceState({
      runId: "run-viewer-create",
      now: "2026-07-24T00:00:00.000Z"
    });

    const view = render(
      <NavigationRail
        workspace={workspace}
        state={getActiveRun(workspace)}
        dispatch={vi.fn()}
        workspaceDispatch={vi.fn()}
        createRun={vi.fn()}
        canEdit={false}
      />
    );

    const newProject = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="New project"]'
    );
    expect(newProject?.disabled).toBe(true);
  });
});
