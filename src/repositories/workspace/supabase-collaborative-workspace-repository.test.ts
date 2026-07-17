import { describe, expect, it } from "vitest";
import {
  createInitialWorkspaceState,
  getActiveRun
} from "../../features/workflow/workspace-reducer";
import { mergeCollaborativeWorkspace } from "./supabase-collaborative-workspace-repository";

describe("mergeCollaborativeWorkspace", () => {
  it("replaces a private copy with the latest shared run", () => {
    const legacy = createInitialWorkspaceState({
      runId: "run-1",
      now: "2026-07-16T10:00:00Z"
    });
    const shared = {
      ...getActiveRun(legacy),
      brief: "Shared latest brief",
      updatedAt: "2026-07-16T11:00:00Z"
    };

    const result = mergeCollaborativeWorkspace(legacy, [shared]);

    expect(result ? getActiveRun(result).brief : null).toBe("Shared latest brief");
  });

  it("adds visible shared runs without dropping private drafts", () => {
    const legacy = createInitialWorkspaceState({
      runId: "private-draft",
      now: "2026-07-16T10:00:00Z"
    });
    const sharedWorkspace = createInitialWorkspaceState({
      runId: "shared-run",
      now: "2026-07-16T11:00:00Z"
    });

    const result = mergeCollaborativeWorkspace(legacy, [
      getActiveRun(sharedWorkspace)
    ]);

    expect(result?.runOrder).toEqual(["shared-run", "private-draft"]);
  });
});
