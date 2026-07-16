import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrandProvider } from "../../app/providers/brand-provider";
import { brands } from "../../data/mock-brands";
import type { BrandRepository } from "../../ports/brand-repository";
import { createInitialWorkspaceState, getActiveRun } from "./workspace-reducer";
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
  it("shows every accessible client and starts a brand-bound run", async () => {
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
    if (!row) throw new Error("Workboard client row was not found.");
    await user.click(within(row).getByRole("button", { name: /Start/i }));

    expect(workspaceDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "create-run",
        keepBrand: false,
        brand: expect.objectContaining({ id: first.id })
      })
    );
  });

  it("filters the client portfolio by name", async () => {
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
      await screen.findByRole("searchbox", { name: "Search clients" }),
      target.name
    );

    expect(screen.getByText("1 shown")).toBeTruthy();
    expect(screen.getByText(target.name)).toBeTruthy();
  });
});
