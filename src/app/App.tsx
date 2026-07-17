import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type Dispatch
} from "react";
import {
  ArrowClockwise,
  Bell,
  Books,
  Brain,
  ChartLineUp,
  Check,
  CheckCircle,
  Kanban,
  Lightbulb,
  NotePencil,
  PaintBrush,
  Plus,
  ShieldCheck,
  Sparkle,
  SquaresFour,
  Tray,
  Users,
  UserCircle,
  WarningCircle,
  SignOut,
  X
} from "@phosphor-icons/react";
import { brandLogoUrl, type Brand } from "../domain/brand";
import {
  useBrands,
  type BrandNotification
} from "./providers/brand-provider";
import { useWorkspace } from "./providers/workspace-provider";
import { useAuth } from "./providers/auth-provider";
import { useRunCollaboration } from "./providers/run-collaboration-provider";
import { canEditRun } from "../domain/run-collaboration";
import { RunOwnershipBar } from "../features/collaboration/run-ownership-bar";
import type { CreativeStage } from "../domain/creative-run";
import { serviceLabels, stages } from "../features/workflow/config";
import type {
  WorkspaceAction,
  WorkspaceState,
  WorkflowAction,
  WorkflowState
} from "../features/workflow/model";
import {
  creativeMixItems
} from "../features/workflow/model";
import {
  highestUnlockedStageIndex,
  runStatus,
  workflowActionBlockReason
} from "../features/workflow/rules";
import {
  getActiveRun
} from "../features/workflow/workspace-reducer";
import { useAutoDismiss } from "../shared/hooks/use-auto-dismiss";
import { createId, nowIso } from "../shared/utils/id";
import {
  ApprovalStage,
  BriefStage,
  ClientStage,
  DirectionsStage,
  Overview,
  StartStage,
  StudioStage,
  SummaryStage
} from "../features/workflow/stages";

const CLEAR_TOAST_ACTION = { type: "clear-toast" } as const;

