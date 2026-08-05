import type { Dispatch, ReactNode } from "react";
import type { WorkflowAction, WorkflowState } from "../model";

export interface StageProps {
  state: WorkflowState;
  dispatch: Dispatch<WorkflowAction>;
}

export function HookIdeaModeSelect({
  disabled,
  state,
  dispatch
}: {
  disabled: boolean;
  state: WorkflowState;
  dispatch: Dispatch<WorkflowAction>;
}) {
  return (
    <label className="compass-hook-mode-toggle">
      <span className="sr-only">Hook research mode</span>
      <select
        aria-label="Hook research mode"
        disabled={disabled}
        value={state.hookIdeaMode}
        onChange={(event) =>
          dispatch({
            type: "set-hook-idea-mode",
            mode: event.target.value as WorkflowState["hookIdeaMode"]
          })
        }
      >
        <option value="fresh-research">Search by default (Thailand)</option>
        <option value="standard">No research</option>
      </select>
    </label>
  );
}

export function HookGenerationModelSelect({
  disabled,
  state,
  dispatch
}: {
  disabled: boolean;
  state: WorkflowState;
  dispatch: Dispatch<WorkflowAction>;
}) {
  return (
    <label className="compass-hook-mode-toggle">
      <span className="sr-only">Hook generation model</span>
      <select
        aria-label="Hook generation model"
        disabled={disabled}
        value={state.hookGenerationModel}
        onChange={(event) =>
          dispatch({
            type: "set-hook-generation-model",
            model: event.target.value as WorkflowState["hookGenerationModel"]
          })
        }
      >
        <option value="gpt-5.6-terra">GPT · OpenAI</option>
        <option value="anthropic/claude-sonnet-4.6">
          Claude · OpenRouter
        </option>
      </select>
    </label>
  );
}

export function DecisionCard({
  eyebrow,
  title,
  helper,
  status,
  statusClass = "",
  className = "",
  children,
  actions
}: {
  eyebrow: string;
  title: string;
  helper?: string;
  status: string;
  statusClass?: string;
  className?: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <section className="stage active">
      <div className={`decision-card ${className}`}>
        <div className="decision-head">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
            {helper ? <p className="decision-helper">{helper}</p> : null}
          </div>
          <span className={`pill ${statusClass}`}>{status}</span>
        </div>
        <div className="decision-body">{children}</div>
        <div className="decision-actions">{actions}</div>
      </div>
    </section>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
