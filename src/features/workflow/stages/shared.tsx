import {
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode
} from "react";
import {
  defaultHookGenerationModels,
  hookGenerationModelLabel,
  isOpenRouterModelId,
  MAX_HOOK_GENERATION_MODELS,
  openRouterHookGenerationModels,
  type HookGenerationModel
} from "../../../domain/creative-run";
import type { WorkflowAction, WorkflowState } from "../model";

const SAVED_HOOK_MODELS_STORAGE_KEY = "moons.saved-hook-models.v1";

function readSavedHookModels(): readonly HookGenerationModel[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(SAVED_HOOK_MODELS_STORAGE_KEY) ?? "[]"
    );
    return Array.isArray(parsed)
      ? Array.from(
          new Set(
            parsed.filter(
              (model): model is HookGenerationModel =>
                isOpenRouterModelId(model)
            )
          )
        )
      : [];
  } catch {
    return [];
  }
}

function saveHookModels(models: readonly HookGenerationModel[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    SAVED_HOOK_MODELS_STORAGE_KEY,
    JSON.stringify(models.filter(isOpenRouterModelId))
  );
}

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
  const [open, setOpen] = useState(false);
  const [modelDraft, setModelDraft] = useState("");
  const [modelError, setModelError] = useState<string | null>(null);
  const [savedModels, setSavedModels] =
    useState<readonly HookGenerationModel[]>(readSavedHookModels);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const storedModels = state.hookGenerationModels?.length
    ? state.hookGenerationModels
    : [state.hookGenerationModel];
  const visibleStoredModels = storedModels.filter(
    (model) => model !== "n8n-compass-new"
  );
  const selectedModels = visibleStoredModels.length
    ? visibleStoredModels
    : [...defaultHookGenerationModels];
  const selectedSet = new Set(selectedModels);
  const savedModelCatalog = Array.from(
    new Set<HookGenerationModel>([
      ...openRouterHookGenerationModels,
      ...savedModels,
      ...selectedModels
    ])
  );
  const summary =
    selectedModels.length === 1
      ? hookGenerationModelLabel(selectedModels[0]!)
      : `Compare ${selectedModels.length} models`;

  useEffect(() => {
    if (!open) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (
      storedModels.length !== selectedModels.length ||
      storedModels.some((model, index) => model !== selectedModels[index])
    ) {
      dispatch({ type: "set-hook-generation-models", models: selectedModels });
    }
  }, [dispatch, selectedModels, storedModels]);

  function addModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const model = modelDraft.trim();
    if (!isOpenRouterModelId(model)) {
      setModelError("Use an OpenRouter model ID in provider/model format.");
      return;
    }
    if (savedModelCatalog.includes(model)) {
      setModelError("This model is already saved.");
      return;
    }
    const nextSavedModels = [...savedModels, model];
    setSavedModels(nextSavedModels);
    saveHookModels(nextSavedModels);
    if (selectedModels.length < MAX_HOOK_GENERATION_MODELS) {
      dispatch({
        type: "set-hook-generation-models",
        models: [...selectedModels, model]
      });
    } else {
      setModelError("Model saved. Unselect another model to use it.");
    }
    setModelDraft("");
    if (selectedModels.length < MAX_HOOK_GENERATION_MODELS) {
      setModelError(null);
    }
  }

  function toggleModel(model: HookGenerationModel) {
    if (selectedSet.has(model)) {
      if (selectedModels.length === 1) {
        setModelError("Keep at least one Hook model selected.");
        return;
      }
      dispatch({
        type: "set-hook-generation-models",
        models: selectedModels.filter((selected) => selected !== model)
      });
      setModelError(null);
      return;
    }
    if (selectedModels.length >= MAX_HOOK_GENERATION_MODELS) {
      setModelError(`Select up to ${MAX_HOOK_GENERATION_MODELS} models.`);
      return;
    }
    dispatch({
      type: "set-hook-generation-models",
      models: [...selectedModels, model]
    });
    setModelError(null);
  }

  return (
    <div className="compass-hook-model-picker" ref={pickerRef}>
      <button
        type="button"
        className="compass-hook-model-trigger"
        ref={triggerRef}
        aria-label="Hook generation models"
        aria-expanded={open}
        aria-haspopup="true"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{summary}</span>
        <small>{selectedModels.length > 1 ? "Run together" : "Model"}</small>
      </button>
      {open ? (
        <div
          className="compass-hook-model-panel"
          role="group"
          aria-labelledby={titleId}
        >
          <h3 id={titleId}>Hook models</h3>
          <p>
            Save OpenRouter model IDs, then select up to {MAX_HOOK_GENERATION_MODELS}
            {" "}to run together.
          </p>
          <div className="compass-hook-model-options" aria-label="Saved models">
            {savedModelCatalog.map((model) => (
              <label
                className="compass-hook-model-option"
                data-selected={selectedSet.has(model)}
                key={model}
              >
                <input
                  type="checkbox"
                  checked={selectedSet.has(model)}
                  disabled={disabled}
                  aria-label={`${selectedSet.has(model) ? "Unselect" : "Select"} ${model}`}
                  onChange={() => toggleModel(model)}
                />
                <span>
                  <strong>{hookGenerationModelLabel(model)}</strong>
                  <code>{model}</code>
                </span>
                <small>{selectedSet.has(model) ? "Selected" : "Available"}</small>
              </label>
            ))}
          </div>
          <form className="compass-hook-model-form" onSubmit={addModel}>
            <label className="sr-only" htmlFor={`${titleId}-input`}>
              OpenRouter model ID
            </label>
            <input
              id={`${titleId}-input`}
              type="text"
              value={modelDraft}
              placeholder="provider/model"
              autoComplete="off"
              disabled={disabled}
              aria-describedby={modelError ? `${titleId}-error` : undefined}
              onChange={(event) => {
                setModelDraft(event.target.value);
                setModelError(null);
              }}
            />
            <button
              type="submit"
              disabled={
                disabled ||
                !modelDraft.trim()
              }
            >
              Add model
            </button>
          </form>
          {modelError ? (
            <p className="compass-hook-model-error" id={`${titleId}-error`} role="alert">
              {modelError}
            </p>
          ) : null}
          <a
            className="compass-hook-model-catalog-link"
            href="https://openrouter.ai/models"
            target="_blank"
            rel="noreferrer"
          >
            Browse OpenRouter models
          </a>
        </div>
      ) : null}
    </div>
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
