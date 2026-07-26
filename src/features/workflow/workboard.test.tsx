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
      expect(
        screen.getByText(
          `${brands.length} clients · ${brands.length} projects shown`
        )
      ).toBeTruthy()
    );
    for (const brand of brands) {
      expect(screen.getByText(brand.name)).toBeTruthy();
    }

    const first = brands[0];
    if (!first) throw new Error("Mock brand fixture is missing.");
    const group = screen.getByRole("region", {
      name: `Projects for ${first.name}`
    });
    await user.click(within(group).getByRole("button", { name: /Start/i }));

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

    expect(screen.getByText("1 client · 1 project shown")).toBeTruthy();
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
    expect(screen.getAllByText(brand.name)).toHaveLength(1);
    const group = screen.getByRole("region", {
      name: `Projects for ${brand.name}`
    });
    expect(within(group).getByText("Summer Campaign")).toBeTruthy();
    expect(within(group).getByText("Product Launch")).toBeTruthy();
    expect(within(group).getByText("2 projects")).toBeTruthy();

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

  it("shows the latest five projects first and reveals older projects on demand", async () => {
    const user = userEvent.setup();
    const brand = brands[0];
    if (!brand) throw new Error("Mock brand fixture is missing.");
    let workspace = createInitialWorkspaceState({
      runId: "campaign-1",
      now: "2026-07-16T00:00:00.000Z"
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: "campaign-1",
      action: { type: "select-brand", brand },
      now: "2026-07-16T00:01:00.000Z"
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: "campaign-1",
      action: { type: "set-brief", brief: "Project: Campaign 1" },
      now: "2026-07-16T00:02:00.000Z"
    });

    for (let index = 2; index <= 6; index += 1) {
      const runId = `campaign-${index}`;
      workspace = workspaceReducer(workspace, {
        type: "create-run",
        id: runId,
        now: `2026-07-16T00:0${index}:00.000Z`,
        keepBrand: true
      });
      workspace = workspaceReducer(workspace, {
        type: "apply-run-action",
        runId,
        action: { type: "set-brief", brief: `Project: Campaign ${index}` },
        now: `2026-07-16T00:1${index}:00.000Z`
      });
    }

    const singleBrandRepository: BrandRepository = {
      async list() {
        return [brand];
      },
      async getById(id) {
        return id === brand.id ? brand : null;
      }
    };

    render(
      <BrandProvider
        repository={singleBrandRepository}
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

    expect(await screen.findByText("1 client · 5 projects shown")).toBeTruthy();
    expect(screen.getByText("Campaign 6")).toBeTruthy();
    expect(screen.queryByText("Campaign 1")).toBeNull();
    expect(screen.getByText("Showing 5 of 6 projects")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "See more" }));

    expect(screen.getByText("Campaign 1")).toBeTruthy();
    expect(screen.getByText("1 client · 6 projects shown")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "See more" })).toBeNull();
  });

  it("uses the latest client logo and category for an existing project", async () => {
    const baseBrand = brands[0];
    if (!baseBrand) throw new Error("Mock brand fixture is missing.");
    const currentBrand = {
      ...baseBrand,
      category: "Current brand category",
      ingestionStatus: "needs_review" as const,
      library: {
        ...baseBrand.library,
        brand: [
          ...baseBrand.library.brand.filter(
            (item) => item.title.toLowerCase() !== "logo"
          ),
          {
            id: "current-logo",
            title: "Logo",
            description: "Current client logo",
            assetUrl: "https://storage.example.com/current-logo.png"
          }
        ]
      }
    };
    const staleBrand = {
      ...currentBrand,
      category: "Awaiting brand ingestion",
      library: {
        ...currentBrand.library,
        brand: currentBrand.library.brand.filter(
          (item) => item.title.toLowerCase() !== "logo"
        )
      }
    };
    const currentRepository: BrandRepository = {
      async list() {
        return [currentBrand];
      },
      async getById(id) {
        return id === currentBrand.id ? currentBrand : null;
      }
    };
    let workspace = createInitialWorkspaceState({
      runId: "stale-brand-project",
      now: "2026-07-16T00:00:00.000Z"
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: "stale-brand-project",
      action: { type: "select-brand", brand: staleBrand },
      now: "2026-07-16T00:01:00.000Z"
    });

    render(
      <BrandProvider
        repository={currentRepository}
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

    const brandName = await screen.findByText(currentBrand.name);
    const group = brandName.closest("section");
    if (!group) throw new Error("Workboard client group was not found.");
    expect(within(group).getByText("Current brand category")).toBeTruthy();
    expect(group.querySelector("img")?.getAttribute("src")).toBe(
      "https://storage.example.com/current-logo.png"
    );
    expect(within(group).queryByText("Awaiting brand ingestion")).toBeNull();
  });
});
