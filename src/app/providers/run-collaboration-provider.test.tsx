import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunCollaborationRepository } from "../../ports/run-collaboration-repository";

vi.mock("./auth-provider", () => ({
  useAuth: () => ({ session: { user: { id: "user-1" } } })
}));

vi.mock("./workspace-provider", () => ({
  useWorkspace: () => ({ workspace: { runOrder: ["run-1"] } })
}));

import {
  RunCollaborationProvider,
  useRunCollaboration
} from "./run-collaboration-provider";

afterEach(cleanup);

const ownership = {
  workspaceRunId: "run-1",
  currentOwnerUserId: "user-1",
  version: 2,
  status: "active" as const,
  updatedAt: "2026-07-21T04:00:00.000Z"
};

function repository(
  overrides: Partial<RunCollaborationRepository> = {}
): RunCollaborationRepository {
  return {
    listTeamMembers: vi.fn(async () => []),
    listOwnerships: vi.fn(async () => [ownership]),
    listClientMemberships: vi.fn(async () => []),
    handoff: vi.fn(async () => ownership),
    setClientPic: vi.fn(async (input) => ({ ...input, role: "lead" as const })),
    ...overrides
  };
}

function Probe() {
  const collaboration = useRunCollaboration();
  return (
    <output>
      <span data-testid="ready">{String(collaboration.ownershipReady)}</span>
      <span data-testid="owner">
        {collaboration.ownershipByRunId["run-1"]?.currentOwnerUserId ?? "none"}
      </span>
      <span data-testid="error">{collaboration.error ? "error" : "ok"}</span>
    </output>
  );
}

describe("RunCollaborationProvider ownership loading", () => {
  it("keeps verified ownership when auxiliary team data fails", async () => {
    const collaborationRepository = repository({
      listTeamMembers: vi.fn(async () => {
        throw new Error("Team profiles unavailable");
      })
    });

    render(
      <RunCollaborationProvider repository={collaborationRepository}>
        <Probe />
      </RunCollaborationProvider>
    );

    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    expect(screen.getByTestId("owner").textContent).toBe("user-1");
    expect(screen.getByTestId("error").textContent).toBe("error");
  });

  it("does not mark ownership ready when the ownership request fails", async () => {
    const collaborationRepository = repository({
      listOwnerships: vi.fn(async () => {
        throw new Error("Ownership unavailable");
      })
    });

    render(
      <RunCollaborationProvider repository={collaborationRepository}>
        <Probe />
      </RunCollaborationProvider>
    );

    await waitFor(() => expect(screen.getByTestId("error").textContent).toBe("error"));
    expect(screen.getByTestId("ready").textContent).toBe("false");
    expect(screen.getByTestId("owner").textContent).toBe("none");
  });
});
