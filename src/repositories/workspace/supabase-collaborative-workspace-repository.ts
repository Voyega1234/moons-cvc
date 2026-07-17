import type {
  WorkspaceState,
  WorkflowState
} from "../../features/workflow/model";
import { getSupabaseClient } from "../../lib/supabase/client";
import type { Json } from "../../lib/supabase/database.types";
import type { WorkspaceRepository } from "../../ports/workspace-repository";
import {
  deserializeWorkspace,
  serializeWorkspace
} from "../../services/workspace/workspace-serializer";
import { nowIso } from "../../shared/utils/id";
import { SupabaseWorkspaceRepository } from "./supabase-workspace-repository";

interface KnownRun {
  currentOwnerUserId: string;
  version: number;
  serialized: string;
}

interface SharedRunRow {
  workspace_run_id: string | null;
  snapshot: Json | null;
  current_owner_user_id: string;
  version: number;
}

export class SupabaseCollaborativeWorkspaceRepository
  implements WorkspaceRepository
{
  private readonly legacy = new SupabaseWorkspaceRepository();
  private readonly knownRuns = new Map<string, KnownRun>();
  private saveQueue: Promise<void> = Promise.resolve();

  async load(): Promise<WorkspaceState | null> {
    const legacyWorkspace = await this.legacy.load();
    const { data, error } = await getSupabaseClient()
      .schema("moons")
      .from("runs")
      .select("workspace_run_id,snapshot,current_owner_user_id,version")
      .not("workspace_run_id", "is", null)
      .not("snapshot", "is", null)
      .neq("status", "archived")
      .order("updated_at", { ascending: false });

    if (error) throw error;
    const sharedRuns = (data ?? []).flatMap((row) => {
      const run = deserializeSharedRun(row);
      if (!run || !row.workspace_run_id) return [];
      this.knownRuns.set(row.workspace_run_id, {
        currentOwnerUserId: row.current_owner_user_id,
        version: row.version,
        serialized: serializeSharedRun(run)
      });
      return [run];
    });

    return mergeCollaborativeWorkspace(legacyWorkspace, sharedRuns);
  }

  save(workspace: WorkspaceState): Promise<void> {
    const operation = this.saveQueue
      .catch(() => undefined)
      .then(() => this.persist(workspace));
    this.saveQueue = operation;
    return operation;
  }

  async clear(): Promise<void> {
    await this.legacy.clear();
  }

  private async persist(workspace: WorkspaceState): Promise<void> {
    await this.legacy.save(workspace);
    const userId = await getUserId();

    for (const runId of workspace.runOrder) {
      const run = workspace.runsById[runId];
      if (!run) continue;
      const serialized = serializeSharedRun(run);
      const known = this.knownRuns.get(run.id);
      if (known?.serialized === serialized) continue;

      if (!known) {
        const snapshot = JSON.parse(serialized) as Json;
        const { data, error } = await getSupabaseClient()
          .schema("moons")
          .from("runs")
          .insert({
            owner_user_id: userId,
            current_owner_user_id: userId,
            updated_by: userId,
            client_id: run.brand?.id ?? null,
            workspace_run_id: run.id,
            snapshot,
            status: run.done ? "completed" : "active",
            version: 1,
            stage: run.stage,
            service: run.service,
            quantity: run.quantity,
            brief: run.brief,
            is_pitching: false,
            completed_at: run.done ? nowIso() : null
          })
          .select("current_owner_user_id,version")
          .single();

        if (error) throw error;
        this.knownRuns.set(run.id, {
          currentOwnerUserId: data.current_owner_user_id,
          version: data.version,
          serialized
        });
        continue;
      }

      if (known.currentOwnerUserId !== userId) {
        throw new Error("Only the current owner can edit this project.");
      }

      const snapshot = JSON.parse(serialized) as Json;
      const { data, error } = await getSupabaseClient()
        .schema("moons")
        .from("runs")
        .update({
          client_id: run.brand?.id ?? null,
          snapshot,
          status: run.done ? "completed" : "active",
          version: known.version + 1,
          updated_by: userId,
          stage: run.stage,
          service: run.service,
          quantity: run.quantity,
          brief: run.brief,
          completed_at: run.done ? nowIso() : null
        })
        .eq("workspace_run_id", run.id)
        .eq("version", known.version)
        .select("current_owner_user_id,version")
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        throw new Error(
          "This project changed in another browser. Reload the latest version before continuing."
        );
      }
      this.knownRuns.set(run.id, {
        currentOwnerUserId: data.current_owner_user_id,
        version: data.version,
        serialized
      });
    }
  }
}

export function mergeCollaborativeWorkspace(
  legacy: WorkspaceState | null,
  sharedRuns: readonly WorkflowState[]
): WorkspaceState | null {
  if (!sharedRuns.length) return legacy;

  const sharedById = Object.fromEntries(sharedRuns.map((run) => [run.id, run]));
  const legacyOnlyIds =
    legacy?.runOrder.filter((id) => !sharedById[id]) ?? [];
  const sharedIds = sharedRuns.map((run) => run.id);
  const runOrder = [...sharedIds, ...legacyOnlyIds];
  const runsById = {
    ...(legacy?.runsById ?? {}),
    ...sharedById
  };
  const preferredActiveId = legacy?.activeRunId;
  const activeRunId =
    preferredActiveId && runsById[preferredActiveId]
      ? preferredActiveId
      : runOrder[0];
  if (!activeRunId) return legacy;

  return {
    view: legacy?.view ?? "overview",
    activeRunId,
    runOrder,
    runsById,
    toast: null
  };
}

function serializeSharedRun(run: WorkflowState): string {
  return serializeWorkspace(
    {
      view: "studio",
      activeRunId: run.id,
      runOrder: [run.id],
      runsById: { [run.id]: run },
      toast: null
    },
    run.updatedAt
  );
}

function deserializeSharedRun(row: SharedRunRow): WorkflowState | null {
  if (!row.workspace_run_id || !row.snapshot) return null;
  const workspace = deserializeWorkspace(JSON.stringify(row.snapshot));
  return workspace?.runsById[row.workspace_run_id] ?? null;
}

async function getUserId(): Promise<string> {
  const { data, error } = await getSupabaseClient().auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Sign in before saving a project.");
  return data.user.id;
}
