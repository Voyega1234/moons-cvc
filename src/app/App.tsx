import {
  useCallback,
  useMemo,
  useState,
  type Dispatch
} from "react";
import {
  ArrowClockwise,
  Bell,
  Books,
  Brain,
  ChartLineUp,
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
  X
} from "@phosphor-icons/react";
import type { Brand } from "../domain/brand";
import {
  useBrands,
  type BrandNotification
} from "./providers/brand-provider";
import { useWorkspace } from "./providers/workspace-provider";
import type { CreativeStage } from "../domain/creative-run";
import { serviceLabels, stages } from "../features/workflow/config";
import type {
  WorkspaceAction,
  WorkspaceState,
  WorkflowAction,
  WorkflowState
} from "../features/workflow/model";
import {
  creativeMixItems,
  totalCreativeMixQuantity
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

  // Bound to state.id (not "whichever run is active") so that an async
  // action started against this run — hook generation, artwork generation,
  // etc. — still lands on THIS run even if the user switches to a different
  // run or tab before the request resolves. Recreating this callback when
  // state.id changes is what makes it work: an in-flight promise's .then()
  // closes over the dispatch instance (and therefore the runId) that was
  // current when the action was kicked off, not whatever is active later.
  const dispatch = useCallback<Dispatch<WorkflowAction>>(
    (action) =>
      workspaceDispatch({
        type: "apply-run-action",
        runId: state.id,
        action,
        now: nowIso()
      }),
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
    Boolean(workspace.toast),
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
                {state.stage === "start" ? (
                  <section className="hero neo-hero">
                    <div className="neo-hero-copy">
                      <span className="neo-kicker">
                        <span aria-hidden="true" /> Creative intelligence studio
                      </span>
                      <h1>{stage.hero}</h1>
                      <p>{stage.sub}</p>
                    </div>
                    <aside className="neo-hero-signals" aria-label="Run summary">
                      <div className="neo-signal-card neo-signal-primary">
                        <span>Active brand</span>
                        <b>{state.brand?.name ?? "Choose a brand"}</b>
                        <small>Memory and approved signals</small>
                      </div>
                      <div className="neo-signal-card neo-signal-lime">
                        <span>Creative set</span>
                        <b>{totalCreativeMixQuantity(state)}</b>
                        <small>
                          {creativeMixItems(state).length} content
                          {creativeMixItems(state).length === 1 ? " type" : " types"}
                        </small>
                      </div>
                      <div className="neo-signal-card neo-signal-orange">
                        <span>Workflow</span>
                        <b>7</b>
                        <small>Connected decisions</small>
                      </div>
                    </aside>
                  </section>
                ) : null}
                <CurrentStage
                  state={state}
                  dispatch={dispatch}
                  onCreateRun={() => createRun(true)}
                />
              </>
            )}
          </div>
        </main>
      </div>
      <div className="toast-wrap" role="status" aria-live="polite">
        {persistenceError ? (
          <div className="toast show persistence-toast">
            {persistenceError.message}
          </div>
        ) : null}
        {workspace.toast ? (
          <div className="toast show">{workspace.toast}</div>
        ) : null}
      </div>
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
  createRun
}: {
  workspace: WorkspaceState;
  state: WorkflowState;
  dispatch: Dispatch<WorkflowAction>;
  workspaceDispatch: Dispatch<WorkspaceAction>;
  createRun: (keepBrand: boolean) => void;
}) {
  return (
    <header className="topbar">
      <div className="shell">
        <div className="nav">
          {workspace.view === "studio" ? (
            <Journey state={state} dispatch={dispatch} />
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
                if (brand && notification.status !== "failed") {
                  dispatch({ type: "select-brand", brand });
                }
              }}
            />
            <div className="client-pill">
              <span className="mini-avatar">
                {state.brand?.initials ?? "MO"}
              </span>
              <span>{state.brand?.name ?? "No client"}</span>
            </div>
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
                        {notification.status === "failed"
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
  dispatch
}: {
  state: WorkflowState;
  dispatch: Dispatch<WorkflowAction>;
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
              disabled={locked}
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
          <span className="big-avatar">{state.brand.initials}</span>
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