export function App() {
  const {
    workspace,
    dispatch: workspaceDispatch,
    persistenceError
  } = useWorkspace();
  const state = getActiveRun(workspace);
  const collaboration = useRunCollaboration();
  const ownership = collaboration.ownershipByRunId[state.id] ?? null;
  const runCanEdit =
    !collaboration.enabled ||
    canEditRun(ownership, collaboration.currentUserId);
  const canEditRef = useRef(runCanEdit);
  canEditRef.current = runCanEdit;
  const [editWarning, setEditWarning] = useState<string | null>(null);
  const visibleToast = persistenceError
    ? {
        title: "Workspace could not be saved",
        message: persistenceError.message,
        tone: "error" as const
      }
    : editWarning
      ? {
          title: "View-only project",
          message: editWarning,
          tone: "warning" as const
        }
      : workspace.toast;

  // Bound to state.id (not "whichever run is active") so that an async
  // action started against this run — hook generation, artwork generation,
  // etc. — still lands on THIS run even if the user switches to a different
  // run or tab before the request resolves. Recreating this callback when
  // state.id changes is what makes it work: an in-flight promise's .then()
  // closes over the dispatch instance (and therefore the runId) that was
  // current when the action was kicked off, not whatever is active later.
  const dispatch = useCallback<Dispatch<WorkflowAction>>(
    (action) => {
      if (!canEditRef.current) {
        setEditWarning(
          "Only the current owner can make changes. Ask them to hand the project to you."
        );
        return;
      }
      setEditWarning(null);
      workspaceDispatch({
        type: "apply-run-action",
        runId: state.id,
        action,
        now: nowIso()
      });
    },
    [state.id]
  );

  const createRun = useCallback((keepBrand: boolean) => {
    workspaceDispatch({
      type: "create-run",
      id: createId("run"),
      now: nowIso(),
      keepBrand
    });
  }, []);

  useAutoDismiss(
    workspace.toast,
    workspaceDispatch,
    CLEAR_TOAST_ACTION
  );

  const stage = stages.find((candidate) => candidate.id === state.stage);
  if (!stage) throw new Error(`Unknown stage: ${state.stage}`);

  return (
    <div
      className={`app neo-app ${workspace.view === "overview" ? "mode-overview" : ""}`}
    >
      <NavigationRail
        workspace={workspace}
        state={state}
        dispatch={dispatch}
        workspaceDispatch={workspaceDispatch}
        createRun={createRun}
      />
      <div className="neo-page">
        <Header
          workspace={workspace}
          state={state}
          dispatch={dispatch}
          workspaceDispatch={workspaceDispatch}
          createRun={createRun}
          canEdit={runCanEdit}
        />
        <main>
          <div className="shell neo-workspace">
            {workspace.view === "overview" ? (
              <Overview
                state={state}
                dispatch={dispatch}
                workspace={workspace}
                workspaceDispatch={workspaceDispatch}
                onOpenStudio={() =>
                  workspaceDispatch({ type: "set-view", view: "studio" })
                }
              />
            ) : (
              <>
                <RunOwnershipBar
                  runId={state.id}
                  completed={state.done}
                  busy={
                    state.ideaGenerationStatus === "running" ||
                    state.artworkGenerationStatus === "running"
                  }
                />
                {state.stage === "start" ? (
                  <section className="hero neo-hero">
                    <div className="neo-hero-copy">
                      <span className="neo-kicker">
                        <span aria-hidden="true" /> Creative intelligence studio
                      </span>
                      <h1>
                        Find the idea
                        <br />
                        worth <em>scaling.</em>
                      </h1>
                      <p>
                        Turn brand signals into sharper angles, stronger
                        creative, and reusable performance memory. Less creative
                        admin. More creative judgment.
                      </p>
                      <div className="neo-hero-meta">
                        <span className="neo-status-pill">
                          {state.brand
                            ? `${state.brand.name} workspace ready`
                            : "Waiting for a brand"}
                        </span>
                        <span className="neo-status-pill">
                          Signal → idea → evidence
                        </span>
                      </div>
                    </div>
                    <aside
                      className="neo-hero-signals"
                      aria-label="Creative welcome motion"
                    >
                      <div className="neo-signal-card neo-signal-primary">
                        <span>Creative playground</span>
                        <div className="neo-motion-stage" aria-hidden="true">
                          <div className="neo-spark-lines">
                            <i />
                            <i />
                            <i />
                            <i />
                            <i />
                          </div>
                          <div className="neo-motion-stack">
                            <i />
                            <i />
                            <i />
                          </div>
                        </div>
                        <div>
                          <b>
                            Upload signal.
                            <br />
                            Shape the brief.
                            <br />
                            Build the set.
                          </b>
                          <small>
                            A lighter welcome that keeps the energy high without
                            turning the page into a scorecard.
                          </small>
                        </div>
                      </div>
                      <div className="neo-signal-card neo-signal-lime">
                        <span>What neo is doing</span>
                        <div className="neo-orbit-wrap">
                          <div>
                            <b>
                              Connecting
                              <br />
                              brand cues
                            </b>
                            <small>
                              CI, references, product truths, and business
                              context travel with the work.
                            </small>
                          </div>
                          <div className="neo-orbit" aria-hidden="true">
                            <i />
                            <i />
                            <i />
                          </div>
                        </div>
                      </div>
                      <div className="neo-signal-card neo-signal-orange">
                        <div className="neo-flip-words" aria-label="Creative principles">
                          <b>Make it clearer.</b>
                          <b>Make it sharper.</b>
                          <b>Make it memorable.</b>
                        </div>
                      </div>
                    </aside>
                  </section>
                ) : null}
                <fieldset className="neo-run-edit-scope" disabled={!runCanEdit}>
                  <CurrentStage
                    state={state}
                    dispatch={dispatch}
                    onCreateRun={() => createRun(true)}
                  />
                </fieldset>
              </>
            )}
          </div>
        </main>
      </div>
      {visibleToast ? (
        <div
          className="toast-wrap"
          role={visibleToast.tone === "success" ? "status" : "alert"}
          aria-live={visibleToast.tone === "success" ? "polite" : "assertive"}
        >
          <div className={`toast show neo-action-toast ${visibleToast.tone}`}>
            <span className="neo-action-toast-icon" aria-hidden="true">
              {visibleToast.tone === "success" ? (
                <Check size={15} weight="bold" />
              ) : (
                <WarningCircle size={15} weight="fill" />
              )}
            </span>
            <span className="neo-action-toast-copy">
              <b>{visibleToast.title}</b>
              <span>{visibleToast.message}</span>
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function NavigationRail({
  workspace,
  state,
  dispatch,
  workspaceDispatch,
  createRun
}: {
  workspace: WorkspaceState;
  state: WorkflowState;
  dispatch: Dispatch<WorkflowAction>;
  workspaceDispatch: Dispatch<WorkspaceAction>;
  createRun: (keepBrand: boolean) => void;
}) {
  const learnAction: WorkflowAction = { type: "set-stage", stage: "summary" };
  const learnBlocked = workflowActionBlockReason(state, learnAction);

  const openStudioStage = (stage: CreativeStage) => {
    workspaceDispatch({ type: "set-view", view: "studio" });
    dispatch({ type: "set-stage", stage });
  };

  return (
    <aside className="neo-rail" aria-label="Primary navigation">
      <button
        className="neo-logo-button"
        type="button"
        aria-label="Open Neo studio"
        onClick={() => workspaceDispatch({ type: "set-view", view: "studio" })}
      >
        neo
      </button>
      <nav className="neo-rail-nav">
        <button
          className={workspace.view === "studio" ? "active" : ""}
          type="button"
          onClick={() => workspaceDispatch({ type: "set-view", view: "studio" })}
        >
          <SquaresFour size={21} weight="duotone" aria-hidden="true" />
          <span>Studio</span>
        </button>
        <button
          className={workspace.view === "overview" ? "active" : ""}
          type="button"
          onClick={() => workspaceDispatch({ type: "set-view", view: "overview" })}
        >
          <Kanban size={21} weight="duotone" aria-hidden="true" />
          <span>Workboard</span>
        </button>
        <button
          type="button"
          onClick={() => workspaceDispatch({ type: "set-view", view: "overview" })}
        >
          <Tray size={21} weight="duotone" aria-hidden="true" />
          <span>Inbox</span>
        </button>
        <button type="button" onClick={() => openStudioStage("start")}>
          <Books size={21} weight="duotone" aria-hidden="true" />
          <span>Library</span>
        </button>
        <button
          type="button"
          disabled={Boolean(learnBlocked)}
          title={learnBlocked ?? undefined}
          onClick={() => openStudioStage("summary")}
        >
          <Lightbulb size={21} weight="duotone" aria-hidden="true" />
          <span>Learnings</span>
        </button>
      </nav>
      <button
        className="neo-rail-create"
        type="button"
        onClick={() => createRun(true)}
      >
        <Plus size={21} weight="bold" aria-hidden="true" />
        <span>New</span>
      </button>
    </aside>
  );
}

function Header({
  workspace,
  state,
  dispatch,
  workspaceDispatch,
  createRun,
  canEdit
}: {
  workspace: WorkspaceState;
  state: WorkflowState;
  dispatch: Dispatch<WorkflowAction>;
  workspaceDispatch: Dispatch<WorkspaceAction>;
  createRun: (keepBrand: boolean) => void;
  canEdit: boolean;
}) {
  return (
    <header className="topbar">
      <div className="shell">
        <div className="nav">
          {workspace.view === "studio" ? (
            <Journey state={state} dispatch={dispatch} canEdit={canEdit} />
          ) : (
            <div className="neo-workboard-label">
              <Kanban size={20} weight="duotone" aria-hidden="true" />
              <span><b>Workboard</b><small>Live workspace decisions</small></span>
            </div>
          )}
          <div className="nav-right">
            <NotificationMailbox
              onOpenNotification={(notification, brand) => {
                workspaceDispatch({ type: "set-view", view: "studio" });
                dispatch({ type: "set-stage", stage: "start" });
                if (
                  brand &&
                  ["ready", "needs_review"].includes(notification.status)
                ) {
                  dispatch({ type: "select-brand", brand });
                }
              }}
            />
            <div className="client-pill">
              <span className="mini-avatar">
                {brandLogoUrl(state.brand) ? (
                  <img src={brandLogoUrl(state.brand)} alt="" />
                ) : (
                  state.brand?.initials ?? "MO"
                )}
              </span>
              <span>{state.brand?.name ?? "No client"}</span>
            </div>
            <AccountMenu />
            <button
              className="btn ghost refresh"
              type="button"
              title="Refresh studio"
              aria-label="Refresh studio"
              onClick={() => createRun(false)}
            >
              <ArrowClockwise size={18} weight="bold" aria-hidden="true" />
            </button>
          </div>
        </div>
        {workspace.view === "studio" ? (
          <>
            <RunBar
              workspace={workspace}
              workspaceDispatch={workspaceDispatch}
              createRun={createRun}
            />
            <MemoryRibbon state={state} />
          </>
        ) : null}
      </div>
    </header>
  );
}

function AccountMenu() {
  const { enabled, session, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!enabled || !session) return null;

  const email = session.user.email ?? "Signed-in account";

  async function handleSignOut() {
    setPending(true);
    setError(null);
    try {
      await signOut();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign out.");
      setPending(false);
    }
  }

  return (
    <div className="neo-account-wrap">
      <button
        className={`neo-account-button ${open ? "open" : ""}`}
        type="button"
        aria-label="Open account menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
          setError(null);
        }}
      >
        <UserCircle size={20} weight="duotone" aria-hidden="true" />
      </button>
      {open ? (
        <div className="neo-account-popover" role="dialog" aria-label="Account">
          <div className="neo-account-copy">
            <span>Signed in as</span>
            <b>{email}</b>
          </div>
          <button type="button" disabled={pending} onClick={handleSignOut}>
            <SignOut size={17} weight="bold" aria-hidden="true" />
            {pending ? "Signing out…" : "Sign out"}
          </button>
          {error ? <p role="alert">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export function NotificationMailbox({
  onOpenNotification
}: {
  onOpenNotification: (
    notification: BrandNotification,
    brand: Brand | undefined
  ) => void;
}) {
  const {
    brands,
    notifications,
    unreadNotificationCount,
    markAllNotificationsRead
  } = useBrands();
  const [open, setOpen] = useState(false);

  function toggleMailbox() {
    const next = !open;
    setOpen(next);
    if (next) markAllNotificationsRead();
  }

  return (
    <div className="neo-notification-wrap">
      <button
        className={`neo-notification-button ${open ? "open" : ""}`}
        type="button"
        aria-label={
          unreadNotificationCount
            ? `Notifications, ${unreadNotificationCount} unread`
            : "Notifications"
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggleMailbox}
      >
        <Bell size={18} weight="regular" aria-hidden="true" />
        {unreadNotificationCount ? (
          <span className="neo-notification-badge" aria-hidden="true" />
        ) : null}
      </button>
      {open ? (
        <section
          className="neo-notification-popover"
          role="dialog"
          aria-label="Notifications"
        >
          <header>
            <div>
              <b>Notifications</b>
              <span>Brand setup updates</span>
            </div>
            <button
              type="button"
              aria-label="Close notifications"
              onClick={() => setOpen(false)}
            >
              <X size={18} weight="bold" aria-hidden="true" />
            </button>
          </header>
          <div className="neo-notification-list">
            {notifications.length ? (
              notifications.map((notification) => {
                const brand = brands.find(
                  (candidate) => candidate.id === notification.brandId
                );
                return (
                  <button
                    className={`neo-notification-item ${notification.status}`}
                    type="button"
                    key={notification.id}
                    onClick={() => {
                      onOpenNotification(notification, brand);
                      setOpen(false);
                    }}
                  >
                    <span className="neo-notification-avatar">
                      {brand?.initials ??
                        notification.brandName.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="neo-notification-copy">
                      <b>{notification.title}</b>
                      <span>{notification.message}</span>
                      <small>
                        {["failed", "stalled"].includes(notification.status)
                          ? "Open Signal"
                          : "Open brand"}
                      </small>
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="neo-notification-empty">
                <Bell size={22} weight="duotone" aria-hidden="true" />
                <b>No notifications yet</b>
                <span>Completed brand setups will appear here.</span>
              </div>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function RunBar({
  workspace,
  workspaceDispatch,
  createRun
}: {
  workspace: WorkspaceState;
  workspaceDispatch: Dispatch<WorkspaceAction>;
  createRun: (keepBrand: boolean) => void;
}) {
  return (
    <div className="runs-bar">
      <div className="runs-tabs">
        {workspace.runOrder.map((runId) => {
          const run = workspace.runsById[runId];
          if (!run) return null;
          const status = runStatus(run);
          return (
            <div
              className={`run-tab ${run.id === workspace.activeRunId ? "on" : ""}`}
              key={run.id}
            >
              <button
                className="run-tab-main"
                type="button"
                onClick={() =>
                  workspaceDispatch({ type: "switch-run", id: run.id })
                }
              >
                <span className={`run-dot ${status}`} />
                <span className="run-tab-av">{run.brand?.initials ?? "−"}</span>
                <span className="run-tab-meta">
                  <b>{run.brand?.name ?? "New run"}</b>
                  <small>
                    {creativeMixItems(run).length === 1
                      ? serviceLabels[run.service]
                      : `${creativeMixItems(run).length} content types`} ·{" "}
                    {stages.find((stage) => stage.id === run.stage)?.name}
                  </small>
                </span>
              </button>
              {workspace.runOrder.length > 1 ? (
                <button
                  className="run-x"
                  type="button"
                  title="Close this run"
                  aria-label={`Close ${run.brand?.name ?? "new"} run`}
                  onClick={() =>
                    workspaceDispatch({ type: "close-run", id: run.id })
                  }
                >
                  ×
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <button
        className="runs-new"
        type="button"
        onClick={() => createRun(true)}
      >
        + New creative
      </button>
    </div>
  );
}

function Journey({
  state,
  dispatch,
  canEdit
}: {
  state: WorkflowState;
  dispatch: Dispatch<WorkflowAction>;
  canEdit: boolean;
}) {
  const activeIndex = stages.findIndex((stage) => stage.id === state.stage);
  const progress = (activeIndex / (stages.length - 1)) * 100;
  const highestUnlocked = useMemo(
    () => highestUnlockedStageIndex(state),
    [state]
  );

  return (
    <div className="journey-wrap">
      <div className="journey-track">
        <div className="journey-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="journey" role="tablist" aria-label="Creative run steps">
        {stages.map((stage, index) => {
          const locked = index > highestUnlocked;
          const navigationAction: WorkflowAction = {
            type: "set-stage",
            stage: stage.id
          };
          const blockedReason = workflowActionBlockReason(
            state,
            navigationAction
          );
          const active = stage.id === state.stage;
          const done = index < activeIndex;
          return (
            <button
              key={stage.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={
                blockedReason
                  ? `${stage.name} (${blockedReason})`
                  : active
                    ? `${stage.name} (current)`
                    : stage.name
              }
              disabled={locked || !canEdit}
              title={blockedReason ?? undefined}
              className={`${active ? "active" : ""} ${done ? "done" : ""} ${locked ? "locked" : ""}`}
              onClick={() => dispatch(navigationAction)}
            >
              <StageIcon stage={stage.id} done={done} />
              <b>{stage.name}</b>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StageIcon({
  stage,
  done
}: {
  stage: CreativeStage;
  done: boolean;
}) {
  if (done) {
    return <CheckCircle size={18} weight="fill" aria-hidden="true" />;
  }
  switch (stage) {
    case "start":
      return <ChartLineUp size={18} weight="duotone" aria-hidden="true" />;
    case "brief":
      return <NotePencil size={18} weight="duotone" aria-hidden="true" />;
    case "directions":
      return <Sparkle size={18} weight="duotone" aria-hidden="true" />;
    case "studio":
      return <PaintBrush size={18} weight="duotone" aria-hidden="true" />;
    case "approval":
      return <ShieldCheck size={18} weight="duotone" aria-hidden="true" />;
    case "client":
      return <Users size={18} weight="duotone" aria-hidden="true" />;
    case "summary":
      return <Brain size={18} weight="duotone" aria-hidden="true" />;
  }
}

function MemoryRibbon({ state }: { state: WorkflowState }) {
  if (!state.brand) return null;

  return (
    <div className="memory-ribbon show">
      <div className="ribbon">
        <div className="ribbon-brand">
          <span className="big-avatar">
            {brandLogoUrl(state.brand) ? (
              <img src={brandLogoUrl(state.brand)} alt="" />
            ) : (
              state.brand.initials
            )}
          </span>
          <span>
            <b>{state.brand.name}</b>
            <span>{state.brand.category}</span>
          </span>
        </div>
        <div className="ribbon-chips">
          <span className="rchip">
            Brand kit <b>{state.brand.library.brand.length}</b>
          </span>
          <span className="rchip">
            Products <b>{state.brand.library.products.length}</b>
          </span>
          <span className="rchip">
            Docs <b>{state.brand.library.docs.length}</b>
          </span>
          <span className="rchip">
            References <b>{state.brand.library.refs.length}</b>
          </span>
          <span className="rchip learn">Learning active</span>
        </div>
      </div>
    </div>
  );
}

function CurrentStage({
  state,
  dispatch,
  onCreateRun
}: {
  state: WorkflowState;
  dispatch: Dispatch<WorkflowAction>;
  onCreateRun: () => void;
}) {
  const props = { state, dispatch };
  switch (state.stage) {
    case "start":
      return <StartStage {...props} />;
    case "brief":
      return <BriefStage {...props} />;
    case "directions":
      return <DirectionsStage {...props} />;
    case "studio":
      return <StudioStage {...props} />;
    case "approval":
      return <ApprovalStage {...props} />;
    case "client":
      return <ClientStage {...props} />;
    case "summary":
      return <SummaryStage {...props} onCreateRun={onCreateRun} />;
  }
}

export function stageIndex(stage: CreativeStage): number {
  return stages.findIndex((candidate) => candidate.id === stage);
}
