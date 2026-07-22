import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type {
  ClientMembership,
  HandoffRunInput,
  RunOwnership,
  SetClientPicInput,
  TeamMember
} from "../../domain/run-collaboration";
import type { RunCollaborationRepository } from "../../ports/run-collaboration-repository";
import { useAuth } from "./auth-provider";
import { useWorkspace } from "./workspace-provider";

interface RunCollaborationContextValue {
  enabled: boolean;
  currentUserId: string | null;
  members: readonly TeamMember[];
  clientMemberships: readonly ClientMembership[];
  clientPicByClientId: Readonly<Record<string, TeamMember>>;
  ownershipByRunId: Readonly<Record<string, RunOwnership>>;
  ownershipReady: boolean;
  loading: boolean;
  error: Error | null;
  handoff: (input: HandoffRunInput) => Promise<RunOwnership>;
  setClientPic: (input: SetClientPicInput) => Promise<ClientMembership>;
  refresh: () => Promise<readonly RunOwnership[]>;
}

const RunCollaborationContext =
  createContext<RunCollaborationContextValue | null>(null);

export function RunCollaborationProvider({
  repository,
  children
}: {
  repository: RunCollaborationRepository | null;
  children: ReactNode;
}) {
  const { session } = useAuth();
  const { workspace } = useWorkspace();
  const [members, setMembers] = useState<readonly TeamMember[]>([]);
  const [clientMemberships, setClientMemberships] = useState<
    readonly ClientMembership[]
  >([]);
  const [ownershipByRunId, setOwnershipByRunId] = useState<
    Readonly<Record<string, RunOwnership>>
  >({});
  const [ownershipScopeKey, setOwnershipScopeKey] = useState<string | null>(
    null
  );
  const [loading, setLoading] = useState(Boolean(repository));
  const [error, setError] = useState<Error | null>(null);
  const runIdsKey = workspace.runOrder.join("\n");

  const refresh = useCallback(async () => {
    if (!repository) return [];
    setLoading(true);
    try {
      const ownerships = await repository.listOwnerships(workspace.runOrder);
      setOwnershipByRunId(
        Object.fromEntries(
          ownerships.map((ownership) => [ownership.workspaceRunId, ownership])
        )
      );
      setOwnershipScopeKey(runIdsKey);

      const [membersResult, membershipsResult] = await Promise.allSettled([
        repository.listTeamMembers(),
        repository.listClientMemberships()
      ]);
      if (membersResult.status === "fulfilled") {
        setMembers(membersResult.value);
      }
      if (membershipsResult.status === "fulfilled") {
        setClientMemberships(membershipsResult.value);
      }
      const auxiliaryError = [membersResult, membershipsResult].find(
        (result) => result.status === "rejected"
      );
      setError(
        auxiliaryError?.status === "rejected"
          ? toError(auxiliaryError.reason)
          : null
      );
      return ownerships;
    } catch (caught) {
      setOwnershipScopeKey(null);
      setError(toError(caught));
      return [];
    } finally {
      setLoading(false);
    }
  }, [repository, runIdsKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!repository) return;
    const refreshOnFocus = () => void refresh();
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [repository, refresh]);

  const handoff = useCallback(
    async (input: HandoffRunInput) => {
      if (!repository) throw new Error("Project handoff is not configured.");
      const ownership = await repository.handoff(input);
      setOwnershipByRunId((current) => ({
        ...current,
        [ownership.workspaceRunId]: ownership
      }));
      return ownership;
    },
    [repository]
  );

  const setClientPic = useCallback(
    async (input: SetClientPicInput) => {
      if (!repository) throw new Error("Client PIC is not configured.");
      const membership = await repository.setClientPic(input);
      setClientMemberships((current) => {
        const next = current
          .filter(
            (item) =>
              !(
                item.clientId === membership.clientId &&
                item.userId === membership.userId
              )
          )
          .map((item) =>
            item.clientId === membership.clientId && item.role === "lead"
              ? { ...item, role: "member" as const }
              : item
          );
        return [...next, membership];
      });
      return membership;
    },
    [repository]
  );

  const clientPicByClientId = useMemo<Readonly<Record<string, TeamMember>>>(() => {
    const memberByUserId = new Map(members.map((member) => [member.userId, member]));
    return Object.fromEntries(
      clientMemberships.flatMap((membership) => {
        if (membership.role !== "lead") return [];
        const member = memberByUserId.get(membership.userId);
        return member ? [[membership.clientId, member] as const] : [];
      })
    );
  }, [members, clientMemberships]);

  const value = useMemo<RunCollaborationContextValue>(
    () => ({
      enabled: Boolean(repository),
      currentUserId: session?.user.id ?? null,
      members,
      clientMemberships,
      clientPicByClientId,
      ownershipByRunId,
      ownershipReady: ownershipScopeKey === runIdsKey,
      loading,
      error,
      handoff,
      setClientPic,
      refresh
    }),
    [
      repository,
      session?.user.id,
      members,
      clientMemberships,
      clientPicByClientId,
      ownershipByRunId,
      ownershipScopeKey,
      runIdsKey,
      loading,
      error,
      handoff,
      setClientPic,
      refresh
    ]
  );

  return (
    <RunCollaborationContext.Provider value={value}>
      {children}
    </RunCollaborationContext.Provider>
  );
}

export function useRunCollaboration(): RunCollaborationContextValue {
  const value = useContext(RunCollaborationContext);
  if (!value) {
    throw new Error(
      "useRunCollaboration must be used inside RunCollaborationProvider."
    );
  }
  return value;
}

export function useOptionalRunCollaboration(): RunCollaborationContextValue | null {
  return useContext(RunCollaborationContext);
}

function toError(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error("Could not load project ownership.");
}
