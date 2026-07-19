import type {
  ClientMembership,
  HandoffRunInput,
  RunOwnership,
  SetClientPicInput,
  TeamMember
} from "../domain/run-collaboration";

export interface RunCollaborationRepository {
  listTeamMembers(): Promise<readonly TeamMember[]>;
  listOwnerships(
    workspaceRunIds: readonly string[]
  ): Promise<readonly RunOwnership[]>;
  listClientMemberships(): Promise<readonly ClientMembership[]>;
  handoff(input: HandoffRunInput): Promise<RunOwnership>;
  setClientPic(input: SetClientPicInput): Promise<ClientMembership>;
}
