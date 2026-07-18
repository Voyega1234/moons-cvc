import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createInitialWorkspaceState,
  getActiveRun
} from "../../features/workflow/workspace-reducer";
import type { Database, Json } from "../../lib/supabase/database.types";
import type { WorkspaceRepository } from "../../ports/workspace-repository";
import { serializeWorkspace } from "../../services/workspace/workspace-serializer";
import {
  mergeCollaborativeWorkspace,
  SupabaseCollaborativeWorkspaceRepository
} from "./supabase-collaborative-workspace-repository";

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

describe("SupabaseCollaborativeWorkspaceRepository.save", () => {
  it("discovers an existing cloud run before attempting an insert", async () => {
    const workspace = createInitialWorkspaceState({
      runId: "run-1",
      now: "2026-07-16T10:00:00Z"
    });
    const { client, inserts } = createClient({
      existingRun: sharedRunRow(workspace)
    });
    const repository = new SupabaseCollaborativeWorkspaceRepository(
      memoryRepository(),
      client
    );

    await expect(repository.save(workspace)).resolves.toBeUndefined();
    expect(inserts).toEqual([]);
  });

  it("does not overwrite different cloud state when its base version is unknown", async () => {
    const local = createInitialWorkspaceState({
      runId: "run-1",
      now: "2026-07-16T10:00:00Z"
    });
    const localRun = getActiveRun(local);
    const remote = {
      ...local,
      runsById: {
        ...local.runsById,
        "run-1": {
          ...localRun,
          brief: "Newer cloud brief",
          updatedAt: "2026-07-16T11:00:00Z"
        }
      }
    };
    const { client, inserts } = createClient({
      existingRun: sharedRunRow(remote)
    });
    const repository = new SupabaseCollaborativeWorkspaceRepository(
      memoryRepository(),
      client
    );

    await expect(repository.save(local)).rejects.toThrow(
      "Reload the workspace before editing"
    );
    expect(inserts).toEqual([]);
  });

  it("recovers when another tab inserts the same run at the same time", async () => {
    const workspace = createInitialWorkspaceState({
      runId: "run-1",
      now: "2026-07-16T10:00:00Z"
    });
    const { client, inserts } = createClient({
      lookupRuns: [null, sharedRunRow(workspace)],
      insertError: { code: "23505", message: "duplicate key" }
    });
    const repository = new SupabaseCollaborativeWorkspaceRepository(
      memoryRepository(),
      client
    );

    await expect(repository.save(workspace)).resolves.toBeUndefined();
    expect(inserts).toHaveLength(1);
  });
});

function memoryRepository(): WorkspaceRepository {
  return {
    async load() {
      return null;
    },
    async save() {},
    async clear() {}
  };
}

function sharedRunRow(workspace: ReturnType<typeof createInitialWorkspaceState>) {
  const run = getActiveRun(workspace);
  const snapshot = JSON.parse(
    serializeWorkspace(
      {
        view: "studio",
        activeRunId: run.id,
        runOrder: [run.id],
        runsById: { [run.id]: run },
        toast: null
      },
      run.updatedAt
    )
  ) as Json;
  return {
    workspace_run_id: run.id,
    snapshot,
    current_owner_user_id: "user-1",
    version: 1
  };
}

function createClient({
  existingRun,
  lookupRuns,
  insertError = null
}: {
  existingRun?: ReturnType<typeof sharedRunRow> | null;
  lookupRuns?: (ReturnType<typeof sharedRunRow> | null)[];
  insertError?: { code: string; message: string } | null;
}): {
  client: SupabaseClient<Database>;
  inserts: unknown[];
} {
  const inserts: unknown[] = [];
  const lookups = lookupRuns ?? [existingRun ?? null];
  let lookupIndex = 0;
  const client = {
    auth: {
      async getUser() {
        return { data: { user: { id: "user-1" } }, error: null };
      }
    },
    schema() {
      return {
        from(table: string) {
          if (table !== "runs") throw new Error(`Unexpected table ${table}`);
          const query = {
            select() {
              return query;
            },
            eq() {
              return query;
            },
            async maybeSingle() {
              const data = lookups[Math.min(lookupIndex, lookups.length - 1)];
              lookupIndex += 1;
              return { data: data ?? null, error: null };
            },
            insert(payload: unknown) {
              inserts.push(payload);
              return {
                select() {
                  return {
                    async single() {
                      return {
                        data: {
                          current_owner_user_id: "user-1",
                          version: 1
                        },
                        error: insertError
                      };
                    }
                  };
                }
              };
            }
          };
          return query;
        }
      };
    }
  } as unknown as SupabaseClient<Database>;
  return { client, inserts };
}
