import type {
  HandoffRunInput,
  RunOwnership,
  TeamDepartment,
  TeamMember
} from "../../domain/run-collaboration";
import { teamDepartments } from "../../domain/run-collaboration";
import { getSupabaseClient } from "../../lib/supabase/client";
import type { RunCollaborationRepository } from "../../ports/run-collaboration-repository";

export class SupabaseRunCollaborationRepository
  implements RunCollaborationRepository
{
  async listTeamMembers(): Promise<readonly TeamMember[]> {
    const { data, error } = await getSupabaseClient()
      .schema("moons")
      .from("team_profiles")
      .select("user_id,email,display_name,department,is_admin")
      .eq("is_active", true)
      .order("display_name");

    if (error) throw error;
    return (data ?? []).map((profile) => ({
      userId: profile.user_id,
      email: profile.email,
      displayName: profile.display_name,
      department: parseDepartment(profile.department),
      isAdmin: profile.is_admin
    }));
  }

  async listOwnerships(
    workspaceRunIds: readonly string[]
  ): Promise<readonly RunOwnership[]> {
    if (!workspaceRunIds.length) return [];
    const { data, error } = await getSupabaseClient()
      .schema("moons")
      .from("runs")
      .select(
        "workspace_run_id,current_owner_user_id,version,status,updated_at"
      )
      .in("workspace_run_id", [...workspaceRunIds]);

    if (error) throw error;
    return (data ?? [])
      .filter(
        (run): run is typeof run & { workspace_run_id: string } =>
          Boolean(run.workspace_run_id)
      )
      .map((run) => ({
        workspaceRunId: run.workspace_run_id,
        currentOwnerUserId: run.current_owner_user_id,
        version: run.version,
        status: run.status,
        updatedAt: run.updated_at
      }));
  }

  async handoff(input: HandoffRunInput): Promise<RunOwnership> {
    const { data, error } = await getSupabaseClient()
      .schema("moons")
      .rpc("handoff_run", {
        p_workspace_run_id: input.workspaceRunId,
        p_to_user_id: input.toUserId,
        p_expected_version: input.expectedVersion,
        p_note: input.note?.trim() || null
      });

    if (error) throw error;
    const result = data?.[0];
    if (!result) throw new Error("The handoff did not return an updated owner.");
    return {
      workspaceRunId: result.workspace_run_id,
      currentOwnerUserId: result.current_owner_user_id,
      version: result.version,
      status: "active",
      updatedAt: result.updated_at
    };
  }
}

function parseDepartment(value: string): TeamDepartment {
  return teamDepartments.includes(value as TeamDepartment)
    ? (value as TeamDepartment)
    : "unassigned";
}
