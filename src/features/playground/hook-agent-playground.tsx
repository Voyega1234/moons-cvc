import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BracketsCurly,
  CaretDown,
  Check,
  ClockCounterClockwise,
  Copy,
  Flask,
  MagnifyingGlass,
  Play,
  SlidersHorizontal,
  Sparkle,
  WarningCircle
} from "@phosphor-icons/react";
import { useBrands } from "../../app/providers/brand-provider";
import { env } from "../../config/env";
import type { Brand } from "../../domain/brand";
import {
  defaultHookGenerationModels,
  hookGenerationModelLabel,
  hookGenerationModels,
  hookGenerationProviderLabel,
  isOpenRouterModelId,
  MAX_HOOK_GENERATION_MODELS,
  type ServiceType
} from "../../domain/creative-run";
import { getSupabaseClient } from "../../lib/supabase/client";
import { buildOnboardingQuestionnaireHookContext } from "../../services/creative-generation/onboarding-questionnaire-hook-context";
import {
  normalizeCreativeDirections,
  type RawDirection
} from "../../services/creative-generation/hook-generation-types";
import { BrandLogo } from "../../shared/components/brand-logo";
import type { HookResearchDossier } from "../../server/hook-generation/hook-research-agent";

const playgroundModels: readonly string[] = hookGenerationModels.filter(
  (model) => model !== "n8n-compass-new"
);

const contentTypes: readonly {
  value: ServiceType;
  label: string;
  helper: string;
}[] = [
  { value: "single-static", label: "Single", helper: "Static idea" },
  { value: "album-post", label: "Album", helper: "Multi-panel" },
  { value: "ugc-video", label: "UGC", helper: "Video concept" }
];

interface PlaygroundResult {
  model: string;
  directions: ReturnType<typeof normalizeCreativeDirections>;
  elapsedMs: number;
}

interface PromptResponse {
  ok?: boolean;
  prompt?: string;
  error?: string;
}

interface GenerationResponse {
  directions?: readonly RawDirection[];
  researchDossier?: HookResearchDossier;
  error?: string;
}

interface PlaygroundExperiment {
  id: string;
  createdAt: string;
  brandId: string;
  brandName: string;
  models: readonly string[];
  request: ReturnType<typeof buildPlaygroundRequest>;
  originalPrompt: string;
  includeQuestionnaire: boolean;
  includeBrief: boolean;
  selectedBrandItemIds: readonly string[];
  researchDossier: HookResearchDossier;
  results: readonly PlaygroundResult[];
  errors: readonly string[];
}

export interface PromptDiffLine {
  type: "same" | "added" | "removed";
  text: string;
}

const PLAYGROUND_HISTORY_KEY = "moons.hook-playground.experiments.v1";
const PLAYGROUND_HISTORY_LIMIT = 6;
export const PLAYGROUND_MODEL_LIMIT = MAX_HOOK_GENERATION_MODELS;

