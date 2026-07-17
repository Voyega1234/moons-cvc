import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrandProvider } from "../../app/providers/brand-provider";
import { brands } from "../../data/mock-brands";
import type { BrandRepository } from "../../ports/brand-repository";
import {
  createInitialWorkspaceState,
  getActiveRun,
  workspaceReducer
} from "./workspace-reducer";
import { Overview } from "./stages";

const repository: BrandRepository = {
  async list() {
    return brands;
  },
  async getById(id) {
    return brands.find((brand) => brand.id === id) ?? null;
  }
};

const mappingRepository = { list: async () => [] };

afterEach(cleanup);

describe("Workboard", () => {
  it("shows ready clients and starts a brand-bound project", async () => {
    const user = userEvent.setup();
    const workspace = createInitialWorkspaceState({
      runId: "workboard-run",
      now: "2026-07-16T00:00:00.000Z"
    });
    const workspaceDispatch = vi.fn();

    render(
      <BrandProvider
        repository={repository}
        mappingRepository={mappingRepository}
      >
        <Overview
          state={getActiveRun(workspace)}
          dispatch={vi.fn()}
          workspace={workspace}
          workspaceDispatch={workspaceDispatch}
          onOpenStudio={vi.fn()}
        />
      </BrandProvider>
    );

    await waitFor(() =>
      expect(screen.getByText(`${brands.length} shown`)).toBeTruthy()
    );
    for (const brand of brands) {
      expect(screen.getByText(brand.name)).toBeTruthy();
    }

    const first = brands[0];
    if (!first) throw new Error("Mock brand fixture is missing.");
    const row = screen.getByText(first.name).closest("article");
    if (!row) throw new Error("Workboard project row was not found.");
    await user.click(within(row).getByRole("button", { name: /Start/i }));

    expect(workspaceDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "create-run",
        keepBrand: false,
        brand: expect.objectContaining({ id: first.id })
      })
    );
  });

  it("filters projects by client name", async () => {
    const user = userEvent.setup();
    const workspace = createInitialWorkspaceState({
      runId: "workboard-search",
      now: "2026-07-16T00:00:00.000Z"
    });
    const target = brands[1];
    if (!target) throw new Error("Mock brand fixture is missing.");

    render(
      <BrandProvider
        repository={repository}
        mappingRepository={mappingRepository}
      >
        <Overview
          state={getActiveRun(workspace)}
          dispatch={vi.fn()}
          workspace={workspace}
          workspaceDispatch={vi.fn()}
          onOpenStudio={vi.fn()}
        />
      </BrandProvider>
    );

    await user.type(
      await screen.findByRole("searchbox", { name: "Search projects" }),
      target.name
    );

    expect(screen.getByText("1 shown")).toBeTruthy();
    expect(screen.getByText(target.name)).toBeTruthy();
  });

  it("shows every active project when one client has multiple projects", async () => {
    const brand = brands[0];
    if (!brand) throw new Error("Mock brand fixture is missing.");
    let workspace = createInitialWorkspaceState({
      runId: "nike-summer",
      now: "2026-07-16T00:00:00.000Z"
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: "nike-summer",
      action: { type: "select-brand", brand },
      now: "2026-07-16T00:01:00.000Z"
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: "nike-summer",
      action: { type: "set-brief", brief: "Project: Summer Campaign" },
      now: "2026-07-16T00:02:00.000Z"
    });
    workspace = workspaceReducer(workspace, {
      type: "create-run",
      id: "nike-launch",
      now: "2026-07-16T00:03:00.000Z",
      keepBrand: true
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: "nike-launch",
      action: { type: "set-brief", brief: "Project: Product Launch" },
      now: "2026-07-16T00:04:00.000Z"
    });
    const workspaceDispatch = vi.fn();

    render(
      <BrandProvider
        repository={repository}
        mappingRepository={mappingRepository}
      >
        <Overview
          state={getActiveRun(workspace)}
          dispatch={vi.fn()}
          workspace={workspace}
          workspaceDispatch={workspaceDispatch}
          onOpenStudio={vi.fn()}
        />
      </BrandProvider>
    );

    expect(await screen.findByText("Summer Campaign")).toBeTruthy();
    const launch = screen.getByText("Product Launch");
    expect(launch).toBeTruthy();
    expect(screen.getAllByText(brand.name)).toHaveLength(2);

    const launchRow = launch.closest("article");
    if (!launchRow) throw new Error("Project row was not found.");
    await userEvent.setup().click(
      within(launchRow).getByRole("button", { name: /Open/i })
    );

    expect(workspaceDispatch).toHaveBeenCalledWith({
      type: "switch-run",
      id: "nike-launch"
    });
  });
});
