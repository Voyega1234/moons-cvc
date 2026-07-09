import {
  useCallback,
  useMemo,
  type Dispatch
} from "react";
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

  const dispatch = useCallback<Dispatch<WorkflowAction>>(
    (action) =>
      workspaceDispatch({
        type: "update-active-run",
        action,
        now: nowIso()
      }),
    []
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
      className={`app ${workspace.view === "overview" ? "mode-overview" : ""}`}
    >
      <Header
        workspace={workspace}
        state={state}
        dispatch={dispatch}
        workspaceDispatch={workspaceDispatch}
        createRun={createRun}
      />
      <main>
        <div className="shell">
          {workspace.view === "overview" ? (
            <Overview
              state={state}
              dispatch={dispatch}
              onOpenStudio={() =>
                workspaceDispatch({ type: "set-view", view: "studio" })
              }
            />
          ) : (
            <>
              <section className="hero">
                <div>
                  <h1>{stage.hero}</h1>
                  <p>{stage.sub}</p>
                </div>
                <aside>
                  <span className="pill">
                    {state.brand
                      ? `${state.brand.name} · ${serviceLabels[state.service]} · ${state.quantity}`
                      : "Waiting for client"}
                  </span>
                </aside>
              </section>
              <CurrentStage
                state={state}
                dispatch={dispatch}
                onCreateRun={() => createRun(true)}
              />
            </>
          )}
        </div>
      </main>
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
          <button
            className="brand"
            type="button"
            onClick={() =>
              workspaceDispatch({ type: "set-view", view: "overview" })
            }
          >
            <span className="logo" aria-hidden="true" />
            <span>
              <b>Moons</b>
              <span>Creative OS</span>
            </span>
          </button>
          <div className="view-toggle">
            <button
              type="button"
              className={workspace.view === "overview" ? "on" : ""}
              onClick={() =>
                workspaceDispatch({ type: "set-view", view: "overview" })
              }
            >
              Overview
            </button>
            <button
              type="button"
              className={workspace.view === "studio" ? "on" : ""}
              onClick={() =>
                workspaceDispatch({ type: "set-view", view: "studio" })
              }
            >
              Studio
            </button>
          </div>
          <div className="nav-right">
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
              ↻
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
            <Journey state={state} dispatch={dispatch} />
            <MemoryRibbon state={state} />
          </>
        ) : null}
      </div>
    </header>
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
                    {serviceLabels[run.service]} ·{" "}
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
              <span className="phase" aria-hidden="true">
                <span className="moon-phase" />
              </span>
              <b>{stage.name}</b>
            </button>
          );
        })}
      </div>
    </div>
  );
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