export function HookAgentPlayground() {
  const { brands, loading: brandsLoading, error: brandsError } = useBrands();
  const [brandId, setBrandId] = useState("");
  const [brandQuery, setBrandQuery] = useState("");
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const [activeBrandIndex, setActiveBrandIndex] = useState(0);
  const [selectedBrandItemIds, setSelectedBrandItemIds] = useState<Set<string>>(
    new Set()
  );
  const [includeQuestionnaire, setIncludeQuestionnaire] = useState(true);
  const [includeBrief, setIncludeBrief] = useState(true);
  const [showOptionalSources, setShowOptionalSources] = useState(false);
  const [brief, setBrief] = useState("");
  const [service, setService] = useState<ServiceType>("single-static");
  const [quantity, setQuantity] = useState(3);
  const [models, setModels] = useState<readonly string[]>(
    defaultHookGenerationModels
  );
  const [customModels, setCustomModels] = useState<readonly string[]>([]);
  const [modelInput, setModelInput] = useState("");
  const [modelInputError, setModelInputError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [originalPrompt, setOriginalPrompt] = useState("");
  const [promptView, setPromptView] = useState<"edit" | "diff">("edit");
  const [promptLoading, setPromptLoading] = useState(true);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runningPhase, setRunningPhase] = useState<"research" | "models" | null>(
    null
  );
  const [researchDossier, setResearchDossier] =
    useState<HookResearchDossier | null>(null);
  const [runErrors, setRunErrors] = useState<readonly string[]>([]);
  const [results, setResults] = useState<readonly PlaygroundResult[]>([]);
  const [history, setHistory] = useState<readonly PlaygroundExperiment[]>(() =>
    loadExperimentHistory()
  );
  const [copied, setCopied] = useState(false);
  const pendingBrandItemIds = useRef<readonly string[] | null>(null);

  const systemBrands = useMemo(() => filterSystemBrands(brands), [brands]);
  const brand =
    systemBrands.find((candidate) => candidate.id === brandId) ?? null;
  const filteredBrands = useMemo(
    () => filterPlaygroundBrands(systemBrands, brandQuery, brand?.name),
    [brand?.name, brandQuery, systemBrands]
  );
  const promptDiff = useMemo(
    () => buildPromptDiff(originalPrompt, prompt),
    [originalPrompt, prompt]
  );
  const promptChangeCount = promptDiff.filter(
    (line) => line.type !== "same"
  ).length;
  const availableModels = useMemo(
    () => [...playgroundModels, ...customModels],
    [customModels]
  );

  useEffect(() => {
    if (!brand && systemBrands[0]) {
      setBrandId(getDefaultPlaygroundBrand(systemBrands).id);
    }
  }, [brand, systemBrands]);

  useEffect(() => {
    if (brand) setBrandQuery(brand.name);
  }, [brand?.id]);

  useEffect(() => {
    const restoredIds = pendingBrandItemIds.current ?? [];
    setSelectedBrandItemIds(new Set(restoredIds));
    setShowOptionalSources(restoredIds.length > 0);
    pendingBrandItemIds.current = null;
  }, [brand?.id]);

  useEffect(() => {
    let active = true;
    void loadPrompt()
      .then((value) => {
        if (!active) return;
        setPrompt(value);
        setOriginalPrompt(value);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setPromptError(
          error instanceof Error ? error.message : "Prompt could not be loaded."
        );
      })
      .finally(() => {
        if (active) setPromptLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const requestPreview = useMemo(
    () => buildPlaygroundRequest({
      brand,
      selectedBrandItemIds,
      includeQuestionnaire,
      includeBrief,
      brief,
      service,
      quantity,
      prompt,
      generationModel: models[0] ?? defaultHookGenerationModels[0]
    }),
    [
      brand,
      selectedBrandItemIds,
      includeQuestionnaire,
      includeBrief,
      brief,
      service,
      quantity,
      prompt,
      models
    ]
  );

  const canRun = Boolean(brand && prompt.trim() && models.length && !running);

  function toggleBrandItem(id: string) {
    setSelectedBrandItemIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectBrand(nextBrand: Brand) {
    setBrandId(nextBrand.id);
    setBrandQuery(nextBrand.name);
    setBrandMenuOpen(false);
    setActiveBrandIndex(0);
  }

  function handleBrandSearchKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>
  ) {
    if (event.key === "Escape") {
      setBrandMenuOpen(false);
      setBrandQuery(brand?.name ?? "");
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!brandMenuOpen) setBrandMenuOpen(true);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveBrandIndex((current) =>
        filteredBrands.length
          ? (current + direction + filteredBrands.length) % filteredBrands.length
          : 0
      );
      return;
    }
    if (event.key === "Enter" && brandMenuOpen && filteredBrands.length) {
      event.preventDefault();
      selectBrand(filteredBrands[activeBrandIndex] ?? filteredBrands[0]!);
    }
  }

  function toggleModel(model: string) {
    setModels((current) => {
      const selected = current.includes(model);
      if (selected && current.length === 1) return current;
      if (!selected && current.length === PLAYGROUND_MODEL_LIMIT) return current;
      return selected
        ? current.filter((candidate) => candidate !== model)
        : [...current, model];
    });
  }

  function addCustomModel() {
    const model = modelInput.trim();
    if (!isValidOpenRouterModelId(model)) {
      setModelInputError("Use an OpenRouter model ID like provider/model.");
      return;
    }
    if (models.length === PLAYGROUND_MODEL_LIMIT && !models.includes(model)) {
      setModelInputError(
        `Remove a model before adding another (maximum ${PLAYGROUND_MODEL_LIMIT}).`
      );
      return;
    }
    if (!playgroundModels.includes(model)) {
      setCustomModels((current) =>
        current.includes(model) ? current : [...current, model]
      );
    }
    setModels((current) =>
      current.includes(model) ? current : [...current, model]
    );
    setModelInput("");
    setModelInputError(null);
  }

  async function runComparison() {
    if (!brand || !canRun) return;
    setRunning(true);
    setRunningPhase("research");
    setRunErrors([]);
    setResults([]);
    setResearchDossier(null);

    try {
      const runKey = Date.now();
      const researchResponse = await fetch(env.hookGenerationHarnessEndpoint, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          ...requestPreview,
          runId: `playground-${runKey}-research`,
          generationModel: "gpt-5.6-terra",
          researchOnly: true
        })
      });
      const researchPayload =
        (await researchResponse.json()) as GenerationResponse;
      if (!researchResponse.ok || !researchPayload.researchDossier) {
        throw new Error(
          researchPayload.error ||
            `Shared Research failed (${researchResponse.status}).`
        );
      }

      const sharedDossier = researchPayload.researchDossier;
      setResearchDossier(sharedDossier);
      setRunningPhase("models");

      const settled = await Promise.allSettled(
        models.map(async (model): Promise<PlaygroundResult> => {
          const startedAt = performance.now();
          const response = await fetch(env.hookGenerationHarnessEndpoint, {
            method: "POST",
            headers: await authHeaders(),
            body: JSON.stringify({
              ...requestPreview,
              runId: `playground-${runKey}-${model.replaceAll("/", "-")}`,
              generationModel: model,
              researchDossier: sharedDossier
            })
          });
          const payload = (await response.json()) as GenerationResponse;
          if (!response.ok || !Array.isArray(payload.directions)) {
            throw new Error(
              `${playgroundModelLabel(model)}: ${payload.error || `request failed (${response.status})`}`
            );
          }
          return {
            model,
            directions: normalizeCreativeDirections(payload.directions),
            elapsedMs: performance.now() - startedAt
          };
        })
      );

      const nextResults = settled.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []
      );
      const nextErrors = settled.flatMap((result) =>
        result.status === "rejected"
          ? [
              result.reason instanceof Error
                ? result.reason.message
                : "A model run failed."
            ]
          : []
      );
      setResults(nextResults);
      setRunErrors(nextErrors);

      const experiment: PlaygroundExperiment = {
        id: `experiment-${runKey}`,
        createdAt: new Date().toISOString(),
        brandId: brand.id,
        brandName: brand.name,
        models: [...models],
        request: requestPreview,
        originalPrompt,
        includeQuestionnaire,
        includeBrief,
        selectedBrandItemIds: [...selectedBrandItemIds],
        researchDossier: sharedDossier,
        results: nextResults,
        errors: nextErrors
      };
      setHistory((current) => {
        const next = [experiment, ...current].slice(
          0,
          PLAYGROUND_HISTORY_LIMIT
        );
        persistExperimentHistory(next);
        return next;
      });
    } catch (error) {
      setRunErrors([
        error instanceof Error ? error.message : "Comparison could not run."
      ]);
    } finally {
      setRunning(false);
      setRunningPhase(null);
    }
  }

  function restoreExperiment(experiment: PlaygroundExperiment) {
    setShowOptionalSources(experiment.selectedBrandItemIds.length > 0);
    if (brandId === experiment.brandId) {
      setSelectedBrandItemIds(new Set(experiment.selectedBrandItemIds));
    } else {
      pendingBrandItemIds.current = experiment.selectedBrandItemIds;
    }
    setBrandId(experiment.brandId);
    setIncludeQuestionnaire(experiment.includeQuestionnaire);
    setIncludeBrief(experiment.includeBrief);
    setBrief(
      experiment.includeBrief &&
        experiment.request.brief !== "No user brief selected."
        ? experiment.request.brief
        : ""
    );
    setService(experiment.request.service);
    setQuantity(experiment.request.quantity);
    setModels(experiment.models);
    setCustomModels(
      experiment.models.filter((model) => !playgroundModels.includes(model))
    );
    setPrompt(experiment.request.agentHookPrompt);
    setOriginalPrompt(experiment.originalPrompt);
    setPromptView("edit");
    setResearchDossier(experiment.researchDossier);
    setResults(experiment.results);
    setRunErrors(experiment.errors);
  }

  async function copyPayload() {
    await navigator.clipboard.writeText(JSON.stringify(requestPreview, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="compass-app playground-page">
      <header className="playground-topbar">
        <a href="/" className="playground-back">
          <ArrowLeft aria-hidden="true" size={18} />
          Back to workspace
        </a>
        <div className="playground-brandmark">
          <Flask aria-hidden="true" size={18} weight="fill" />
          Hook Agent Playground
        </div>
        <span className="playground-local-note">Internal testing</span>
      </header>

      <main className="playground-shell">
        <header className="playground-intro">
          <div>
            <span>Hook Agent workbench</span>
            <h1>Shape the input. Compare the judgment.</h1>
            <p>
              Test the live Hook pipeline with controlled brand context, prompt,
              and models before using it in a campaign.
            </p>
          </div>
          <button
            className="playground-run-button"
            type="button"
            disabled={!canRun}
            onClick={() => void runComparison()}
          >
            {running ? (
              <span className="playground-run-pulse" aria-hidden="true" />
            ) : (
              <Play aria-hidden="true" size={17} weight="fill" />
            )}
            {runningPhase === "research"
              ? "Researching once"
              : runningPhase === "models"
                ? `Running ${models.length} models`
                : "Run comparison"}
          </button>
        </header>

        <ExperimentHistory history={history} onRestore={restoreExperiment} />

        <div className="playground-workbench">
          <aside className="playground-controls" aria-label="Playground inputs">
            <section className="playground-control-section">
              <div className="playground-section-head">
                <span>Brand</span>
                <small>Required</small>
              </div>
              {brandsLoading ? (
                <div className="playground-skeleton is-field" />
              ) : brandsError ? (
                <p className="playground-inline-error">{brandsError.message}</p>
              ) : (
                <div
                  className="playground-brand-combobox"
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) {
                      setBrandMenuOpen(false);
                      setBrandQuery(brand?.name ?? "");
                    }
                  }}
                >
                  <div className="playground-brand-select">
                    {brand ? (
                      <span className="playground-brand-logo">
                        <BrandLogo brand={brand} />
                      </span>
                    ) : null}
                    <MagnifyingGlass aria-hidden="true" size={15} />
                    <input
                      type="search"
                      role="combobox"
                      aria-label="Search brand"
                      aria-expanded={brandMenuOpen}
                      aria-controls="playground-brand-results"
                      aria-autocomplete="list"
                      aria-activedescendant={
                        brandMenuOpen && filteredBrands[activeBrandIndex]
                          ? `playground-brand-${filteredBrands[activeBrandIndex].id}`
                          : undefined
                      }
                      value={brandQuery}
                      onFocus={() => setBrandMenuOpen(true)}
                      onClick={() => setBrandMenuOpen(true)}
                      onChange={(event) => {
                        const value = event.target.value;
                        setBrandQuery(value);
                        setBrandMenuOpen(true);
                        setActiveBrandIndex(0);
                      }}
                      onKeyDown={handleBrandSearchKeyDown}
                      placeholder="Search brand or category"
                    />
                  </div>
                  {brandMenuOpen ? (
                    <div
                      className="playground-brand-results"
                      id="playground-brand-results"
                      role="listbox"
                      aria-label="Brand results"
                    >
                      <div className="playground-brand-results-meta">
                        {filteredBrands.length} brands found
                      </div>
                      {filteredBrands.length ? (
                        filteredBrands.map((candidate, index) => (
                          <button
                            type="button"
                            role="option"
                            id={`playground-brand-${candidate.id}`}
                            aria-selected={candidate.id === brandId}
                            className={index === activeBrandIndex ? "active" : ""}
                            key={candidate.id}
                            onMouseEnter={() => setActiveBrandIndex(index)}
                            onClick={() => selectBrand(candidate)}
                          >
                            <span className="playground-brand-result-logo">
                              <BrandLogo brand={candidate} />
                            </span>
                            <span>
                              <b>{candidate.name}</b>
                              <small>{candidate.category}</small>
                            </span>
                            {candidate.id === brandId ? (
                              <Check aria-hidden="true" size={14} weight="bold" />
                            ) : null}
                          </button>
                        ))
                      ) : (
                        <p className="playground-brand-empty">
                          No brands match “{brandQuery}”
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </section>

            <section className="playground-control-section">
              <div className="playground-section-head">
                <span>Input sources</span>
                <small>Choose what the agent sees</small>
              </div>
              <div className="playground-source-list">
                <SourceToggle
                  checked={
                    includeQuestionnaire &&
                    Boolean(brand?.onboardingQuestionnaire)
                  }
                  label="Questionnaire"
                  helper={brand?.onboardingQuestionnaire ? "Brand onboarding" : "No data available"}
                  disabled={!brand?.onboardingQuestionnaire}
                  onChange={setIncludeQuestionnaire}
                />
                <SourceToggle
                  checked={includeBrief}
                  label="User brief"
                  helper="Campaign-specific direction"
                  onChange={setIncludeBrief}
                />
                <button
                  type="button"
                  className="playground-optional-source-toggle"
                  aria-expanded={showOptionalSources}
                  disabled={!brand?.library.brand.length}
                  onClick={() => setShowOptionalSources((current) => !current)}
                >
                  <span>
                    <b>Optional sources</b>
                    <small>
                      {brand?.library.brand.length
                        ? `${brand.library.brand.length} brand system items`
                        : "No additional sources"}
                    </small>
                  </span>
                  <CaretDown aria-hidden="true" size={15} weight="bold" />
                </button>
                {showOptionalSources ? (
                  <div className="playground-optional-sources">
                    {brand?.library.brand.map((item) => (
                      <SourceToggle
                        key={item.id}
                        checked={selectedBrandItemIds.has(item.id)}
                        label={item.title}
                        helper="Brand system"
                        onChange={() => toggleBrandItem(item.id)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
              {includeBrief ? (
                <label className="playground-brief-field">
                  <span>Campaign brief</span>
                  <textarea
                    rows={5}
                    value={brief}
                    onChange={(event) => setBrief(event.target.value)}
                    placeholder="เช่น โปรโมตสินค้าหลักให้คนทำงานวัย 28-40 สนใจทดลองใช้ โดยไม่ใช้คำเคลมเกินจริง"
                  />
                </label>
              ) : null}
            </section>

            <section className="playground-control-section">
              <div className="playground-section-head">
                <span>Output</span>
                <small>{quantity} ideas per model</small>
              </div>
              <div className="playground-type-grid">
                {contentTypes.map((item) => (
                  <button
                    type="button"
                    key={item.value}
                    className={service === item.value ? "selected" : ""}
                    onClick={() => setService(item.value)}
                  >
                    <b>{item.label}</b>
                    <small>{item.helper}</small>
                  </button>
                ))}
              </div>
              <label className="playground-quantity-field">
                <span>Ideas per model</span>
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={quantity}
                  onChange={(event) =>
                    setQuantity(Math.min(6, Math.max(1, Number(event.target.value))))
                  }
                />
              </label>
            </section>
          </aside>

          <div className="playground-editor-stack">
            <section className="playground-panel playground-payload-panel">
              <header>
                <div>
                  <BracketsCurly aria-hidden="true" size={18} />
                  <span>Input preview</span>
                </div>
                <button type="button" onClick={() => void copyPayload()}>
                  {copied ? <Check aria-hidden="true" size={15} /> : <Copy aria-hidden="true" size={15} />}
                  {copied ? "Copied" : "Copy JSON"}
                </button>
              </header>
              <pre>{JSON.stringify(requestPreview, null, 2)}</pre>
            </section>

            <section className="playground-panel playground-prompt-panel">
              <header>
                <div>
                  <SlidersHorizontal aria-hidden="true" size={18} />
                  <span>Hook Agent prompt</span>
                  {prompt !== originalPrompt ? <small>Edited</small> : null}
                </div>
                <div className="playground-panel-actions">
                  <button
                    type="button"
                    disabled={!promptChangeCount}
                    onClick={() =>
                      setPromptView((current) =>
                        current === "edit" ? "diff" : "edit"
                      )
                    }
                  >
                    {promptView === "edit"
                      ? `View diff (${promptChangeCount})`
                      : "Edit prompt"}
                  </button>
                  <button
                    type="button"
                    disabled={!originalPrompt || prompt === originalPrompt}
                    onClick={() => {
                      setPrompt(originalPrompt);
                      setPromptView("edit");
                    }}
                  >
                    Reset prompt
                  </button>
                </div>
              </header>
              {promptLoading ? (
                <div className="playground-skeleton is-editor" />
              ) : promptError ? (
                <div className="playground-panel-error">
                  <WarningCircle aria-hidden="true" size={20} />
                  <p>{promptError}</p>
                </div>
              ) : promptView === "diff" ? (
                <div className="playground-prompt-diff" aria-label="Prompt changes">
                  {promptDiff.map((line, index) => (
                    <div
                      className={`is-${line.type}`}
                      key={`${line.type}-${index}-${line.text}`}
                    >
                      <span aria-hidden="true">
                        {line.type === "added"
                          ? "+"
                          : line.type === "removed"
                            ? "-"
                            : " "}
                      </span>
                      <code>{line.text || " "}</code>
                    </div>
                  ))}
                </div>
              ) : (
                <textarea
                  aria-label="Hook Agent prompt"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  spellCheck={false}
                />
              )}
            </section>
          </div>
        </div>

        <ResearchDossierPanel
          dossier={researchDossier}
          loading={runningPhase === "research"}
          modelCount={models.length}
        />

        <section className="playground-model-section">
          <header>
            <div>
              <h2>Compare models</h2>
              <p>
                Select 1-{MAX_HOOK_GENERATION_MODELS} models. Each receives the
                exact same input and prompt.
              </p>
            </div>
            <span>{models.length} selected</span>
          </header>
          <div className="playground-custom-model">
            <div>
              <input
                type="text"
                aria-label="OpenRouter model ID"
                value={modelInput}
                onChange={(event) => {
                  setModelInput(event.target.value);
                  setModelInputError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addCustomModel();
                  }
                }}
                placeholder="sakana/sakana-namazu"
                disabled={running}
              />
              <button
                type="button"
                disabled={running || !modelInput.trim()}
                onClick={addCustomModel}
              >
                Add model
              </button>
            </div>
            <p className={modelInputError ? "is-error" : ""}>
              {modelInputError ?? (
                <>
                  Paste a model ID from{" "}
                  <a
                    href="https://openrouter.ai/models"
                    target="_blank"
                    rel="noreferrer"
                  >
                    OpenRouter Models
                  </a>
                </>
              )}
            </p>
          </div>
          <div className="playground-model-list">
            {availableModels.map((model) => {
              const checked = models.includes(model);
              return (
                <label className={checked ? "selected" : ""} key={model}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={
                      (checked && models.length === 1) ||
                      (!checked && models.length === PLAYGROUND_MODEL_LIMIT) ||
                      running
                    }
                    onChange={() => toggleModel(model)}
                  />
                  <span>
                    <b>{playgroundModelLabel(model)}</b>
                    <small>{playgroundModelProviderLabel(model)}</small>
                  </span>
                  {checked ? <Check aria-hidden="true" size={15} weight="bold" /> : null}
                </label>
              );
            })}
          </div>
        </section>

        <section className="playground-results" aria-live="polite">
          <header>
            <div>
              <h2>Idea output</h2>
              <p>Results stay separated by model so creative judgment is easy to scan.</p>
            </div>
          </header>

          {runErrors.length ? (
            <div className="playground-run-errors">
              <WarningCircle aria-hidden="true" size={20} />
              <div>{runErrors.map((error) => <p key={error}>{error}</p>)}</div>
            </div>
          ) : null}

          {running ? (
            <div className="playground-result-columns">
              {models.map((model) => (
                <section className="playground-result-column" key={model}>
                  <ResultColumnHeader model={model} />
                  <div className="playground-result-card-list">
                    {Array.from({ length: quantity }, (_, index) => (
                      <div className="playground-skeleton is-card" key={index} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : results.length ? (
            <div className="playground-result-columns">
              {results.map((result) => (
                <section className="playground-result-column" key={result.model}>
                  <ResultColumnHeader
                    model={result.model}
                    meta={`${result.directions.length} ideas in ${(result.elapsedMs / 1000).toFixed(1)}s`}
                  />
                  <div className="playground-result-card-list">
                    {result.directions.map((direction, index) => (
                      <article className="playground-idea-card" key={direction.id}>
                        <div className="playground-idea-meta">
                          <span>Idea {index + 1}</span>
                          <small>{contentTypes.find((item) => item.value === (direction.service ?? service))?.label}</small>
                        </div>
                        <h3>{direction.hook}</h3>
                        {direction.subheadline ? <p className="playground-subheadline">{direction.subheadline}</p> : null}
                        <div className="playground-idea-detail">
                          <span>Concept</span>
                          <p>{direction.concept}</p>
                        </div>
                        {direction.formatBeats?.length ? (
                          <div className="playground-idea-detail">
                            <span>Format beats</span>
                            <ol>{direction.formatBeats.map((beat) => <li key={beat}>{beat}</li>)}</ol>
                          </div>
                        ) : null}
                        <div className="playground-idea-detail is-cta">
                          <span>CTA</span>
                          <p>{direction.cta}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="playground-empty-results">
              <Sparkle aria-hidden="true" size={26} />
              <b>No ideas yet</b>
              <p>Review the payload and prompt, then run the selected models.</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function ExperimentHistory({
  history,
  onRestore
}: {
  history: readonly PlaygroundExperiment[];
  onRestore: (experiment: PlaygroundExperiment) => void;
}) {
  return (
    <details className="playground-history">
      <summary>
        <span>
          <ClockCounterClockwise aria-hidden="true" size={17} />
          Experiment history
        </span>
        <small>
          {history.length
            ? `${history.length} saved locally`
            : "No experiments saved"}
        </small>
      </summary>
      <div className="playground-history-body">
        {history.length ? (
          <div className="playground-history-list">
            {history.map((experiment) => (
              <article key={experiment.id}>
                <div>
                  <b>{experiment.brandName}</b>
                  <small>{formatExperimentDate(experiment.createdAt)}</small>
                </div>
                <p>
                  {experiment.models
                    .map((model) => playgroundModelLabel(model))
                    .join(", ")}
                </p>
                <span>
                  {experiment.results.reduce(
                    (total, result) => total + result.directions.length,
                    0
                  )} ideas
                </span>
                <button type="button" onClick={() => onRestore(experiment)}>
                  Load experiment
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="playground-history-empty">
            Completed comparisons will appear here with their inputs, prompt,
            Research dossier, and results.
          </div>
        )}
      </div>
    </details>
  );
}

function ResearchDossierPanel({
  dossier,
  loading,
  modelCount
}: {
  dossier: HookResearchDossier | null;
  loading: boolean;
  modelCount: number;
}) {
  return (
    <section className="playground-research-panel">
      <header>
        <div>
          <Sparkle aria-hidden="true" size={18} />
          <div>
            <h2>Shared Research Dossier</h2>
            <p>Generated once, then reused unchanged across every Hook model.</p>
          </div>
        </div>
        <span>{dossier ? `Shared by ${modelCount} models` : "Waiting to run"}</span>
      </header>
      {loading ? (
        <div className="playground-research-loading">
          <div className="playground-skeleton is-research-lead" />
          <div className="playground-skeleton is-research-card" />
          <div className="playground-skeleton is-research-card" />
        </div>
      ) : dossier ? (
        <div className="playground-research-body">
          <div className="playground-research-finding">
            <span>Overall finding</span>
            <h3>{dossier.overallFinding}</h3>
            <p>
              {dossier.brand} / {dossier.productFocus}
            </p>
          </div>
          <div className="playground-insight-list">
            {dossier.insightCards.map((insight) => (
              <article key={insight.id}>
                <span>{Math.round(insight.confidenceScore)} confidence</span>
                <h4>{insight.tension}</h4>
                <p>{insight.brandConnection}</p>
                <small>{insight.evidence}</small>
              </article>
            ))}
          </div>
          <details className="playground-research-references">
            <summary>
              {dossier.references.length} references and{" "}
              {dossier.searchQueriesUsed.length} search queries
            </summary>
            <div>
              {dossier.references.map((reference) => (
                <a
                  href={reference.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  key={reference.id}
                >
                  <b>{reference.sourceTitle}</b>
                  <span>{reference.finding}</span>
                </a>
              ))}
              {dossier.references.length === 0 ? (
                <p>No external references were retained in this dossier.</p>
              ) : null}
            </div>
          </details>
        </div>
      ) : (
        <div className="playground-research-empty">
          Run a comparison to create one evidence set for every selected model.
        </div>
      )}
    </section>
  );
}

function SourceToggle({
  checked,
  label,
  helper,
  disabled = false,
  onChange
}: {
  checked: boolean;
  label: string;
  helper: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={checked ? "selected" : ""}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <b>{label}</b>
        <small>{helper}</small>
      </span>
      {checked ? <Check aria-hidden="true" size={14} weight="bold" /> : null}
    </label>
  );
}

function ResultColumnHeader({
  model,
  meta = "Generating ideas"
}: {
  model: string;
  meta?: string;
}) {
  return (
    <header className="playground-result-column-head">
      <div>
        <h3>{playgroundModelLabel(model)}</h3>
        <p>{playgroundModelProviderLabel(model)}</p>
      </div>
      <span>{meta}</span>
    </header>
  );
}

export function buildPlaygroundRequest({
  brand,
  selectedBrandItemIds,
  includeQuestionnaire,
  includeBrief,
  brief,
  service,
  quantity,
  prompt,
  generationModel
}: {
  brand: Brand | null;
  selectedBrandItemIds: ReadonlySet<string>;
  includeQuestionnaire: boolean;
  includeBrief: boolean;
  brief: string;
  service: ServiceType;
  quantity: number;
  prompt: string;
  generationModel: string;
}) {
  const selectedBrandSystem =
    brand?.library.brand.filter((item) => selectedBrandItemIds.has(item.id)) ?? [];
  return {
    runId: "playground-preview",
    hookIdeaMode: "fresh-research" as const,
    generationModel,
    agentHookPrompt: prompt,
    albumFormat: "auto" as const,
    brand: brand
      ? { id: brand.id, name: brand.name, category: brand.category }
      : null,
    service,
    quantity,
    contentTypeQuotas: [{ service, count: quantity }],
    brief: includeBrief && brief.trim() ? brief.trim() : "No user brief selected.",
    onboardingQuestionnaire:
      includeQuestionnaire && brand
        ? buildOnboardingQuestionnaireHookContext(brand.onboardingQuestionnaire)
        : "",
    extraInstructions: "",
    attachments: [] as readonly string[],
    uploadedMaterials: [] as readonly unknown[],
    brandMemory: { working: [] as readonly string[], avoid: [] as readonly string[] },
    brandLibrary: {
      brand: selectedBrandSystem.map(({ title, description }) => ({
        title,
        description
      })),
      products: [] as readonly unknown[],
      docs: [] as readonly unknown[],
      refs: [] as readonly unknown[]
    }
  };
}

export function filterPlaygroundBrands(
  brands: readonly Brand[],
  queryValue: string,
  selectedBrandName?: string
): readonly Brand[] {
  const query = queryValue.trim().toLocaleLowerCase();
  if (!query || query === selectedBrandName?.toLocaleLowerCase()) return brands;
  return brands.filter((candidate) =>
    `${candidate.name} ${candidate.category}`
      .toLocaleLowerCase()
      .includes(query)
  );
}

export function filterSystemBrands(brands: readonly Brand[]): readonly Brand[] {
  return brands.filter((brand) => brand.existsInSystem !== false);
}

export function getDefaultPlaygroundBrand(brands: readonly Brand[]): Brand {
  const normalizedName = (brand: Brand) =>
    brand.name.replaceAll(/\s/g, "").toLocaleLowerCase();
  return (
    brands.find((brand) => normalizedName(brand) === "convertcakeads") ??
    brands.find((brand) => normalizedName(brand) === "convertcake") ??
    brands[0]!
  );
}

export function isValidOpenRouterModelId(value: string): boolean {
  return isOpenRouterModelId(value.trim());
}

function playgroundModelLabel(model: string): string {
  return hookGenerationModelLabel(model);
}

function playgroundModelProviderLabel(model: string): string {
  return hookGenerationProviderLabel(model);
}

export function buildPromptDiff(
  original: string,
  edited: string
): readonly PromptDiffLine[] {
  const before = original.split("\n");
  const after = edited.split("\n");
  const lengths = Array.from(
    { length: before.length + 1 },
    () => new Uint32Array(after.length + 1)
  );

  for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex -= 1) {
      lengths[beforeIndex]![afterIndex] =
        before[beforeIndex] === after[afterIndex]
          ? lengths[beforeIndex + 1]![afterIndex + 1]! + 1
          : Math.max(
              lengths[beforeIndex + 1]![afterIndex]!,
              lengths[beforeIndex]![afterIndex + 1]!
            );
    }
  }

  const diff: PromptDiffLine[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < before.length || afterIndex < after.length) {
    if (
      beforeIndex < before.length &&
      afterIndex < after.length &&
      before[beforeIndex] === after[afterIndex]
    ) {
      diff.push({ type: "same", text: before[beforeIndex]! });
      beforeIndex += 1;
      afterIndex += 1;
    } else if (
      beforeIndex < before.length &&
      (afterIndex >= after.length ||
        lengths[beforeIndex + 1]![afterIndex]! >=
          lengths[beforeIndex]![afterIndex + 1]!)
    ) {
      diff.push({ type: "removed", text: before[beforeIndex]! });
      beforeIndex += 1;
    } else {
      diff.push({ type: "added", text: after[afterIndex]! });
      afterIndex += 1;
    }
  }
  return diff;
}

function loadExperimentHistory(): readonly PlaygroundExperiment[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(PLAYGROUND_HISTORY_KEY) ?? "[]"
    ) as unknown;
    return Array.isArray(parsed)
      ? (parsed.slice(0, PLAYGROUND_HISTORY_LIMIT) as PlaygroundExperiment[])
      : [];
  } catch {
    return [];
  }
}

function persistExperimentHistory(
  experiments: readonly PlaygroundExperiment[]
) {
  try {
    window.localStorage.setItem(
      PLAYGROUND_HISTORY_KEY,
      JSON.stringify(experiments)
    );
  } catch {
    try {
      window.localStorage.setItem(
        PLAYGROUND_HISTORY_KEY,
        JSON.stringify(experiments.slice(0, 3))
      );
    } catch {
      // History is optional; a storage quota failure must not lose live results.
    }
  }
}

function formatExperimentDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
      }).format(date);
}

async function loadPrompt(): Promise<string> {
  const response = await fetch(`${env.apiBaseUrl}/hook-agent-prompt`, {
    headers: await authHeaders()
  });
  const payload = (await response.json()) as PromptResponse;
  if (!response.ok || typeof payload.prompt !== "string") {
    throw new Error(payload.error || "Hook Agent prompt could not be loaded.");
  }
  return payload.prompt;
}

async function authHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const { data } = await getSupabaseClient().auth.getSession();
    if (data.session?.access_token) {
      headers.Authorization = `Bearer ${data.session.access_token}`;
    }
  } catch {
    return headers;
  }
  return headers;
}
