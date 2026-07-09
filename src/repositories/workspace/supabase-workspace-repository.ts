import type { WorkspaceState } from "../../features/workflow/model";
import { getSupabaseClient } from "../../lib/supabase/client";
import type { Json } from "../../lib/supabase/database.types";
import type { WorkspaceRepository } from "../../ports/workspace-repository";
import {
  deserializeWorkspace,
  serializeWorkspace,
  WORKSPACE_SCHEMA_VERSION
} from "../../services/workspace/workspace-serializer";
import { nowIso } from "../../shared/utils/id";

export class SupabaseWorkspaceRepository implements WorkspaceRepository {
  async load(): Promise<WorkspaceState | null> {
    const client = getSupabaseClient();
    const userId = await getUserId();
    const { data, error } = await client
      .schema("moons")
      .from("workspaces")
      .select("snapshot")
      .eq("owner_user_id", userId)
      .maybeSingle();

    if (error) throw error;
    if (!data?.snapshot) return null;

    return deserializeWorkspace(JSON.stringify(data.snapshot));
  }

  async save(workspace: WorkspaceState): Promise<void> {
    const client = getSupabaseClient();
    const userId = await getUserId();
    const snapshot = JSON.parse(serializeWorkspace(workspace, nowIso())) as Json;
    const { error } = await client.schema("moons").from("workspaces").upsert(
      {
        owner_user_id: userId,
        schema_version: WORKSPACE_SCHEMA_VERSION,
        snapshot,
        updated_at: nowIso()
      },
      { onConflict: "owner_user_id" }
    );

    if (error) throw error;
  }

  async clear(): Promise<void> {
    const client = getSupabaseClient();
    const userId = await getUserId();
    const { error } = await client
      .schema("moons")
      .from("workspaces")
      .delete()
      .eq("owner_user_id", userId);

    if (error) throw error;
  }
}

async function getUserId(): Promise<string> {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Sign in before loading the workspace.");
  return data.user.id;
}
