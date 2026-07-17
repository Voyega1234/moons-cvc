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
  HandoffRunInput,
  RunOwnership,
  TeamMember
} from "../../domain/run-collaboration";
import type { RunCollaborationRepository } from "../../ports/run-collaboration-repository";
import { useAuth } from "./auth-provider";
import { useWorkspace } from "./workspace-provider";

interface RunCollaborationContextValue {
  enabled: boolean;
  currentUserId: string | null;
  members: readonly TeamMember[];
  ownershipByRunId: Readonly<Record<string, RunOwnership>>;
  loading: boolean;
  error: Error | null;
  handoff: (input: HandoffRunInput) => Promise<RunOwnership>;
  refresh: () => Promise<void>;
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
  const [ownershipByRunId, setOwnershipByRunId] = useState<
    Readonly<Record<string, RunOwnership>>
  >({});
  const [loading, setLoading] = useState(Boolean(repository));
  const [error, setError] = useState<Error | null>(null);
  const runIdsKey = workspace.runOrder.join("\n");

  const refresh = useCallback(async () => {
    if (!repository) return;
    setLoading(true);
    try {
      const [nextMembers, ownerships] = await Promise.all([
        repository.listTeamMembers(),
        repository.listOwnerships(workspace.runOrder)
      ]);
      setMembers(nextMembers);
      setOwnershipByRunId(
        Object.fromEntries(
          ownerships.map((ownership) => [ownership.workspaceRunId, ownership])
        )
      );
      setError(null);
    } catch (caught) {
      setError(toError(caught));
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

  const value = useMemo<RunCollaborationContextValue>(
    () => ({
      enabled: Boolean(repository),
      currentUserId: session?.user.id ?? null,
      members,
      ownershipByRunId,
      loading,
      error,
      handoff,
      refresh
    }),
    [repository, session?.user.id, members, ownershipByRunId, loading, error, handoff, refresh]
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
