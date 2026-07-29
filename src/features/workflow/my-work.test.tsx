import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrandProvider } from "../../app/providers/brand-provider";
import { brands } from "../../data/mock-brands";
import type { BrandRepository } from "../../ports/brand-repository";
import type { WorkspaceState, WorkflowState } from "./model";
import { MyWork } from "./my-work";
import {
  createInitialWorkspaceState,
  workspaceReducer
} from "./workspace-reducer";

afterEach(cleanup);

const currentBrands = brands.map((brand, index) =>
  index === 0
    ? {
        ...brand,
        library: {
          ...brand.library,
          brand: brand.library.brand.map((item) =>
            item.title === "Logo"
              ? {
                  ...item,
                  assetUrl: "https://assets.example.com/current-logo.png"
                }
              : item
          )
        }
      }
    : brand
);

const brandRepository: BrandRepository = {
  async list() {
    return currentBrands;
  },
  async getById(id) {
    return currentBrands.find((brand) => brand.id === id) ?? null;
  }
};

const mappingRepository = { list: async () => [] };

function renderMyWork(
  workspace: WorkspaceState,
  workspaceDispatch: ReturnType<typeof vi.fn>
) {
  return render(
    <BrandProvider
      repository={brandRepository}
      mappingRepository={mappingRepository}
    >
      <MyWork
        workspace={workspace}
        workspaceDispatch={workspaceDispatch}
      />
    </BrandProvider>
  );
}

function workspaceWithQueueStates(): WorkspaceState {
  const brand = brands[0];
  if (!brand) throw new Error("Mock brand fixture is missing.");

  let workspace = createInitialWorkspaceState({
    runId: "needs-review",
    now: "2026-07-29T01:00:00.000Z"
  });
  workspace = workspaceReducer(workspace, {
    type: "apply-run-action",
    runId: "needs-review",
    action: { type: "select-brand", brand },
    now: "2026-07-29T01:01:00.000Z"
  });

  const signalRun = workspace.runsById["needs-review"];
  if (!signalRun) throw new Error("Signal run was not created.");
  const reviewRun: WorkflowState = {
    ...signalRun,
    id: "brief-review",
    stage: "brief",
    updatedAt: "2026-07-29T01:01:30.000Z"
  };
  const waitingRun: WorkflowState = {
    ...reviewRun,
    id: "waiting",
    stage: "approval",
    outputs: [
      {
        id: "fixing-output",
        directionId: "direction-1",
        format: "Static",
        status: "needs-revision",
        clientStatus: "queued",
        revisionCount: 0,
        approval: {
          graphicDesign: "rejected",
          clientService: null,
          projectManager: null
        },
        approvalComments: {
          graphicDesign: "Make the product benefit easier to scan.",
          clientService: "",
          projectManager: ""
        }
      }
    ],
    updatedAt: "2026-07-29T01:02:00.000Z"
  };
  const readyRun: WorkflowState = {
    ...reviewRun,
    id: "ready",
    stage: "summary",
    updatedAt: "2026-07-29T01:03:00.000Z"
  };
  const clientWaitingRun: WorkflowState = {
    ...reviewRun,
    id: "client-waiting",
    stage: "client",
    clientSent: true,
    updatedAt: "2026-07-29T01:04:00.000Z"
  };

  return {
    ...workspace,
    view: "my-work",
    runOrder: [
      "needs-review",
      "brief-review",
      "waiting",
      "ready",
      "client-waiting"
    ],
    runsById: {
      "needs-review": signalRun,
      "brief-review": reviewRun,
      waiting: waitingRun,
      ready: readyRun,
      "client-waiting": clientWaitingRun
    }
  };
}

describe("My Work", () => {
  it("groups live runs and opens the selected run", async () => {
    const workspace = workspaceWithQueueStates();
    const workspaceDispatch = vi.fn();
    const user = userEvent.setup();

    const view = renderMyWork(workspace, workspaceDispatch);

    await waitFor(() =>
      expect(
        view.container.querySelector(
          'img[src="https://assets.example.com/current-logo.png"]'
        )
      ).not.toBeNull()
    );

    expect(
      within(
        screen.getByRole("region", { name: "Needs your review" })
      ).getByText("Review brief and offer")
    ).toBeTruthy();
    expect(screen.queryByText("Complete project setup")).toBeNull();
    expect(screen.queryByText("Client review")).toBeNull();
    expect(
      within(screen.getByRole("region", { name: "Waiting on team" })).getByText(
        "GD fixing"
      )
    ).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Ready to deliver" })).getByText(
        "Deliver approved creative set"
      )
    ).toBeTruthy();

    await user.click(
      within(
        screen.getByRole("region", { name: "Needs your review" })
      ).getByRole("button")
    );
    expect(workspaceDispatch).toHaveBeenCalledWith({
      type: "switch-run",
      id: "brief-review"
    });
  });

  it("filters the queue without changing persisted run state", async () => {
    const workspaceDispatch = vi.fn();
    const user = userEvent.setup();

    renderMyWork(workspaceWithQueueStates(), workspaceDispatch);

    await user.click(screen.getByRole("button", { name: "Ready 1" }));

    expect(
      screen.getByRole("region", { name: "Ready to deliver" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: "Needs your review" })
    ).toBeNull();
    expect(workspaceDispatch).not.toHaveBeenCalled();
  });

  it("shows the five latest review items before revealing more", async () => {
    const base = workspaceWithQueueStates();
    const seed = base.runsById["brief-review"];
    if (!seed) throw new Error("Review seed run is missing.");
    const extraRuns = Array.from({ length: 6 }, (_, index) => ({
      ...seed,
      id: `extra-review-${index + 1}`,
      updatedAt: `2026-07-29T01:${10 + index}:00.000Z`
    }));
    const workspace: WorkspaceState = {
      ...base,
      runOrder: [
        ...base.runOrder,
        ...extraRuns.map((run) => run.id)
      ],
      runsById: {
        ...base.runsById,
        ...Object.fromEntries(extraRuns.map((run) => [run.id, run]))
      }
    };
    const user = userEvent.setup();

    renderMyWork(workspace, vi.fn());

    const reviewColumn = screen.getByRole("region", {
      name: "Needs your review"
    });
    expect(
      within(reviewColumn).getAllByText("Review brief and offer")
    ).toHaveLength(5);

    await user.click(
      within(reviewColumn).getByRole("button", { name: /See more/ })
    );

    expect(
      within(reviewColumn).getAllByText("Review brief and offer")
    ).toHaveLength(7);
    expect(
      within(reviewColumn).queryByRole("button", { name: /See more/ })
    ).toBeNull();
  });
});
