import type {
  HandoffRunInput,
  RunOwnership,
  TeamMember
} from "../domain/run-collaboration";

export interface RunCollaborationRepository {
  listTeamMembers(): Promise<readonly TeamMember[]>;
  listOwnerships(
    workspaceRunIds: readonly string[]
  ): Promise<readonly RunOwnership[]>;
  handoff(input: HandoffRunInput): Promise<RunOwnership>;
}
