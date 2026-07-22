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

describe("SupabaseCollaborativeWorkspaceRepository recovery points", () => {
  it("stores the current run snapshot with its optimistic-lock version", async () => {
    const workspace = createInitialWorkspaceState({
      runId: "run-1",
      now: "2026-07-20T10:00:00Z"
    });
    const { client, checkpointInserts } = createRecoveryClient(workspace);
    const repository = new SupabaseCollaborativeWorkspaceRepository(
      memoryRepository(),
      client
    );
    await repository.save(workspace);

    const checkpoint = await repository.createCheckpoint(
      workspace,
      "run-1",
      "regenerate"
    );

    expect(checkpoint.reason).toBe("regenerate");
    expect(checkpointInserts).toHaveLength(1);
    expect(checkpointInserts[0]).toMatchObject({
      run_id: "database-run-1",
      reason: "regenerate",
      source_version: 1,
      created_by: "user-1"
    });
  });

  it("restores through the version-checked database function", async () => {
    const workspace = createInitialWorkspaceState({
      runId: "run-1",
      now: "2026-07-20T10:00:00Z"
    });
    const currentRun = getActiveRun(workspace);
    const recoveredWorkspace = {
      ...workspace,
      runsById: {
        ...workspace.runsById,
        "run-1": { ...currentRun, brief: "Recovered cloud brief" }
      }
    };
    const { client, rpcCalls } = createRecoveryClient(
      workspace,
      recoveredWorkspace
    );
    const repository = new SupabaseCollaborativeWorkspaceRepository(
      memoryRepository(),
      client
    );
    await repository.save(workspace);

    const restored = await repository.restoreCheckpoint(
      workspace,
      "run-1",
      "checkpoint-db-1"
    );

    expect(getActiveRun(restored).brief).toBe("Recovered cloud brief");
    expect(rpcCalls).toEqual([
      {
        p_checkpoint_id: "checkpoint-db-1",
        p_workspace_run_id: "run-1",
        p_expected_version: 1
      }
    ]);
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
    id: "database-run-1",
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
                          id: "database-run-1",
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

function createRecoveryClient(
  workspace: ReturnType<typeof createInitialWorkspaceState>,
  restoredWorkspace = workspace
): {
  client: SupabaseClient<Database>;
  checkpointInserts: Record<string, unknown>[];
  rpcCalls: Record<string, unknown>[];
} {
  const checkpointInserts: Record<string, unknown>[] = [];
  const rpcCalls: Record<string, unknown>[] = [];
  const knownRow = sharedRunRow(workspace);
  const restoredRow = sharedRunRow(restoredWorkspace);
  const client = {
    auth: {
      async getUser() {
        return { data: { user: { id: "user-1" } }, error: null };
      }
    },
    schema() {
      return {
        rpc(_name: string, args: Record<string, unknown>) {
          rpcCalls.push(args);
          return {
            async single() {
              return {
                data: {
                  ...restoredRow,
                  version: 2,
                  updated_at: "2026-07-20T10:10:00Z"
                },
                error: null
              };
            }
          };
        },
        from(table: string) {
          if (table === "runs") {
            const query = {
              select() {
                return query;
              },
              eq() {
                return query;
              },
              async maybeSingle() {
                return { data: knownRow, error: null };
              }
            };
            return query;
          }
          if (table === "run_checkpoints") {
            return {
              insert(payload: Record<string, unknown>) {
                checkpointInserts.push(payload);
                return {
                  select() {
                    return {
                      async single() {
                        return {
                          data: {
                            id: "checkpoint-db-1",
                            reason: payload.reason,
                            source_version: payload.source_version,
                            created_by: "user-1",
                            created_at: "2026-07-20T10:05:00Z"
                          },
                          error: null
                        };
                      }
                    };
                  }
                };
              }
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }
      };
    }
  } as unknown as SupabaseClient<Database>;
  return { client, checkpointInserts, rpcCalls };
}
