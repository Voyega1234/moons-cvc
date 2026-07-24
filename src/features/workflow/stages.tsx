import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  Bell,
  CheckCircle,
  FileArrowUp,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Sparkle,
  TextT,
  X
} from "@phosphor-icons/react";
import {
  canSelectBrand,
  canStartBrandIngestion,
  type Brand,
  type LibraryItem,
  type OnboardingQuestionnaireSource
} from "../../domain/brand";
import { BrandLogo } from "../../shared/components/brand-logo";
import {
  brandDocumentTypeLabels,
  brandDocumentTypes,
  type BrandDocument,
  type BrandDocumentType,
  type BrandPastWorkItem,
  type BrandProduct
} from "../../domain/brand-memory";
import {
  albumFormatLabel,
  albumFormatPanelCount,
  albumFormats,
  artworkOutputSizeLabel,
  artworkOutputSizes,
  creativeMaterialRoles,
  inferredReferenceImageRole,
  referenceImageRoleLabels,
  resolveAlbumFormat,
  type ApprovalRole,
  type AlbumFormat,
  type ArtworkMode,
  type CreativeOutput,
  type CreativeMaterialRole,
  type ReferenceImageRole,
  type ReferenceImageSelection,
  type ServiceType
} from "../../domain/creative-run";
import {
  directionSubheadline,
  resolveSubheadlineHighlight
} from "../../domain/subheadline-highlight";
import {
  buildQualityRegenerationInstructions,
  CREATIVE_STRATEGIST_AGENT_NAME,
  CS_QUALITY_CHECKLIST,
  GD_QUALITY_CHECKLIST,
  type CreativeQualityReport
} from "../../domain/quality-check";
import { useBrandMemoryRepository } from "../../app/providers/brand-memory-provider";
import { useBrands } from "../../app/providers/brand-provider";
import { useClientIntakeRepository } from "../../app/providers/client-intake-provider";
import { useOptionalRunCollaboration } from "../../app/providers/run-collaboration-provider";
import { useOptionalWorkspace } from "../../app/providers/workspace-provider";
import { departmentLabel } from "../../domain/run-collaboration";
import {
  CLIENT_CATEGORY_MAX_LENGTH,
  validateClientCategory,
  validateFacebookUrl,
  validateOnboardingQuestionnaire,
  validateQuestionnaireGoogleSheetUrl
} from "../../domain/client-ingestion";
import {
  regenerateOutputImages,
  reviseOutputImage
} from "../../services/artwork-generation/openai-image-generation";
import { uploadReplacementAsset } from "../../services/artwork-generation/replace-output-asset";
import { uploadCreativeMaterial } from "../../services/creative-materials/upload-creative-material";
import { runQualityCheck } from "../../services/quality-check/run-quality-check";
import {
  suggestBrandLearning,
  type LearningSuggestion
} from "../../services/brand-learning/suggest-brand-learning";
import { getFileNames } from "../../shared/utils/files";
import { playGenerationSuccessSound } from "../../shared/utils/notification-sound";
import { pluralize } from "../../shared/utils/text";
import { createId, nowIso } from "../../shared/utils/id";
import { QUANTITY_LIMITS } from "../../shared/constants/ui";
import { serviceLabels, stages } from "./config";
import {
  buildAngleExportReview,
  buildAngleGroups
} from "./angle-content-types";
import type {
  WorkflowAction,
  WorkflowState,
  WorkspaceAction,
  WorkspaceState
} from "./model";
import {
  creativeMixItems,
  selectedBrandProducts,
  totalCreativeMixQuantity
} from "./model";
import { WorkflowMaterialPack } from "./material-pack";
import {
  approvalRolesForOutput,
  currentApprovalRole,
  isBuildQualityCheckOutput,
  selectedDirectionCount,
  workflowActionBlockReason
} from "./rules";
import { presentBrandMemoryText } from "./brand-memory-presentation";
import {
  createStageClientSlideItems,
  openCreateStageSlidesInGoogleSlides,
  openPmApprovedClientSlidesInGoogleSlides,
  pmApprovedClientSlideItems
} from "./export-client-slides-pptx";
import { useCreateSelectedHooks } from "./use-create-selected-hooks";
import {
  useGenerateHooks,
  useGenerateMoreHooks,
  useRegenerateAllHooks,
  useRegenerateHook
} from "./use-generate-hooks";
import { useRunQualityCheck } from "./use-run-quality-check";
import type { BrandMemoryRepository } from "../../ports/brand-memory-repository";

interface StageProps {
  state: WorkflowState;
  dispatch: Dispatch<WorkflowAction>;
}

function artworkModeLabel(mode: ArtworkMode): string {
  switch (mode) {
    case "standard":
      return "Standard";
    case "design-system":
      return "Design system";
    case "reference-library":
      return "Reference library";
  }
}

function HookIdeaModeToggle({
  disabled,
  dispatch
}: {
  disabled: boolean;
  dispatch: Dispatch<WorkflowAction>;
}) {
  return (
    <div
      className="compass-hook-mode-toggle"
      role="group"
      aria-label="Hook idea mode"
    >
      <button
        className="active"
        type="button"
        disabled={disabled}
        aria-pressed="true"
        onClick={() =>
          dispatch({ type: "set-hook-idea-mode", mode: "standard" })
        }
      >
        Standard
      </button>
    </div>
  );
}

function DecisionCard({
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

export function StartStage({ state, dispatch }: StageProps) {
  const { brands, loading, error, refresh } = useBrands();
  const [profileSection, setProfileSection] =
    useState<BrandProfileSection>("brand");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [memoryRevision, setMemoryRevision] = useState(0);
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [setupBrand, setSetupBrand] = useState<Brand | null>(null);
  const [mappingBrand, setMappingBrand] = useState<Brand | null>(null);
  const [queuedBrandName, setQueuedBrandName] = useState<string | null>(null);
  const continueAction: WorkflowAction = { type: "set-stage", stage: "brief" };
  const continueBlocked = workflowActionBlockReason(state, continueAction);
  const search = state.brandSearch.trim().toLowerCase();
  const visibleBrands = brands.filter((brand) =>
    `${brand.name} ${brand.category} ${brand.mappingStatus ?? ""} ${brand.serviceStatus ?? ""}`
      .toLowerCase()
      .includes(search)
  );
  const currentSetupBrand = setupBrand
    ? (brands.find((brand) => brand.id === setupBrand.id) ?? setupBrand)
    : null;

  useEffect(() => {
    if (currentSetupBrand && !canStartBrandIngestion(currentSetupBrand)) {
      setSetupBrand(null);
    }
  }, [currentSetupBrand]);

  return (
    <DecisionCard
      eyebrow="01 / Signal"
      title="Start with what the brand already knows."
      helper="Choose a brand to load its voice, visual rules, product truths, approved work, and creative learnings."
      status={state.brand ? "Memory loaded" : "Memory waiting"}
      statusClass={state.brand ? "green" : "blue"}
      className="compass-signal-stage"
      actions={
        <>
          <span className="pill compass-signal-before-output">
            Signal before output
          </span>
          <div className="compass-signal-footer-actions">
            <button
              className="btn primary"
              type="button"
              disabled={Boolean(continueBlocked)}
              title={continueBlocked ?? undefined}
              onClick={() => dispatch(continueAction)}
            >
              Continue to brief →
            </button>
          </div>
        </>
      }
    >
      <div className="compass-start-grid">
        <section className="compass-brand-select-card">
          <span className="compass-card-label">Brand workspace</span>
          <div className="dropdown">
            <button
              className="select-btn"
              type="button"
              aria-haspopup="listbox"
              aria-expanded={state.brandMenuOpen}
              onClick={() => {
                if (!state.brandMenuOpen) void refresh();
                dispatch({ type: "toggle-brand-menu" });
              }}
            >
              <span className="select-left">
                <span className="avatar compass-brand-select-avatar">
                  {state.brand ? (
                    <BrandLogo brand={state.brand} />
                  ) : (
                    "NE"
                  )}
                </span>
                <span>
                  <b>{state.brand?.name ?? "Choose a brand"}</b>
                  <small>
                    {state.brand
                      ? clientSubtitle(state.brand)
                      : "Search by brand or category"}
                  </small>
                </span>
              </span>
              <span aria-hidden="true">⌄</span>
            </button>
            <div
              className={`menu ${state.brandMenuOpen ? "open" : ""}`}
              role="listbox"
              aria-label="Clients"
            >
              <label className="search">
                <span aria-hidden="true">⌕</span>
                <input
                  placeholder="Search client, category, product"
                  autoComplete="off"
                  value={state.brandSearch}
                  onChange={(event) =>
                    dispatch({
                      type: "search-brands",
                      value: event.target.value
                    })
                  }
                />
              </label>
              <AddClientPanel
                open={addClientOpen}
                onToggle={() => {
                  setAddClientOpen((current) => !current);
                  setSetupBrand(null);
                  setMappingBrand(null);
                }}
                onCreated={async (brandName) => {
                  setAddClientOpen(false);
                  setQueuedBrandName(brandName);
                  await refresh();
                }}
              />
              {loading ? (
                <p className="repository-message">Loading brands...</p>
              ) : error ? (
                <p className="repository-message error">{error.message}</p>
              ) : null}
              {visibleBrands.map((brand) => {
                const selectable = canSelectBrand(brand);
                const disabledReason = clientDisabledReason(brand);
                if (!selectable) {
                  const canSetupExisting = canStartBrandIngestion(brand);
                  const canAddMapping = brand.existsInSystem === false;
                  return (
                    <div
                      key={brand.id}
                      role="option"
                      aria-selected={false}
                      aria-disabled="true"
                      className={`client-row ${canSetupExisting || canAddMapping ? "locked" : "disabled"}`}
                      title={disabledReason ?? undefined}
                    >
                      <span className="avatar">
                        <BrandLogo brand={brand} />
                      </span>
                      <span className="client-row-copy">
                        <b>{brand.name}</b>
                        <small>
                          {clientStatusLabel(brand)}
                          {brand.mappingStatus || brand.serviceStatus
                            ? ` · ${[brand.mappingStatus, brand.serviceStatus].filter(Boolean).join(" · ")}`
                            : ""}
                        </small>
                      </span>
                      {canSetupExisting || canAddMapping ? (
                        <button
                          className="client-row-setup"
                          type="button"
                          onClick={() => {
                            if (canAddMapping) {
                              setMappingBrand(brand);
                              setSetupBrand(null);
                            } else {
                              setSetupBrand(brand);
                              setMappingBrand(null);
                            }
                            setAddClientOpen(false);
                            dispatch({ type: "toggle-brand-menu" });
                          }}
                        >
                          {canAddMapping ? "Add to Creative Compass" : "Set up brand"}
                        </button>
                      ) : null}
                    </div>
                  );
                }

                return (
                  <button
                    key={brand.id}
                    type="button"
                    role="option"
                    aria-selected={state.brand?.id === brand.id}
                    className={`client-row ${state.brand?.id === brand.id ? "selected" : ""}`}
                    title={disabledReason ?? undefined}
                    onClick={() => dispatch({ type: "select-brand", brand })}
                  >
                    <span className="avatar">
                      <BrandLogo brand={brand} />
                    </span>
                    <span>
                      <b>{brand.name}</b>
                      <small>
                        {clientStatusLabel(brand)}
                        {brand.mappingStatus || brand.serviceStatus
                          ? ` · ${[brand.mappingStatus, brand.serviceStatus].filter(Boolean).join(" · ")}`
                          : ""}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          {currentSetupBrand ? (
            <ExistingBrandSetupPanel
              key={currentSetupBrand.id}
              brand={currentSetupBrand}
              onCancel={() => setSetupBrand(null)}
              onQueued={async (brandName) => {
                setSetupBrand(null);
                setQueuedBrandName(brandName);
                await refresh();
              }}
            />
          ) : null}
          {mappingBrand ? (
            <MappingBrandSetupPanel
              key={mappingBrand.id}
              brand={mappingBrand}
              onCancel={() => setMappingBrand(null)}
              onCreated={async (brandName) => {
                setMappingBrand(null);
                setQueuedBrandName(brandName);
                await refresh();
              }}
            />
          ) : null}
          {!state.brand ? (
            <div className="compass-start-blank">
              <b>Brand context is your unfair advantage.</b>
              <p>
                Creative Compass keeps approved references, uploaded brand materials, and
                past performance close to every creative decision.
              </p>
            </div>
          ) : (
            <div
              className="compass-context-ready"
              role="status"
              aria-live="polite"
            >
              <div className="compass-context-ready-mark" aria-hidden="true">
                <span className="compass-context-ready-ring" />
                <span className="compass-context-ready-core">
                  <CheckCircle size={29} weight="fill" />
                </span>
              </div>
              <div className="compass-context-ready-copy">
                <b>{state.brand.name} context is ready.</b>
                <p>
                  Voice, visual rules, products, references, and creative
                  learnings are connected to this run.
                </p>
                <div className="compass-context-ready-signal" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            </div>
          )}
          <BrandMaterialsSummary
            state={state}
            onOpenLibrary={(section) => {
              setProfileSection(section);
              setLibraryOpen(true);
            }}
          />
        </section>
        <BrandProfilePanel
          key={`${state.brand?.id ?? "empty"}-${memoryRevision}`}
          state={state}
          dispatch={dispatch}
          section={profileSection}
          onSectionChange={setProfileSection}
        />
      </div>
      {state.brand && libraryOpen ? (
        <BrandLibraryModal
          state={state}
          dispatch={dispatch}
          section={profileSection}
          onSectionChange={setProfileSection}
          onClose={() => {
            setLibraryOpen(false);
            setMemoryRevision((current) => current + 1);
          }}
        />
      ) : null}
      {queuedBrandName ? (
        <BrandAnalysisQueuedDialog
          brandName={queuedBrandName}
          onClose={() => setQueuedBrandName(null)}
        />
      ) : null}
    </DecisionCard>
  );
}

function BrandAnalysisQueuedDialog({
  brandName,
  onClose
}: {
  brandName: string;
  onClose: () => void;
}) {
  const titleId = useId();

  return (
    <div className="output-modal-backdrop compass-setup-queued-backdrop">
      <section
        className="output-modal compass-setup-queued-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="compass-setup-queued-status">
          <CheckCircle aria-hidden="true" size={22} weight="fill" />
          <span>Brand analysis started</span>
        </div>
        <h3 id={titleId}>{brandName} is in the queue.</h3>
        <p>
          Creative Compass usually needs 5-10 minutes to analyze the brand. You can close
          this message and continue working.
        </p>
        <div className="compass-setup-queued-mailbox">
          <Bell aria-hidden="true" size={22} />
          <div>
            <b>We will notify you in Notifications</b>
            <span>
              Check the mailbox at the top right when Brand Kit is ready or
              needs your attention.
            </span>
          </div>
        </div>
        <div className="compass-setup-queued-actions">
          <button
            autoFocus
            className="btn primary"
            type="button"
            onClick={onClose}
          >
            Got it
          </button>
        </div>
      </section>
    </div>
  );
}

function BrandMaterialsSummary({
  state,
  onOpenLibrary
}: {
  state: WorkflowState;
  onOpenLibrary: (section: BrandProfileSection) => void;
}) {
  const brand = state.brand;
  const rows: readonly [string, number, BrandProfileSection][] = [
    ["CI", brand?.library.brand.length ?? 0, "brand"],
    ["Guideline", brand?.library.docs.length ?? 0, "docs"],
    ["Reference style", brand?.library.refs.length ?? 0, "refs"],
    ["Materials", state.uploadedMaterials.length, "materials"],
    [
      "Business context",
      (brand?.memory.working.length ?? 0) + (brand?.memory.avoid.length ?? 0),
      "learning"
    ],
    ["Product list & info", brand?.library.products.length ?? 0, "products"],
    ["Questionnaire", brand?.onboardingQuestionnaire ? 1 : 0, "questionnaire"]
  ];
  const total = rows.reduce((sum, [, count]) => sum + count, 0);

  return (
    <section className="compass-material-uploader">
      <div className="compass-materials-head">
        <div>
          <b>Brand materials</b>
          <small>
            Keep the source context close without taking over the welcome page.
          </small>
        </div>
        <div className="compass-materials-head-actions">
          <span className="pill blue">
            {total} item{total === 1 ? "" : "s"}
          </span>
          <button
            className="btn small primary"
            type="button"
            disabled={!brand}
            onClick={() => onOpenLibrary("brand")}
          >
            Manage library
          </button>
        </div>
      </div>
      <div className="compass-materials-compact-grid">
        {rows.map(([label, count, section], index) => (
          <div
            className={`compass-material-compact-row ${
              rows.length % 2 === 1 && index === rows.length - 1 ? "wide" : ""
            }`}
            key={label}
          >
            <div>
              <b>{label}</b>
              <span>
                {count} item{count === 1 ? "" : "s"}
              </span>
            </div>
            <button
              className="btn small"
              type="button"
              disabled={!brand}
              onClick={() => onOpenLibrary(section)}
            >
              Add
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function MappingBrandSetupPanel({
  brand,
  onCancel,
  onCreated
}: {
  brand: Brand;
  onCancel: () => void;
  onCreated: (brandName: string) => Promise<void>;
}) {
  const repository = useClientIntakeRepository();
  const { readMappingQuestionnaire } = useBrands();
  const sourceOptions = brandFacebookSourceOptions(brand);
  const [facebookSource, setFacebookSource] = useState(
    sourceOptions[0]?.url ?? "manual"
  );
  const [manualFacebookUrl, setManualFacebookUrl] = useState("");
  const [questionnaireUrl, setQuestionnaireUrl] = useState(
    brand.onboardingQuestionnaire?.sourceUrl ??
      brand.mappingClientPortalUrl ??
      ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const facebookUrl =
    facebookSource === "manual" ? manualFacebookUrl : facebookSource;

  async function createAndQueue() {
    const urlError = validateFacebookUrl(facebookUrl);
    if (urlError) {
      setError(urlError);
      return;
    }
    const questionnaireUrlError =
      validateQuestionnaireGoogleSheetUrl(questionnaireUrl);
    if (questionnaireUrlError) {
      setError(questionnaireUrlError);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const questionnaire = await importQuestionnaireFromGoogleSheet(
        questionnaireUrl,
        readMappingQuestionnaire
      );
      await repository.createDraftClient({
        name: brand.name,
        facebookUrl: facebookUrl.trim(),
        questionnaire: {
          text: questionnaire.text,
          sourceUrl: questionnaire.sourceUrl ?? questionnaireUrl.trim(),
          sheetTitle: questionnaire.sheetTitle,
          extractedFields: questionnaire.extractedFields
        }
      });
      await onCreated(brand.name);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not add this client to Creative Compass."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="client-intake-card">
      <div className="client-intake-heading">
        <span>Add {brand.name} to Creative Compass</span>
        <small>
          This client exists in the mapping sheet but has no Creative Compass data yet.
        </small>
      </div>
      <div className="client-intake-form">
        <BrandSetupSources
          brand={brand}
          sourceOptions={sourceOptions}
          facebookSource={facebookSource}
          manualFacebookUrl={manualFacebookUrl}
          questionnaireUrl={questionnaireUrl}
          disabled={saving}
          onFacebookSourceChange={setFacebookSource}
          onManualFacebookUrlChange={setManualFacebookUrl}
          onQuestionnaireUrlChange={setQuestionnaireUrl}
        />
        {error ? <p className="repository-message error">{error}</p> : null}
        <div className="client-intake-actions">
          <button
            className="btn secondary"
            type="button"
            disabled={saving}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={saving}
            onClick={() => void createAndQueue()}
          >
            {saving ? "Starting analysis..." : "Add and analyze"}
          </button>
        </div>
      </div>
    </section>
  );
}

function ExistingBrandSetupPanel({
  brand,
  onCancel,
  onQueued
}: {
  brand: Brand;
  onCancel: () => void;
  onQueued: (brandName: string) => Promise<void>;
}) {
  const repository = useClientIntakeRepository();
  const { readMappingQuestionnaire } = useBrands();
  const sourceOptions = brandFacebookSourceOptions(brand);
  const [facebookSource, setFacebookSource] = useState(
    sourceOptions[0]?.url ?? "manual"
  );
  const [manualFacebookUrl, setManualFacebookUrl] = useState(
    sourceOptions.length ? "" : (brand.facebookUrl ?? "")
  );
  const [questionnaireUrl, setQuestionnaireUrl] = useState(
    brand.onboardingQuestionnaire?.sourceUrl ??
      brand.mappingClientPortalUrl ??
      ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const facebookUrl =
    facebookSource === "manual" ? manualFacebookUrl : facebookSource;

  async function queueIngestion() {
    const urlError = validateFacebookUrl(facebookUrl);
    if (urlError) {
      setError(urlError);
      return;
    }
    const questionnaireUrlError =
      validateQuestionnaireGoogleSheetUrl(questionnaireUrl);
    if (questionnaireUrlError) {
      setError(questionnaireUrlError);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const questionnaire = await importQuestionnaireFromGoogleSheet(
        questionnaireUrl,
        readMappingQuestionnaire
      );
      await repository.queueExistingClient({
        clientId: brand.id,
        facebookUrl: facebookUrl.trim(),
        questionnaire: {
          text: questionnaire.text,
          sourceUrl: questionnaire.sourceUrl ?? questionnaireUrl.trim(),
          sheetTitle: questionnaire.sheetTitle,
          extractedFields: questionnaire.extractedFields
        }
      });
      await onQueued(brand.name);
    } catch (error) {
      setError(repositoryErrorMessage(error, "Could not queue brand setup."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="client-intake-card">
      <div className="client-intake-heading">
        <span>Set up {brand.name}</span>
        <small>
          Brand Memory is required before this client can be used in a run.
        </small>
      </div>
      <div className="client-intake-form">
        <BrandSetupSources
          brand={brand}
          sourceOptions={sourceOptions}
          facebookSource={facebookSource}
          manualFacebookUrl={manualFacebookUrl}
          questionnaireUrl={questionnaireUrl}
          disabled={saving}
          onFacebookSourceChange={setFacebookSource}
          onManualFacebookUrlChange={setManualFacebookUrl}
          onQuestionnaireUrlChange={setQuestionnaireUrl}
        />
        {error ? <p className="repository-message error">{error}</p> : null}
        <div className="client-intake-actions">
          <button
            className="btn secondary"
            type="button"
            disabled={saving}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={saving}
            onClick={() => void queueIngestion()}
          >
            {saving ? "Starting analysis..." : "Analyze brand"}
          </button>
        </div>
      </div>
    </section>
  );
}

export function repositoryErrorMessage(
  error: unknown,
  fallback: string
): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }
  return fallback;
}

async function importQuestionnaireFromGoogleSheet(
  sheetUrl: string,
  readQuestionnaire: (
    sheetUrl: string
  ) => Promise<OnboardingQuestionnaireSource | null>
): Promise<OnboardingQuestionnaireSource> {
  const urlError = validateQuestionnaireGoogleSheetUrl(sheetUrl);
  if (urlError) throw new Error(urlError);

  const questionnaire = await readQuestionnaire(sheetUrl.trim());
  if (!questionnaire) {
    throw new Error(
      'The "1. Questionnaire" tab is empty or could not be read.'
    );
  }
  const questionnaireError = validateOnboardingQuestionnaire(
    questionnaire.text
  );
  if (questionnaireError) throw new Error(questionnaireError);

  return questionnaire;
}

interface FacebookSourceOption {
  url: string;
  label: string;
}

function BrandSetupSources({
  brand,
  sourceOptions,
  facebookSource,
  manualFacebookUrl,
  questionnaireUrl,
  disabled,
  onFacebookSourceChange,
  onManualFacebookUrlChange,
  onQuestionnaireUrlChange
}: {
  brand: Brand;
  sourceOptions: readonly FacebookSourceOption[];
  facebookSource: string;
  manualFacebookUrl: string;
  questionnaireUrl: string;
  disabled: boolean;
  onFacebookSourceChange: (value: string) => void;
  onManualFacebookUrlChange: (value: string) => void;
  onQuestionnaireUrlChange: (value: string) => void;
}) {
  return (
    <>
      <GoogleSheetExtractionSummary
        brand={
          brand.source === "mapping" ||
          brand.mappingStatus ||
          brand.serviceStatus ||
          brand.mappingClientPortalUrl
            ? brand
            : undefined
        }
      />
      <fieldset className="client-source-picker">
        <legend>Facebook page</legend>
        <p>
          {sourceOptions.length
            ? "Select the page Creative Compass should analyze. These were found in the client data."
            : "No Facebook page was found in the client data. Add one manually."}
        </p>
        <div className="client-source-options">
          {sourceOptions.map((option) => (
            <label
              className={`client-source-option ${facebookSource === option.url ? "selected" : ""}`}
              key={option.url}
            >
              <input
                type="radio"
                name={`facebook-source-${brand.id}`}
                value={option.url}
                checked={facebookSource === option.url}
                disabled={disabled}
                onChange={() => onFacebookSourceChange(option.url)}
              />
              <span>
                <b>{option.label}</b>
                <small>{option.url}</small>
              </span>
            </label>
          ))}
          <label
            className={`client-source-option ${facebookSource === "manual" ? "selected" : ""}`}
          >
            <input
              type="radio"
              name={`facebook-source-${brand.id}`}
              value="manual"
              checked={facebookSource === "manual"}
              disabled={disabled}
              onChange={() => onFacebookSourceChange("manual")}
            />
            <span>
              <b>Use another page</b>
              <small>Enter a Facebook page manually</small>
            </span>
          </label>
        </div>
        {facebookSource === "manual" ? (
          <label className="client-source-manual">
            <span>Facebook URL</span>
            <input
              value={manualFacebookUrl}
              disabled={disabled}
              placeholder="https://www.facebook.com/brand.page"
              onChange={(event) =>
                onManualFacebookUrlChange(event.target.value)
              }
            />
          </label>
        ) : null}
      </fieldset>

      <OnboardingQuestionnaireField
        value={questionnaireUrl}
        disabled={disabled}
        onChange={onQuestionnaireUrlChange}
      />
    </>
  );
}

function brandFacebookSourceOptions(
  brand: Brand
): readonly FacebookSourceOption[] {
  const urls = brand.facebookUrl ? [brand.facebookUrl] : [];

  return urls.map((url) => ({
    url,
    label: "Current Creative Compass page"
  }));
}

function GoogleSheetExtractionSummary({
  brand,
  questionnaire
}: {
  brand?: Brand;
  questionnaire?: OnboardingQuestionnaireSource;
}) {
  const questionnaireSource =
    questionnaire ?? brand?.onboardingQuestionnaire;
  const questionnaireFields = questionnaireSource?.extractedFields;
  const mappingValues = brand
    ? [
        ["Client name", brand.name],
        ["Account status", brand.mappingStatus ?? "Not provided"],
        ["Service status", brand.serviceStatus ?? "Not provided"],
        [
          "Client Portal URL",
          brand.mappingClientPortalUrl ?? "Not provided"
        ]
      ]
    : null;

  return (
    <section className="client-sheet-extraction">
      <div>
        <b>Google Sheet extraction</b>
        <small>
          {questionnaireFields?.length
            ? `Extracted ${questionnaireFields.length} answered fields from the read-only ${questionnaireSource?.sheetTitle ?? "1. Questionnaire"} tab.`
            : "Creative Compass reads only the tab named 1. Questionnaire and extracts answered fields from its {{field_name}} placeholders."}
        </small>
      </div>
      {questionnaireFields?.length ? (
        <dl className="questionnaire-extracted-values">
          {questionnaireFields.map((field) => (
            <div key={field.key}>
              <dt>
                {field.label}
                <small>{field.key}</small>
              </dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : mappingValues ? (
        <dl>
          {mappingValues.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <ul>
          <li>Questionnaire answers</li>
          <li>Tab: 1. Questionnaire (read-only)</li>
        </ul>
      )}
    </section>
  );
}

function OnboardingQuestionnaireField({
  value,
  disabled,
  onChange
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="client-onboarding-questionnaire">
      <label>
        <span>Questionnaire Google Sheet URL required</span>
        <input
          aria-label="Questionnaire Google Sheet URL"
          type="url"
          value={value}
          disabled={disabled}
          required
          placeholder="https://docs.google.com/spreadsheets/d/.../edit?gid=..."
          onChange={(event) => onChange(event.target.value)}
        />
        <small>
          Creative Compass uses read-only access and imports the 1. Questionnaire tab as
          onboarding context. It is not the current campaign brief.
        </small>
      </label>
    </div>
  );
}

function AddClientPanel({
  open,
  onToggle,
  onCreated
}: {
  open: boolean;
  onToggle: () => void;
  onCreated: (brandName: string) => Promise<void>;
}) {
  const repository = useClientIntakeRepository();
  const { readMappingQuestionnaire } = useBrands();
  const [name, setName] = useState("");
  const [facebookUrl, setFacebookUrl] = useState("");
  const [category, setCategory] = useState("");
  const [questionnaireUrl, setQuestionnaireUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createClient() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Client name is required.");
      return;
    }

    const urlError = validateFacebookUrl(facebookUrl);
    if (urlError) {
      setError(urlError);
      return;
    }

    const categoryError = validateClientCategory(category);
    if (categoryError) {
      setError(categoryError);
      return;
    }
    const questionnaireUrlError =
      validateQuestionnaireGoogleSheetUrl(questionnaireUrl);
    if (questionnaireUrlError) {
      setError(questionnaireUrlError);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const questionnaire = await importQuestionnaireFromGoogleSheet(
        questionnaireUrl,
        readMappingQuestionnaire
      );
      const result = await repository.createDraftClient({
        name: trimmedName,
        facebookUrl: facebookUrl.trim(),
        questionnaire: {
          text: questionnaire.text,
          sourceUrl: questionnaire.sourceUrl ?? questionnaireUrl.trim(),
          sheetTitle: questionnaire.sheetTitle,
          extractedFields: questionnaire.extractedFields
        },
        ...(category.trim() ? { category: category.trim() } : {})
      });
      await onCreated(result.brand.name);
      setName("");
      setFacebookUrl("");
      setCategory("");
      setQuestionnaireUrl("");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not create client."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="client-intake-card">
      <button className="client-intake-toggle" type="button" onClick={onToggle}>
        <span>{open ? "Close add client" : "Add new client"}</span>
        <small>
          Requires Facebook and Questionnaire Google Sheet URLs.
        </small>
      </button>
      {open ? (
        <div className="client-intake-form">
          <label>
            <span>Client name</span>
            <input
              value={name}
              disabled={saving}
              placeholder="Example: Meisaku Premium Yakiniku"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            <span>Facebook URL</span>
            <input
              value={facebookUrl}
              disabled={saving}
              placeholder="https://www.facebook.com/brand.page"
              onChange={(event) => setFacebookUrl(event.target.value)}
            />
          </label>
          <label>
            <span>Category optional</span>
            <input
              value={category}
              disabled={saving}
              maxLength={CLIENT_CATEGORY_MAX_LENGTH}
              placeholder="Example: Leather goods"
              onChange={(event) => setCategory(event.target.value)}
            />
          </label>
          <OnboardingQuestionnaireField
            value={questionnaireUrl}
            disabled={saving}
            onChange={setQuestionnaireUrl}
          />
          {error ? <p className="repository-message error">{error}</p> : null}
          <button
            className="btn secondary"
            type="button"
            disabled={saving}
            onClick={() => void createClient()}
          >
            {saving ? "Starting analysis..." : "Create client draft"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function clientDisabledReason(
  brand: NonNullable<WorkflowState["brand"]>
): string | null {
  if (brand.existsInSystem === false) {
    return "This client is in the mapping sheet but has no brand memory in Creative Compass yet.";
  }

  if (!canSelectBrand(brand)) {
    return "This client is still being ingested. Wait until Brand Memory is ready.";
  }

  return null;
}

function clientStatusLabel(brand: NonNullable<WorkflowState["brand"]>): string {
  if (brand.existsInSystem === false) return "No Creative Compass data yet";

  switch (brand.ingestionStatus) {
    case "draft":
      return "Draft client";
    case "queued":
      return "Ingestion queued";
    case "validating_source":
      return "Validating Facebook URL";
    case "scraping_facebook_posts":
      return "Scraping Facebook posts";
    case "scraping_facebook_ads":
      return "Scraping Ads Library";
    case "searching_fallback":
      return "Searching fallback sources";
    case "mirroring_images":
      return "Mirroring source images";
    case "analyzing_visuals":
      return "Analyzing visuals";
    case "analyzing_brand":
      return "Analyzing brand";
    case "writing_memory":
      return "Writing Brand Memory";
    case "ready":
      return "Brand memory ready";
    case "needs_review":
      return "Brand memory ready · Review recommended";
    case "failed":
      return "Ingestion failed";
    default:
      return brand.category;
  }
}

function clientSubtitle(brand: Brand): string {
  if (brand.ingestionStatus === "ready") return "Brand memory ready";
  if (brand.ingestionStatus === "needs_review") {
    return "Brand memory ready · Review recommended";
  }

  return brand.category;
}

type BrandProfileSection =
  | "brand"
  | "products"
  | "docs"
  | "refs"
  | "materials"
  | "past"
  | "learning"
  | "questionnaire";

const brandProfileSections: readonly [BrandProfileSection, string, string][] = [
  ["brand", "Brand kit", "Rules, voice, CI, claim guardrails"],
  ["products", "Products", "Offers, benefits, audience, claim notes"],
  ["docs", "Guideline", "Editable guideline text, files, briefs, and factsheets"],
  ["refs", "References", "Visual inspiration, avoid, competitors"],
  [
    "materials",
    "Materials",
    "Products, people, and objects used directly in generated artwork"
  ],
  ["past", "Past work", "Delivered runs and approved learnings"],
  ["learning", "Brand learning", "What's working and what to avoid"],
  [
    "questionnaire",
    "Questionnaire",
    "Onboarding-only source context used by Brand Memory and Hook Agent"
  ]
];

type BrandSnapshotSection = "brand" | "products" | "learning";

const brandSnapshotSections: readonly [
  BrandSnapshotSection,
  string
][] = [
  ["brand", "Brand system"],
  ["products", "Product truths"],
  ["learning", "Creative learnings"]
];

const brandSystemTopics = [
  {
    title: "Brand Details",
    aliases: ["brand details", "แบรนด์ทำอะไร"]
  },
  {
    title: "Target Audience",
    aliases: ["target audience", "กลุ่มเป้าหมายและปัญหาที่ต้องการแก้"]
  },
  {
    title: "USP",
    aliases: ["usp", "จุดยืน จุดแตกต่าง และคุณค่าหลัก"]
  },
  {
    title: "Mood&Tone",
    aliases: [
      "mood&tone",
      "mood & tone",
      "tone & style",
      "tone and style",
      "น้ำเสียงและแนวทางการสื่อสาร"
    ]
  }
] as const;

function BrandProfilePanel({
  state,
  dispatch,
  section,
  onSectionChange
}: {
  state: WorkflowState;
  dispatch: Dispatch<WorkflowAction>;
  section: BrandProfileSection;
  onSectionChange: (section: BrandProfileSection) => void;
}) {
  const brand = state.brand;
  const repository = useBrandMemoryRepository();
  const [brandRules, setBrandRules] = useState<readonly LibraryItem[]>(
    brand?.library.brand ?? []
  );
  const [products, setProducts] = useState<readonly BrandProduct[]>([]);
  const [guidelineDialogOpen, setGuidelineDialogOpen] = useState(false);

  useEffect(() => {
    if (!brand) return;
    let active = true;
    setBrandRules(brand.library.brand);
    setProducts([]);

    void Promise.all([
      repository.listBrandRules(brand.id),
      repository.listProducts(brand.id)
    ])
      .then(([rules, nextProducts]) => {
        if (!active) return;
        setBrandRules(rules.length ? rules : brand.library.brand);
        setProducts(nextProducts);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [brand, repository]);

  if (!brand) {
    return (
      <section className="compass-signal-memory-card">
        <div className="compass-signal-memory-top">
          <div>
            <h3>Brand memory</h3>
            <p>Nothing loaded yet.</p>
          </div>
        </div>
        <div className="compass-signal-memory-content">
          <div className="compass-signal-memory-empty">
            <div>
              <b>No memory loaded.</b>
              <span>Choose a brand to reveal the signal stack.</span>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const activeSection: BrandSnapshotSection = brandSnapshotSections.some(
    ([id]) => id === section
  )
    ? (section as BrandSnapshotSection)
    : "brand";
  const logoRule = brandRules.find(
    (item) => item.title.trim().toLowerCase() === "logo" && item.assetUrl
  );
  const logoUrl = logoRule?.assetUrl;
  const colors = Array.from(
    new Set([
      ...extractColorSwatches(findRuleByTitle(brandRules, "Colors")),
      ...extractColorSwatches(findRuleByTitle(brandRules, "Secondary colors"))
    ])
  ).slice(0, 6);
  const snapshotItems = brandSnapshotItems({
    brand,
    brandRules,
    products,
    section: activeSection
  });

  return (
    <>
      <aside className="compass-signal-memory-card" aria-label="Brand profile">
      <div className="compass-signal-memory-top">
        <div>
          <h3>{brand.name} memory</h3>
          <p>Logo, colors, and the signals guiding this run.</p>
        </div>
        <button
          className="btn secondary compass-memory-guideline-button"
          type="button"
          onClick={() => setGuidelineDialogOpen(true)}
        >
          <FileArrowUp size={16} weight="bold" aria-hidden="true" />
          Add guideline
        </button>
      </div>
      <div className="compass-brand-snapshot">
        <div className="compass-brand-snapshot-identity">
          <div className="compass-brand-snapshot-logo">
            <BrandLogo
              brand={brand}
              assetUrl={logoUrl}
              alt={`${brand.name} logo`}
            />
          </div>
          <div className="compass-brand-snapshot-name">
            <b>{brand.name}</b>
            <span>{brand.category}</span>
          </div>
          <div className="compass-brand-snapshot-colors" aria-label="Brand colors">
            <small>Brand colors</small>
            <div>
              {colors.length ? (
                colors.map((color) => (
                  <span
                    key={color}
                    title={color}
                    style={{ backgroundColor: color }}
                  />
                ))
              ) : (
                <em>No colors saved</em>
              )}
            </div>
          </div>
        </div>
        <nav className="compass-signal-memory-tabs" aria-label="Brand memory sections">
          {brandSnapshotSections.map(([id, label]) => (
            <button
              key={id}
              className={activeSection === id ? "active" : ""}
              type="button"
              onClick={() => onSectionChange(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div
          className={`compass-brand-snapshot-list ${
            activeSection === "brand" || activeSection === "learning"
              ? "is-full"
              : ""
          } ${activeSection === "learning" ? "is-learning" : ""}`}
        >
          {snapshotItems.length ? (
            activeSection === "learning" ? (
              <div className="compass-brand-learning-groups">
                {(["Working", "Avoid"] as const).map((group) => {
                  const items = snapshotItems.filter(
                    (item) => item.title === group
                  );
                  if (!items.length) return null;

                  return (
                    <section
                      className={`compass-brand-learning-group ${group.toLowerCase()}`}
                      key={group}
                    >
                      <h4>{group}</h4>
                      <ul>
                        {items.map((item) => (
                          <li key={`${group}-${item.detail}`}>{item.detail}</li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            ) : (
              snapshotItems.map((item) => (
                <article key={`${activeSection}-${item.title}-${item.detail}`}>
                  <b>{item.title}</b>
                  <p>{item.detail}</p>
                </article>
              ))
            )
          ) : (
            <div className="compass-brand-snapshot-empty">
              No saved signals in this section yet.
            </div>
          )}
        </div>
      </div>
      </aside>
      {guidelineDialogOpen ? (
        <GuidelineQuickAddDialog
          brandName={brand.name}
          clientId={brand.id}
          initialItems={brandRules}
          initialGuidelines={brand.library.docs}
          onSaved={({ brandRules: items, guidelines }) => {
            setBrandRules(items);
            dispatch({ type: "sync-brand-rules", items });
            dispatch({ type: "sync-brand-guidelines", items: guidelines });
          }}
          onClose={() => setGuidelineDialogOpen(false)}
        />
      ) : null}
    </>
  );
}

function GuidelineQuickAddDialog({
  brandName,
  clientId,
  initialItems,
  initialGuidelines,
  onSaved,
  onClose
}: {
  brandName: string;
  clientId: string;
  initialItems: readonly LibraryItem[];
  initialGuidelines: readonly LibraryItem[];
  onSaved: (result: SavedBrandGuideline) => void;
  onClose: () => void;
}) {
  const repository = useBrandMemoryRepository();
  const [mode, setMode] = useState<"choose" | "text">("choose");
  const [guidelineText, setGuidelineText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze(source: GuidelineSource) {
    setAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeAndSaveBrandGuideline({
        repository,
        clientId,
        items: initialItems,
        guidelines: initialGuidelines,
        source
      });
      onSaved(result);
      setAnalyzing(false);
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not analyze guideline."
      );
      setAnalyzing(false);
    }
  }

  return (
    <div
      className="output-modal-backdrop compass-guideline-backdrop"
      onClick={analyzing ? undefined : onClose}
    >
      <section
        className="output-modal compass-guideline-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-guideline-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="output-modal-head compass-guideline-head">
          <div>
            <h3 id="quick-guideline-title">Add brand guideline</h3>
            <p>Connect a file or approved text to {brandName} memory.</p>
          </div>
          <button
            className="compass-guideline-close"
            type="button"
            aria-label="Close guideline upload"
            disabled={analyzing}
            onClick={onClose}
          >
            <X size={18} weight="bold" aria-hidden="true" />
          </button>
        </header>

        {mode === "choose" ? (
          <div className="compass-guideline-choices">
            <label
              className={`compass-guideline-choice ${analyzing ? "disabled" : ""}`}
            >
              <span className="compass-guideline-choice-icon" aria-hidden="true">
                <FileArrowUp size={24} weight="duotone" />
              </span>
              <b>{analyzing ? "Analyzing file..." : "Upload file"}</b>
              <small>PDF, PNG, JPEG, or WEBP</small>
              <input
                className="file-input"
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                disabled={analyzing}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void analyze({ file });
                }}
              />
            </label>
            <button
              className="compass-guideline-choice"
              type="button"
              disabled={analyzing}
              onClick={() => setMode("text")}
            >
              <span className="compass-guideline-choice-icon" aria-hidden="true">
                <TextT size={24} weight="duotone" />
              </span>
              <b>Paste text</b>
              <small>Voice, tone, CI, positioning, or colors</small>
            </button>
          </div>
        ) : (
          <div className="compass-guideline-text-mode">
            <label className="output-modal-prompt-label">
              <span>Guideline text</span>
              <textarea
                autoFocus
                value={guidelineText}
                disabled={analyzing}
                placeholder="Paste approved brand guideline text here..."
                rows={7}
                onChange={(event) => setGuidelineText(event.target.value)}
              />
            </label>
            <div className="output-modal-actions">
              <button
                className="btn ghost"
                type="button"
                disabled={analyzing}
                onClick={() => setMode("choose")}
              >
                Back
              </button>
              <button
                className="btn primary"
                type="button"
                disabled={analyzing || !guidelineText.trim()}
                onClick={() => void analyze({ text: guidelineText })}
              >
                {analyzing ? "Analyzing..." : "Analyze text"}
              </button>
            </div>
          </div>
        )}

        {error ? <p className="memory-error">{error}</p> : null}
      </section>
    </div>
  );
}

function brandSnapshotItems({
  brand,
  brandRules,
  products,
  section
}: {
  brand: Brand;
  brandRules: readonly LibraryItem[];
  products: readonly BrandProduct[];
  section: BrandSnapshotSection;
}): readonly { title: string; detail: string }[] {
  if (section === "brand") {
    return brandSystemTopics.flatMap((topic) => {
      const item = brandRules.find((rule) =>
        topic.aliases.some((alias) =>
          normalizeBrandSystemTitle(rule.title).includes(
            normalizeBrandSystemTitle(alias)
          )
        )
      );
      if (!item) return [];

      return [
        {
          title: topic.title,
          detail: presentBrandMemoryText(item.description).text
        }
      ];
    });
  }

  if (section === "products") {
    const repositoryProducts = products.map((product) => ({
      title: product.name,
      detail:
        product.keyBenefit || product.offer || product.description || product.audience
    }));
    if (repositoryProducts.length) return repositoryProducts;

    return brand.library.products.map((item) => ({
      title: item.title,
      detail: presentBrandMemoryText(item.description).text
    }));
  }

  return [
    ...brand.memory.working.map((detail) => ({
      title: "Working",
      detail: presentBrandMemoryText(detail).text
    })),
    ...brand.memory.avoid.map((detail) => ({
      title: "Avoid",
      detail: presentBrandMemoryText(detail).text
    }))
  ];
}

function normalizeBrandSystemTitle(value: string): string {
  return value.toLocaleLowerCase("th").replace(/[\s&]+/g, "");
}

function BrandLibraryModal({
  state,
  dispatch,
  section,
  onSectionChange,
  onClose
}: {
  state: WorkflowState;
  dispatch: Dispatch<WorkflowAction>;
  section: BrandProfileSection;
  onSectionChange: (section: BrandProfileSection) => void;
  onClose: () => void;
}) {
  const brand = state.brand;
  if (!brand) return null;

  const counts: Record<BrandProfileSection, number> = {
    brand: brand.library.brand.length,
    products: brand.library.products.length,
    docs: brand.library.docs.length,
    refs: brand.library.refs.length,
    materials: state.uploadedMaterials.length,
    past: 0,
    learning: brand.memory.working.length + brand.memory.avoid.length,
    questionnaire: brand.onboardingQuestionnaire ? 1 : 0
  };
  const activeSection =
    brandProfileSections.find(([id]) => id === section) ?? brandProfileSections[0];

  return (
    <div className="output-modal-backdrop compass-library-backdrop" onClick={onClose}>
      <section
        className="output-modal compass-material-manager-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="brand-library-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="compass-material-manager-head">
          <div>
            <p className="eyebrow">Brand Library</p>
            <h3 id="brand-library-title">Manage brand materials</h3>
            <p>
              Search, organize, update, and remove the source memory used by Creative Compass.
            </p>
          </div>
          <button
            className="compass-material-close"
            type="button"
            aria-label="Close brand library"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="compass-material-manager-toolbar">
          <div>
            <b>{brand.name}</b>
            <span>Live Brand Memory</span>
          </div>
          <span className="pill green">Used in creative context</span>
        </div>
        <div className="compass-material-manager-window">
          <nav className="compass-material-folder-nav" aria-label="Brand library folders">
            {brandProfileSections.map(([id, label, description], index) => (
              <button
                className={`compass-material-folder-btn ${section === id ? "active" : ""}`}
                type="button"
                key={id}
                onClick={() => onSectionChange(id)}
              >
                <span className="compass-material-folder-icon" aria-hidden="true">
                  {index + 1}
                </span>
                <span>
                  <b>{label}</b>
                  <small>
                    {counts[id]} item{counts[id] === 1 ? "" : "s"} · {description}
                  </small>
                </span>
              </button>
            ))}
          </nav>
          <section className="compass-material-browser">
            <div className="compass-material-browser-head">
              <div>
                <b>{activeSection?.[1]}</b>
                <span>{activeSection?.[2]}</span>
              </div>
              <span>
                {counts[section]} item{counts[section] === 1 ? "" : "s"}
              </span>
            </div>
            <div className="compass-material-browser-content">
              <BrandProfileSectionContent
                state={state}
                dispatch={dispatch}
                section={section}
              />
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function LibraryEditModal({
  title,
  description,
  busy,
  onClose,
  children
}: {
  title: string;
  description?: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  if (typeof document === "undefined") return null;
  const portalRoot = document.querySelector(".compass-app") ?? document.body;

  return createPortal(
    <div
      className="output-modal-backdrop compass-library-edit-backdrop"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <section
        className="output-modal compass-library-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="output-modal-head compass-library-edit-head">
          <div>
            <p className="eyebrow">Manage library</p>
            <h3 id={titleId}>{title}</h3>
            {description ? <p>{description}</p> : null}
          </div>
          <button
            className="btn ghost"
            type="button"
            disabled={busy}
            aria-label="Close edit popup"
            onClick={onClose}
          >
            Close
          </button>
        </header>
        <div className="compass-library-edit-body">{children}</div>
      </section>
    </div>,
    portalRoot
  );
}

function BrandProfileSectionContent({
  state,
  dispatch,
  section
}: {
  state: WorkflowState;
  dispatch: Dispatch<WorkflowAction>;
  section: BrandProfileSection;
}) {
  const brand = state.brand;
  if (!brand) return null;

  return (
    <div className="brand-profile-body">
      {section === "brand" ? (
        <BrandKitMemoryList
          clientId={brand.id}
          brandName={brand.name}
          initialItems={brand.library.brand}
          libraryDocuments={brand.library.docs}
          onBrandRulesSaved={(items) =>
            dispatch({ type: "sync-brand-rules", items })
          }
          onGuidelinesSaved={(items) =>
            dispatch({ type: "sync-brand-guidelines", items })
          }
        />
      ) : null}
      {section === "products" ? (
        <BrandProductsMemoryList clientId={brand.id} />
      ) : null}
      {section === "docs" ? (
        <BrandDocumentsMemoryList
          clientId={brand.id}
          libraryItems={brand.library.docs}
          legacyBrandGuideline={findRuleByTitle(
            brand.library.brand,
            "Brand CI / Guideline"
          )}
          onGuidelinesSaved={(items) =>
            dispatch({ type: "sync-brand-guidelines", items })
          }
        />
      ) : null}
      {section === "refs" ? (
        <BrandReferencesMemoryList
          clientId={brand.id}
          initialItems={brand.library.refs}
          onSaved={(items) =>
            dispatch({ type: "sync-brand-references", items })
          }
        />
      ) : null}
      {section === "materials" ? (
        <BrandMaterialsMemoryList state={state} dispatch={dispatch} />
      ) : null}
      {section === "past" ? (
        <PastWorkPreview state={state} clientId={brand.id} />
      ) : null}
      {section === "learning" ? <BrandLearning state={state} /> : null}
      {section === "questionnaire" ? (
        <OnboardingQuestionnaireMemory
          clientId={brand.id}
          initialQuestionnaire={brand.onboardingQuestionnaire}
          onSaved={(questionnaire) =>
            dispatch({
              type: "sync-onboarding-questionnaire",
              questionnaire
            })
          }
        />
      ) : null}
    </div>
  );
}

function OnboardingQuestionnaireMemory({
  clientId,
  initialQuestionnaire,
  onSaved
}: {
  clientId: string;
  initialQuestionnaire: OnboardingQuestionnaireSource | undefined;
  onSaved: (questionnaire: OnboardingQuestionnaireSource) => void;
}) {
  const repository = useBrandMemoryRepository();
  const { readMappingQuestionnaire } = useBrands();
  const [questionnaire, setQuestionnaire] = useState(initialQuestionnaire);
  const [sheetUrl, setSheetUrl] = useState(
    initialQuestionnaire?.sourceUrl ?? ""
  );
  const [editing, setEditing] = useState(!initialQuestionnaire);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQuestionnaire(initialQuestionnaire);
    setSheetUrl(initialQuestionnaire?.sourceUrl ?? "");
    setEditing(!initialQuestionnaire);
  }, [clientId, initialQuestionnaire]);

  async function saveQuestionnaire(): Promise<void> {
    const urlError = validateQuestionnaireGoogleSheetUrl(sheetUrl);
    if (urlError) {
      setError(urlError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const imported = await importQuestionnaireFromGoogleSheet(
        sheetUrl,
        readMappingQuestionnaire
      );
      const saved = await repository.saveOnboardingQuestionnaire({
        clientId,
        text: imported.text,
        sourceUrl: imported.sourceUrl ?? sheetUrl.trim(),
        sheetTitle: imported.sheetTitle,
        extractedFields: imported.extractedFields
      });
      setQuestionnaire(saved);
      setSheetUrl(saved.sourceUrl ?? sheetUrl.trim());
      setEditing(false);
      onSaved(saved);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save the onboarding questionnaire."
      );
    } finally {
      setSaving(false);
    }
  }

  function cancelEditing(): void {
    setSheetUrl(questionnaire?.sourceUrl ?? "");
    setError(null);
    setEditing(!questionnaire);
  }

  const questionnaireForm = (
    <div className="memory-form questionnaire-memory-form">
      {error ? (
        <p className="memory-error" role="alert">
          {error}
        </p>
      ) : null}
      <OnboardingQuestionnaireField
        value={sheetUrl}
        disabled={saving}
        onChange={setSheetUrl}
      />
      <div className="memory-form-actions">
        {questionnaire ? (
          <button
            className="btn secondary"
            type="button"
            disabled={saving}
            onClick={cancelEditing}
          >
            Cancel
          </button>
        ) : null}
        <button
          className="btn primary"
          type="button"
          disabled={saving || !sheetUrl.trim()}
          onClick={() => void saveQuestionnaire()}
        >
          {saving ? "Importing…" : "Import questionnaire"}
        </button>
      </div>
    </div>
  );

  return (
    <section className="memory-editor questionnaire-memory">
      <header>
        <div>
          <h4>Onboarding questionnaire</h4>
          <p>
            Onboarding-only historical context for Brand Memory and Hook Agent.
            This is not the brief for the current campaign.
          </p>
        </div>
        {questionnaire && !editing ? (
          <button
            className="btn primary"
            type="button"
            onClick={() => setEditing(true)}
          >
            Edit questionnaire
          </button>
        ) : null}
      </header>

      {editing ? (
        questionnaire ? (
          <LibraryEditModal
            title="Edit questionnaire"
            description="Update the Google Sheet used as onboarding context."
            busy={saving}
            onClose={cancelEditing}
          >
            {questionnaireForm}
          </LibraryEditModal>
        ) : (
          questionnaireForm
        )
      ) : questionnaire ? (
        <article className="memory-item questionnaire-memory-item">
          {questionnaire.extractedFields?.length ? (
            <GoogleSheetExtractionSummary questionnaire={questionnaire} />
          ) : (
            <>
              <b>Imported questionnaire</b>
              <p className="memory-item-desc">{questionnaire.text}</p>
            </>
          )}
          {questionnaire.sourceUrl ? (
            <a
              className="memory-citation"
              href={questionnaire.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open questionnaire Google Sheet
            </a>
          ) : null}
          <div className="memory-item-actions">
            <span>Used in Hook Agent context</span>
            <button type="button" onClick={() => setEditing(true)}>
              Edit
            </button>
          </div>
        </article>
      ) : null}
    </section>
  );
}

function BrandProductsMemoryList({ clientId }: { clientId: string }) {
  const repository = useBrandMemoryRepository();
  const [products, setProducts] = useState<readonly BrandProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [offer, setOffer] = useState("");
  const [keyBenefit, setKeyBenefit] = useState("");
  const [audience, setAudience] = useState("");
  const [claimNotes, setClaimNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const formOpen = editingId !== null;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    void repository
      .listProducts(clientId)
      .then((items) => {
        if (!active) return;
        setProducts(items);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setError(
          error instanceof Error ? error.message : "Could not load products."
        );
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [clientId, repository]);

  function resetForm() {
    setEditingId(null);
    setName("");
    setDescription("");
    setOffer("");
    setKeyBenefit("");
    setAudience("");
    setClaimNotes("");
    setError(null);
  }

  function openCreateForm() {
    resetForm();
    setEditingId("");
    setError(null);
  }

  function openEditForm(product: BrandProduct) {
    setEditingId(product.id);
    setName(product.name);
    setDescription(product.description);
    setOffer(product.offer);
    setKeyBenefit(product.keyBenefit);
    setAudience(product.audience);
    setClaimNotes(product.claimNotes);
    setError(null);
  }

  async function saveProduct() {
    if (!name.trim()) {
      setError("Product or service name is required.");
      return;
    }

    const input = {
      name: name.trim(),
      description: description.trim(),
      offer: offer.trim(),
      keyBenefit: keyBenefit.trim(),
      audience: audience.trim(),
      claimNotes: claimNotes.trim()
    };
    setSaving(true);
    setError(null);

    try {
      if (editingId) {
        const updated = await repository.updateProduct({
          id: editingId,
          ...input
        });
        setProducts((current) =>
          current.map((product) =>
            product.id === updated.id ? updated : product
          )
        );
      } else {
        const created = await repository.createProduct({
          clientId,
          ...input
        });
        setProducts((current) => [...current, created]);
      }
      resetForm();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not save product."
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteProduct(product: BrandProduct) {
    setSaving(true);
    setError(null);

    try {
      await repository.deleteProduct(product.id);
      setProducts((current) =>
        current.filter((candidate) => candidate.id !== product.id)
      );
      if (editingId === product.id) resetForm();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not delete product."
      );
    } finally {
      setSaving(false);
    }
  }

  const productForm = (
    <div className="memory-form product-memory-form">
      {error ? <p className="memory-error">{error}</p> : null}
      <label>
        <span>Product / service name</span>
        <input
          value={name}
          disabled={saving}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        <span>What it is</span>
        <textarea
          rows={2}
          value={description}
          disabled={saving}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label>
        <span>Offer</span>
        <textarea
          rows={2}
          value={offer}
          disabled={saving}
          onChange={(event) => setOffer(event.target.value)}
        />
      </label>
      <label>
        <span>Key benefit</span>
        <textarea
          rows={2}
          value={keyBenefit}
          disabled={saving}
          onChange={(event) => setKeyBenefit(event.target.value)}
        />
      </label>
      <label>
        <span>Audience</span>
        <textarea
          rows={2}
          value={audience}
          disabled={saving}
          onChange={(event) => setAudience(event.target.value)}
        />
      </label>
      <label>
        <span>Claim notes</span>
        <textarea
          rows={2}
          value={claimNotes}
          disabled={saving}
          onChange={(event) => setClaimNotes(event.target.value)}
        />
      </label>
      <div className="memory-form-actions">
        <button
          className="btn ghost"
          type="button"
          disabled={saving}
          onClick={resetForm}
        >
          Cancel
        </button>
        <button
          className="btn primary"
          type="button"
          disabled={saving}
          onClick={() => void saveProduct()}
        >
          {saving ? "Saving..." : "Save product"}
        </button>
      </div>
    </div>
  );

  return (
    <section className="memory-editor">
      <header>
        <div>
          <h4>Products</h4>
          <p>
            Default offers, benefits, audience, and claim notes extracted by
            Creative Compass. Review and edit before generation.
          </p>
        </div>
        {!formOpen ? (
          <button
            className="btn primary"
            type="button"
            disabled={saving}
            onClick={openCreateForm}
          >
            Add product
          </button>
        ) : null}
      </header>
      {error && !formOpen ? <p className="memory-error">{error}</p> : null}
      {formOpen ? (
        editingId ? (
          <LibraryEditModal
            title="Edit product or service"
            description={name}
            busy={saving}
            onClose={resetForm}
          >
            {productForm}
          </LibraryEditModal>
        ) : (
          productForm
        )
      ) : null}
      {loading ? <p className="repository-message">Loading products...</p> : null}
      {products.length ? (
        <div className="memory-item-list">
          {products.map((product) => (
            <article className="memory-item product-memory-item" key={product.id}>
              <b>{product.name}</b>
              {product.description ? <p>{product.description}</p> : null}
              <dl>
                <ProductField label="Offer" value={product.offer} />
                <ProductField label="Benefit" value={product.keyBenefit} />
                <ProductField label="Audience" value={product.audience} />
                <ProductField label="Claim notes" value={product.claimNotes} />
              </dl>
              <div className="memory-item-actions">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => openEditForm(product)}
                >
                  Edit
                </button>
                <button
                  className="memory-delete-action"
                  type="button"
                  disabled={saving}
                  onClick={() => void deleteProduct(product)}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : !loading ? (
        <div className="empty">
          <b>No products yet.</b>
          <p>Run brand analysis or add a product manually.</p>
        </div>
      ) : null}
    </section>
  );
}

function ProductField({ label, value }: { label: string; value: string }) {
  if (!value) return null;

  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

type GuidelineSource = { file: File } | { text: string };
type SavedBrandGuideline = {
  brandRules: readonly LibraryItem[];
  guidelines: readonly LibraryItem[];
};

const EDITABLE_GUIDELINE_TITLE = "Brand guideline";

function upsertLibraryItem(
  items: readonly LibraryItem[],
  saved: LibraryItem
): readonly LibraryItem[] {
  return items.some((item) => item.id === saved.id)
    ? items.map((item) => (item.id === saved.id ? saved : item))
    : [...items, saved];
}

async function analyzeAndSaveBrandGuideline({
  repository,
  clientId,
  items,
  guidelines,
  source
}: {
  repository: BrandMemoryRepository;
  clientId: string;
  items: readonly LibraryItem[];
  guidelines: readonly LibraryItem[];
  source: GuidelineSource;
}): Promise<SavedBrandGuideline> {
  const analysis = await repository.analyzeGuideline(
    "file" in source
      ? { clientId, file: source.file }
      : { clientId, text: source.text }
  );
  let nextItems = items;
  let nextGuidelines = guidelines;

  if ("text" in source) {
    const existing = findRuleByTitle(
      nextGuidelines,
      EDITABLE_GUIDELINE_TITLE
    );
    const saved = existing
      ? await repository.updateGuideline({
          id: existing.id,
          title: EDITABLE_GUIDELINE_TITLE,
          description: source.text.trim()
        })
      : await repository.createGuideline({
          clientId,
          title: EDITABLE_GUIDELINE_TITLE,
          description: source.text.trim()
        });
    nextGuidelines = upsertLibraryItem(nextGuidelines, saved);
  }

  async function saveRule(
    ruleTitle: string,
    description: string,
    assetFile?: File
  ) {
    const existing = findRuleByTitle(nextItems, ruleTitle);
    const saved = existing
      ? await repository.updateBrandRule({
          id: existing.id,
          title: ruleTitle,
          description,
          ...(assetFile ? { assetFile } : {})
        })
      : await repository.createBrandRule({
          clientId,
          title: ruleTitle,
          description,
          ...(assetFile ? { assetFile } : {})
        });
    nextItems = upsertLibraryItem(nextItems, saved);
  }

  if (analysis.summary.trim()) {
    await saveRule("Tone & Style", analysis.summary.trim());
  }

  if (analysis.generationContext.trim()) {
    const guidelineImage =
      "file" in source && isImageGuidelineFile(source.file)
        ? source.file
        : undefined;
    await saveRule(
      "Brand CI / Guideline",
      analysis.generationContext.trim(),
      guidelineImage
    );
  }

  for (const [ruleTitle, newColors] of [
    ["Colors", analysis.primaryColors],
    ["Secondary colors", analysis.secondaryColors]
  ] as const) {
    if (!newColors.length) continue;
    const existing = findRuleByTitle(nextItems, ruleTitle);
    const merged = Array.from(
      new Set(
        [...extractColorSwatches(existing), ...newColors].map((value) =>
          value.toUpperCase()
        )
      )
    );
    await saveRule(ruleTitle, merged.join(", "));
  }

  return { brandRules: nextItems, guidelines: nextGuidelines };
}

function isImageGuidelineFile(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    /\.(?:png|jpe?g|webp)$/i.test(file.name)
  );
}

function BrandKitMemoryList({
  clientId,
  brandName,
  initialItems,
  libraryDocuments,
  onBrandRulesSaved,
  onGuidelinesSaved
}: {
  clientId: string;
  brandName: string;
  initialItems: readonly LibraryItem[];
  libraryDocuments: readonly LibraryItem[];
  onBrandRulesSaved: (items: readonly LibraryItem[]) => void;
  onGuidelinesSaved: (items: readonly LibraryItem[]) => void;
}) {
  const repository = useBrandMemoryRepository();
  const [items, setItems] = useState<readonly LibraryItem[]>(initialItems);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guidelineDialogOpen, setGuidelineDialogOpen] = useState(false);
  const [expandedMemoryItemIds, setExpandedMemoryItemIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const formOpen = editingId !== null;

  useEffect(() => {
    let active = true;
    setItems(initialItems);
    setLoading(true);
    setError(null);

    void repository
      .listBrandRules(clientId)
      .then((rules) => {
        if (!active) return;
        setItems(rules);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setError(
          error instanceof Error ? error.message : "Could not load brand kit."
        );
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [clientId, initialItems, repository]);

  function openCreateForm() {
    setEditingId("");
    setTitle("");
    setDescription("");
    setError(null);
  }

  function openEditForm(item: LibraryItem) {
    setEditingId(item.id);
    setTitle(item.title);
    setDescription(presentBrandMemoryText(item.description).text);
    setError(null);
  }

  function closeForm() {
    setEditingId(null);
    setTitle("");
    setDescription("");
    setError(null);
  }

  async function saveRule() {
    const nextTitle = title.trim();
    const nextDescription = description.trim();
    if (!nextTitle || !nextDescription) {
      setError("Add both a rule title and detail before saving.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (editingId) {
        const updated = await repository.updateBrandRule({
          id: editingId,
          title: nextTitle,
          description: nextDescription
        });
        setItems((current) =>
          current.map((item) => (item.id === updated.id ? updated : item))
        );
      } else {
        const created = await repository.createBrandRule({
          clientId,
          title: nextTitle,
          description: nextDescription
        });
        setItems((current) => [...current, created]);
      }
      closeForm();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save rule.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRule(item: LibraryItem) {
    setSaving(true);
    setError(null);

    try {
      await repository.deleteBrandRule(item.id);
      setItems((current) => current.filter((rule) => rule.id !== item.id));
      if (editingId === item.id) closeForm();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not delete rule.");
    } finally {
      setSaving(false);
    }
  }

  const logoItems = items.filter(
    (item) => item.title.trim().toLowerCase() === "logo"
  );
  const logoItem =
    logoItems.find((item) => item.assetUrl) ?? logoItems[0];
  const colorsItem = items.find(
    (item) => item.title.trim().toLowerCase() === "colors"
  );
  const secondaryColorsItem = items.find(
    (item) => item.title.trim().toLowerCase() === "secondary colors"
  );
  const otherItems = items.filter(
    (item) =>
      item !== logoItem && item !== colorsItem && item !== secondaryColorsItem
  );
  const missingIdentityInputs = missingBrandIdentityInputs(
    items,
    libraryDocuments,
    []
  );

  function renderMemoryItem(item: LibraryItem) {
    const visibleDescription = presentBrandMemoryText(item.description).text;
    const isVisualGuidance =
      item.title.trim().toLowerCase() === "visual guidance";
    const expanded = expandedMemoryItemIds.has(item.id);
    const tags = isVisualGuidance ? null : splitBrandKitTags(visibleDescription);
    return (
      <article
        className={`memory-item ${isVisualGuidance ? "visual-guidance-item" : ""}`}
        key={item.id}
      >
        <b>{item.title}</b>
        {tags ? (
          <div className="memory-tags">
            {tags.map((tag) => (
              <BrandKitTag key={tag} value={tag} />
            ))}
          </div>
        ) : (
          <p
            className={`memory-item-desc ${isVisualGuidance && !expanded ? "collapsed" : ""}`}
          >
            {visibleDescription}
          </p>
        )}
        {isVisualGuidance ? (
          <button
            className="memory-expand-button"
            type="button"
            aria-expanded={expanded}
            onClick={() =>
              setExpandedMemoryItemIds((current) => {
                const next = new Set(current);
                if (expanded) next.delete(item.id);
                else next.add(item.id);
                return next;
              })
            }
          >
            {expanded ? "See less" : "See more"}
          </button>
        ) : null}
        <div className="memory-item-actions">
          <button
            type="button"
            disabled={saving}
            onClick={() => openEditForm(item)}
          >
            Edit
          </button>
          <button
            className="memory-delete-action"
            type="button"
            disabled={saving}
            onClick={() => void deleteRule(item)}
          >
            Delete
          </button>
        </div>
      </article>
    );
  }

  const ruleForm = (
    <div className="memory-form">
      {error ? <p className="memory-error">{error}</p> : null}
      <label>
        <span>Rule title</span>
        <input
          value={title}
          disabled={saving}
          placeholder="Example: Voice"
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label>
        <span>Rule detail</span>
        <textarea
          value={description}
          disabled={saving}
          placeholder="Example: Calm, premium, direct. Avoid hype and exaggerated claims."
          rows={3}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <div className="memory-form-actions">
        <button
          className="btn ghost"
          type="button"
          disabled={saving}
          onClick={closeForm}
        >
          Cancel
        </button>
        <button
          className="btn primary"
          type="button"
          disabled={saving}
          onClick={() => void saveRule()}
        >
          {saving ? "Saving..." : "Save rule"}
        </button>
      </div>
    </div>
  );

  return (
    <section className="memory-editor">
      <header>
        <div>
          <h4>Brand kit</h4>
          <p>
            Add your brand assets so Creative Compass can create content that
            looks and sounds like your brand.
          </p>
        </div>
        <div className="memory-actions">
          <button
            className="btn secondary"
            type="button"
            onClick={() => setGuidelineDialogOpen(true)}
          >
            <FileArrowUp size={16} weight="bold" aria-hidden="true" />
            Add guideline
          </button>
          {!formOpen ? (
            <button
              className="btn primary"
              type="button"
              disabled={saving}
              onClick={openCreateForm}
            >
              Add brand rule
            </button>
          ) : null}
        </div>
      </header>
      {!loading && missingIdentityInputs.includes("Brand CI / Guideline") ? (
        <p className="compass-quality-note">
          Brand guideline is optional. Add one to improve tone, visual style,
          and brand consistency. You can add it later.
        </p>
      ) : null}
      <BrandLogoCard
        clientId={clientId}
        logoItem={logoItem}
        onSaved={(saved) =>
          setItems((current) =>
            current.some((item) => item.id === saved.id)
              ? current.map((item) => (item.id === saved.id ? saved : item))
              : [...current, saved]
          )
        }
      />
      <section className="brand-colors-section" aria-label="Brand colors">
        <ColorsCard
          clientId={clientId}
          ruleTitle="Colors"
          label="Primary colors"
          colorsItem={colorsItem}
          onSaved={(saved) =>
            setItems((current) =>
              current.some((item) => item.id === saved.id)
                ? current.map((item) => (item.id === saved.id ? saved : item))
                : [...current, saved]
            )
          }
          onDeleted={(id) =>
            setItems((current) => current.filter((item) => item.id !== id))
          }
        />
        <ColorsCard
          clientId={clientId}
          ruleTitle="Secondary colors"
          label="Secondary colors"
          colorsItem={secondaryColorsItem}
          onSaved={(saved) =>
            setItems((current) =>
              current.some((item) => item.id === saved.id)
                ? current.map((item) => (item.id === saved.id ? saved : item))
                : [...current, saved]
            )
          }
          onDeleted={(id) =>
            setItems((current) => current.filter((item) => item.id !== id))
          }
        />
      </section>
      {error && !formOpen ? <p className="memory-error">{error}</p> : null}
      {formOpen ? (
        editingId ? (
          <LibraryEditModal
            title="Edit brand rule"
            description={title}
            busy={saving}
            onClose={closeForm}
          >
            {ruleForm}
          </LibraryEditModal>
        ) : (
          ruleForm
        )
      ) : null}
      {loading ? <p className="repository-message">Loading brand kit...</p> : null}
      {otherItems.length ? (
        <div className="memory-item-list">
          {otherItems.map((item) => renderMemoryItem(item))}
        </div>
      ) : !loading && !colorsItem && !secondaryColorsItem && !logoItem ? (
        <div className="empty">
          <b>No brand kit yet.</b>
          <p>Add memory here before using it in generation.</p>
        </div>
      ) : null}
      {guidelineDialogOpen ? (
        <GuidelineQuickAddDialog
          brandName={brandName}
          clientId={clientId}
          initialItems={items}
          initialGuidelines={libraryDocuments}
          onSaved={({ brandRules, guidelines }) => {
            setItems(brandRules);
            onBrandRulesSaved(brandRules);
            onGuidelinesSaved(guidelines);
          }}
          onClose={() => setGuidelineDialogOpen(false)}
        />
      ) : null}
    </section>
  );
}

const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function ColorsCard({
  clientId,
  ruleTitle,
  label,
  colorsItem,
  onSaved,
  onDeleted
}: {
  clientId: string;
  ruleTitle: string;
  label: string;
  colorsItem: LibraryItem | undefined;
  onSaved: (item: LibraryItem) => void;
  onDeleted: (id: string) => void;
}) {
  const repository = useBrandMemoryRepository();
  const [editingHex, setEditingHex] = useState<string | null>(null);
  const [draftHex, setDraftHex] = useState("");
  const [addingHex, setAddingHex] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const colors = extractColorSwatches(colorsItem);

  async function persist(nextColors: readonly string[]) {
    setBusy(true);
    setError(null);

    try {
      if (nextColors.length === 0) {
        if (colorsItem) {
          await repository.deleteBrandRule(colorsItem.id);
          onDeleted(colorsItem.id);
        }
        return;
      }

      const description = nextColors.join(", ");
      const saved = colorsItem
        ? await repository.updateBrandRule({
            id: colorsItem.id,
            title: ruleTitle,
            description
          })
        : await repository.createBrandRule({
            clientId,
            title: ruleTitle,
            description
          });
      onSaved(saved);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save colors."
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd() {
    const trimmed = addingHex.trim();
    if (!HEX_COLOR_PATTERN.test(trimmed)) {
      setError("Enter a valid hex color, e.g. #1D1D1F.");
      return;
    }
    await persist([...colors, trimmed.toUpperCase()]);
    setAddingHex("");
  }

  async function handleEditSave(oldHex: string) {
    const trimmed = draftHex.trim();
    if (!HEX_COLOR_PATTERN.test(trimmed)) {
      setError("Enter a valid hex color, e.g. #1D1D1F.");
      return;
    }
    await persist(
      colors.map((hex) => (hex === oldHex ? trimmed.toUpperCase() : hex))
    );
    setEditingHex(null);
  }

  async function handleDelete(hex: string) {
    await persist(colors.filter((current) => current !== hex));
  }

  return (
    <div className="colors-card">
      <b>{label}</b>
      <div className="colors-grid">
        {colors.map((hex) =>
          editingHex === hex ? (
            <div className="color-swatch color-swatch-editing" key={hex}>
              <input
                value={draftHex}
                autoFocus
                disabled={busy}
                onChange={(event) => setDraftHex(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleEditSave(hex);
                  if (event.key === "Escape") setEditingHex(null);
                }}
              />
              <div className="color-swatch-edit-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleEditSave(hex)}
                >
                  Save
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditingHex(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="color-swatch" key={hex}>
              <button
                type="button"
                className="color-swatch-remove"
                disabled={busy}
                aria-label={`Remove ${hex}`}
                onClick={() => void handleDelete(hex)}
              >
                ×
              </button>
              <button
                type="button"
                className="color-swatch-block"
                style={{ background: hex }}
                disabled={busy}
                title="Click to edit"
                onClick={() => {
                  setEditingHex(hex);
                  setDraftHex(hex);
                  setError(null);
                }}
              />
              <span className="color-swatch-code">{hex}</span>
            </div>
          )
        )}
        <div className="color-swatch color-swatch-add">
          <input
            value={addingHex}
            placeholder="#1D1D1F"
            disabled={busy}
            onChange={(event) => setAddingHex(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleAdd();
            }}
          />
          <button
            type="button"
            disabled={busy || !addingHex.trim()}
            onClick={() => void handleAdd()}
          >
            Add
          </button>
        </div>
      </div>
      {ruleTitle === "Colors" && colors.length === 0 ? (
        <p className="compass-quality-note">
          Add the colors your brand uses most often. You can add them later.
        </p>
      ) : null}
      {error ? <p className="memory-error">{error}</p> : null}
    </div>
  );
}

const BRAND_KIT_TAG_MAX_LENGTH = 40;

function splitBrandKitTags(description: string): readonly string[] | null {
  const trimmed = description.trim();
  if (!trimmed || trimmed.includes(".")) return null;

  const segments = (
    trimmed.includes("\n") ? trimmed.split("\n") : trimmed.split(",")
  )
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length < 2) return null;
  if (segments.some((segment) => segment.length > BRAND_KIT_TAG_MAX_LENGTH)) {
    return null;
  }

  return segments;
}

function BrandKitTag({ value }: { value: string }) {
  const isColor = HEX_COLOR_PATTERN.test(value);
  return (
    <span className="memory-tag">
      {isColor ? (
        <span className="memory-tag-swatch" style={{ background: value }} />
      ) : null}
      {value}
    </span>
  );
}

function BrandLogoCard({
  clientId,
  logoItem,
  onSaved
}: {
  clientId: string;
  logoItem: LibraryItem | undefined;
  onSaved: (item: LibraryItem) => void;
}) {
  const repository = useBrandMemoryRepository();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const saved = logoItem
        ? await repository.updateBrandRule({
            id: logoItem.id,
            title: "Logo",
            description: logoItem.description || "Brand logo",
            assetFile: file
          })
        : await repository.createBrandRule({
            clientId,
            title: "Logo",
            description: "Brand logo",
            assetFile: file
          });
      onSaved(saved);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not upload logo."
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="brand-logo-card">
      <div className="brand-logo-preview">
        {logoItem?.assetUrl ? (
          <img src={logoItem.assetUrl} alt="Brand logo" />
        ) : (
          <span className="brand-logo-placeholder">Logo</span>
        )}
      </div>
      <div className="brand-logo-body">
        <b>Logo</b>
        <p>PNG, JPEG, or WEBP. Used across generation and previews.</p>
        {!logoItem?.assetUrl ? (
          <p className="compass-quality-note">
            Upload your logo to keep generated artwork visually consistent.
            You can add it later.
          </p>
        ) : null}
        {error ? <p className="memory-error">{error}</p> : null}
      </div>
      <label
        className={`btn secondary small upload-inline ${uploading ? "disabled" : ""}`}
      >
        {uploading ? "Uploading…" : logoItem ? "Replace logo" : "Upload logo"}
        <input
          className="file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={uploading}
          onChange={(event) => void handleUpload(event)}
        />
      </label>
    </div>
  );
}

function BrandReferencesMemoryList({
  clientId,
  initialItems,
  onSaved
}: {
  clientId: string;
  initialItems: readonly LibraryItem[];
  onSaved: (items: readonly LibraryItem[]) => void;
}) {
  const repository = useBrandMemoryRepository();
  const [items, setItems] = useState(initialItems);

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  async function uploadReference(file: File): Promise<void> {
    const saved = await repository.createReferenceImage({ clientId, file });
    const nextItems = [saved, ...items.filter((item) => item.id !== saved.id)];
    setItems(nextItems);
    onSaved(nextItems);
  }

  return (
    <section className="memory-editor compass-brand-references">
      <header>
        <div>
          <h4>References</h4>
          <p>
            Upload approved visual references for creative direction and image
            generation.
          </p>
        </div>
        <InlineUploadForm
          actionLabel="Upload reference"
          onUpload={uploadReference}
        />
      </header>
      {items.length ? (
        <div className="compass-brand-reference-grid">
          {items.map((item) => (
            <article className="compass-brand-reference-card" key={item.id}>
              {item.assetUrl ? (
                <img src={item.assetUrl} alt={item.title} />
              ) : (
                <div className="compass-brand-reference-placeholder">
                  No preview
                </div>
              )}
              <div>
                <b>{item.title}</b>
                <p>{item.description || "Visual reference"}</p>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty">
          <b>No references yet.</b>
          <p>Upload a PNG, JPEG, or WEBP image to add the first reference.</p>
        </div>
      )}
    </section>
  );
}

function BrandDocumentsMemoryList({
  clientId,
  libraryItems,
  legacyBrandGuideline,
  onGuidelinesSaved
}: {
  clientId: string;
  libraryItems: NonNullable<WorkflowState["brand"]>["library"]["docs"];
  legacyBrandGuideline?: LibraryItem;
  onGuidelinesSaved: (items: readonly LibraryItem[]) => void;
}) {
  const repository = useBrandMemoryRepository();
  const legacyMigrationAttempted = useRef(false);
  const [documents, setDocuments] = useState<readonly BrandDocument[]>([]);
  const [guidelines, setGuidelines] =
    useState<readonly LibraryItem[]>(libraryItems);
  const [documentType, setDocumentType] =
    useState<BrandDocumentType>("brand_guideline");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [editingGuidelineId, setEditingGuidelineId] = useState<string | null>(
    null
  );
  const [guidelineTitle, setGuidelineTitle] = useState("");
  const [guidelineText, setGuidelineText] = useState("");
  const [savingGuideline, setSavingGuideline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGuidelines(libraryItems);
  }, [libraryItems]);

  useEffect(() => {
    const hasEditableGuideline = libraryItems.some(
      (item) =>
        item.title.trim().toLowerCase() ===
        EDITABLE_GUIDELINE_TITLE.toLowerCase()
    );
    if (
      hasEditableGuideline ||
      legacyMigrationAttempted.current
    ) {
      return;
    }

    legacyMigrationAttempted.current = true;
    let active = true;
    void Promise.all([
      repository.listGuidelines(clientId),
      repository.listBrandRules(clientId)
    ])
      .then(async ([existing, latestBrandRules]) => {
        if (!active) return;
        const existingEditable = findRuleByTitle(
          existing,
          EDITABLE_GUIDELINE_TITLE
        );
        if (existingEditable) {
          setGuidelines(existing);
          onGuidelinesSaved(existing);
          return;
        }

        const source =
          legacyBrandGuideline ??
          findRuleByTitle(latestBrandRules, "Brand CI / Guideline");
        if (!source?.description.trim()) return;

        const created = await repository.createGuideline({
          clientId,
          title: EDITABLE_GUIDELINE_TITLE,
          description: source.description.trim()
        });
        if (!active) return;
        const next = [...existing, created];
        setGuidelines(next);
        onGuidelinesSaved(next);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not prepare the editable guideline."
        );
      });

    return () => {
      active = false;
    };
  }, [
    clientId,
    legacyBrandGuideline,
    libraryItems.length,
    repository
  ]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    void repository
      .listDocuments(clientId)
      .then((documents) => {
        if (!active) return;
        setDocuments(documents);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setError(
          error instanceof Error ? error.message : "Could not load documents."
        );
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [clientId, repository]);

  async function uploadDocument(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);

    try {
      const document = await repository.uploadDocument({
        clientId,
        file,
        documentType
      });
      setDocuments((current) => [document, ...current]);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function editGuideline(item: LibraryItem) {
    setEditingGuidelineId(item.id);
    setGuidelineTitle(item.title);
    setGuidelineText(item.description);
    setError(null);
  }

  function cancelGuidelineEdit() {
    setEditingGuidelineId(null);
    setGuidelineTitle("");
    setGuidelineText("");
    setError(null);
  }

  async function saveGuideline() {
    if (!editingGuidelineId || !guidelineText.trim()) {
      setError("Guideline text is required.");
      return;
    }

    setSavingGuideline(true);
    setError(null);
    try {
      const updated = await repository.updateGuideline({
        id: editingGuidelineId,
        title: guidelineTitle,
        description: guidelineText.trim()
      });
      const next = guidelines.map((item) =>
        item.id === updated.id ? updated : item
      );
      setGuidelines(next);
      onGuidelinesSaved(next);
      cancelGuidelineEdit();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save guideline."
      );
    } finally {
      setSavingGuideline(false);
    }
  }

  const guidelineForm = (
    <div className="memory-form">
      {error ? <p className="memory-error">{error}</p> : null}
      <label>
        <span>Guideline text</span>
        <textarea
          value={guidelineText}
          disabled={savingGuideline}
          rows={10}
          onChange={(event) => setGuidelineText(event.target.value)}
        />
      </label>
      <div className="memory-form-actions">
        <button
          className="btn ghost"
          type="button"
          disabled={savingGuideline}
          onClick={cancelGuidelineEdit}
        >
          Cancel
        </button>
        <button
          className="btn primary"
          type="button"
          disabled={savingGuideline || !guidelineText.trim()}
          onClick={() => void saveGuideline()}
        >
          {savingGuideline ? "Saving…" : "Save guideline"}
        </button>
      </div>
    </div>
  );

  return (
    <section className="memory-editor">
      <header>
        <div>
          <h4>Guideline</h4>
          <p>Edit source guideline text or upload supporting documents for AI.</p>
        </div>
        <div className="memory-upload-controls">
          <label>
            <span>Document type</span>
            <select
              value={documentType}
              disabled={uploading}
              onChange={(event) =>
                setDocumentType(event.target.value as BrandDocumentType)
              }
            >
              {brandDocumentTypes.map((type) => (
                <option key={type} value={type}>
                  {brandDocumentTypeLabels[type]}
                </option>
              ))}
            </select>
          </label>
          <div className="memory-actions">
            <label className={`btn secondary ${uploading ? "disabled" : ""}`}>
              {uploading ? "Uploading..." : "Upload document"}
              <input
                className="memory-file-input"
                type="file"
                disabled={uploading}
                accept=".pdf,.doc,.docx,.csv,.txt,image/png,image/jpeg,image/webp,image/gif"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  void uploadDocument(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <button className="btn primary" type="button" disabled>
              Add document note
            </button>
          </div>
        </div>
      </header>
      {error && !editingGuidelineId ? (
        <p className="memory-error">{error}</p>
      ) : null}
      {loading ? <p className="repository-message">Loading documents...</p> : null}
      {documents.length ? (
        <>
          <span className="memory-subhead">Uploaded documents</span>
          <div className="memory-item-list">
            {documents.map((document) => (
              <article className="memory-item" key={document.id}>
                <b>{document.title}</b>
                <p>
                  {brandDocumentTypeLabels[document.documentType]} ·{" "}
                  {document.processingStatus.replaceAll("_", " ")}
                </p>
                <span>
                  {document.usableForAi ? "Ready for AI" : "Uploaded"}
                </span>
              </article>
            ))}
          </div>
        </>
      ) : null}
      {guidelines.length ? (
        <>
          <span className="memory-subhead">Editable guideline text</span>
          <div className="memory-item-list">
            {guidelines.map((item) => (
              <article className="memory-item" key={item.id}>
                <b>{item.title}</b>
                <p>{item.description}</p>
                <div className="memory-item-actions">
                  <button
                    type="button"
                    disabled={savingGuideline}
                    onClick={() => editGuideline(item)}
                  >
                    Edit
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}
      {editingGuidelineId ? (
        <LibraryEditModal
          title="Edit guideline"
          description={guidelineTitle}
          busy={savingGuideline}
          onClose={cancelGuidelineEdit}
        >
          {guidelineForm}
        </LibraryEditModal>
      ) : null}
      {!loading && !documents.length && !guidelines.length ? (
        <div className="empty">
          <b>No documents yet.</b>
          <p>Upload a guideline, brief, product sheet, or reference file.</p>
        </div>
      ) : null}
    </section>
  );
}

function PastWorkPreview({
  state,
  clientId
}: {
  state: WorkflowState;
  clientId: string;
}) {
  const repository = useBrandMemoryRepository();
  const [pastWork, setPastWork] = useState<readonly BrandPastWorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const delivered = state.done && state.outputs.length > 0;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    void repository
      .listPastWork(clientId)
      .then((items) => {
        if (!active) return;
        setPastWork(items);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setError(
          error instanceof Error
            ? error.message
            : "Could not load past work."
        );
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [clientId, repository]);

  const facebookPosts = pastWork.filter(
    (item) => item.sourceType === "facebook_post"
  );
  const adsLibraryWork = pastWork.filter(
    (item) => item.sourceType === "ads_library"
  );

  function renderPastWorkCards(items: readonly BrandPastWorkItem[]) {
    return (
      <div className="past-work-grid">
        {items.map((item) => (
          <article className="past-work-card" key={item.id}>
            {item.imageUrl ? (
              <img src={item.imageUrl} alt={item.title} />
            ) : (
              <div className="past-work-media-placeholder">
                {item.sourceType === "facebook_post"
                  ? "Facebook post"
                  : "Ads Library creative"}
              </div>
            )}
            <div>
              <b>{item.title}</b>
              {item.description ? <p>{item.description}</p> : null}
              {item.sourceUrl ? (
                <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                  {item.sourceType === "facebook_post"
                    ? "View Facebook post"
                    : "View in Ads Library"}
                </a>
              ) : (
                <span>
                  {item.sourceType === "facebook_post"
                    ? "Facebook post"
                    : "Ads Library reference"}
                </span>
              )}
            </div>
          </article>
        ))}
      </div>
    );
  }

  return (
    <section className="memory-editor">
      <header>
        <div>
          <h4>Past work</h4>
          <p>
            Facebook posts and Ads Library references appear by default.
            Delivered Creative Compass work is shown separately when available.
          </p>
        </div>
        <span className="pill">Reference only</span>
      </header>
      {error ? <p className="memory-error">{error}</p> : null}
      {loading ? (
        <p className="repository-message">Loading past work...</p>
      ) : null}
      {facebookPosts.length ? (
        <>
          <span className="memory-subhead">Facebook posts</span>
          {renderPastWorkCards(facebookPosts)}
        </>
      ) : null}
      {adsLibraryWork.length ? (
        <>
          <span className="memory-subhead">Ads Library references</span>
          {renderPastWorkCards(adsLibraryWork)}
        </>
      ) : null}
      {delivered ? (
        <>
          <span className="memory-subhead">Delivered by Creative Compass</span>
          <div className="memory-item-list">
            {state.outputs.map((output, index) => (
              <article className="memory-item" key={output.id}>
                <b>Delivered creative {index + 1}</b>
                <p>
                  {output.format} · {output.clientStatus} ·{" "}
                  {output.revisionCount} revisions
                </p>
                <span>Derived from this run</span>
              </article>
            ))}
          </div>
        </>
      ) : null}
      {!loading && !pastWork.length && !delivered ? (
        <div className="empty">
          <b>No past work yet.</b>
          <p>
            Facebook posts, Ads Library references, or delivered runs will
            appear here.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function BrandLearning({ state }: { state: WorkflowState }) {
  return (
    <div className="start-learn">
      <span className="start-learn-h">
        Brand learning · {state.brand?.name}
      </span>
      <div className="ov-learn">
        <div className="ov-learn-col working">
          <h5>What&apos;s working</h5>
          <ul>
            {(state.brand?.memory.working.length
              ? state.brand.memory.working
              : ["No approved learning yet."]
            ).map((note) => {
              const presented = presentBrandMemoryText(note);
              return (
                <li key={note}>
                  <span>{presented.text}</span>
                  {presented.citationLabel ? (
                    <span
                      className="memory-citation"
                      title={presented.citationTitle ?? ""}
                    >
                      {presented.citationLabel}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
        <div className="ov-learn-col avoid">
          <h5>What to avoid</h5>
          <ul>
            {(state.brand?.memory.avoid.length
              ? state.brand.memory.avoid
              : ["No rejection learning yet."]
            ).map((note) => {
              const presented = presentBrandMemoryText(note);
              return (
                <li key={note}>
                  <span>{presented.text}</span>
                  {presented.citationLabel ? (
                    <span
                      className="memory-citation"
                      title={presented.citationTitle ?? ""}
                    >
                      {presented.citationLabel}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

const successMetricOptions = [
  { value: "CTR", description: "Stop the scroll" },
  { value: "CVR", description: "Strengthen intent" },
  { value: "CPA", description: "Improve efficiency" },
  { value: "ROAS", description: "Scale revenue" }
] as const;

const successMetricObjectives: Record<
  WorkflowState["successMetric"],
  string
> = {
  CTR: "Awareness",
  CVR: "Conversion",
  CPA: "Efficiency",
  ROAS: "Revenue"
};

const serviceDescriptions: Record<ServiceType, string> = {
  "single-static": "1:1 or 4:5 performance artwork",
  "album-post": "3 or 4-image Facebook album",
  "motion-static": "A lightweight animated execution",
  resize: "Adapt approved work to another placement",
  "ugc-video": "9:16 creator-led video concept"
};

const briefServiceTypes: readonly ServiceType[] = [
  "single-static",
  "ugc-video",
  "album-post"
];

const briefServiceLabels: Partial<Record<ServiceType, string>> = {
  "single-static": "Static",
  "ugc-video": "UGC",
  "album-post": "Album"
};

function briefServiceLabel(service: ServiceType): string {
  return briefServiceLabels[service] ?? serviceLabels[service];
}

const briefServiceIcons: Partial<Record<ServiceType, string>> = {
  "single-static": "ST",
  "ugc-video": "UG",
  "album-post": "AL"
};

const SHOW_ALBUM_FORMAT_PICKER = false;

export type BrandIdentityInput =
  | "Logo"
  | "Brand CI / Guideline"
  | "Colors";

export function missingBrandIdentityInputs(
  rules: readonly LibraryItem[],
  libraryDocuments: readonly LibraryItem[],
  documents: readonly Pick<BrandDocument, "title" | "documentType">[]
): readonly BrandIdentityInput[] {
  const logoReady = rules.some(
    (rule) => normalizedTitle(rule) === "logo" && Boolean(rule.assetUrl)
  );
  const colorsRule = rules.find(
    (rule) => normalizedTitle(rule) === "colors"
  );
  const colorsReady = extractColorSwatches(colorsRule).length > 0;
  const explicitGuideline = [...rules, ...libraryDocuments].some((item) =>
    isCiOrGuidelineTitle(item.title)
  );
  const guidelineDocument = documents.some(
    (document) =>
      document.documentType === "brand_guideline" ||
      isCiOrGuidelineTitle(document.title)
  );
  const extractedGuideline =
    colorsReady &&
    rules.some((rule) => normalizedTitle(rule) === "tone & style");

  return [
    ...(logoReady ? [] : (["Logo"] as const)),
    ...(explicitGuideline || guidelineDocument || extractedGuideline
      ? []
      : (["Brand CI / Guideline"] as const)),
    ...(colorsReady ? [] : (["Colors"] as const))
  ];
}

function normalizedTitle(item: Pick<LibraryItem, "title">): string {
  return item.title.trim().toLowerCase();
}

function isCiOrGuidelineTitle(title: string): boolean {
  return /\bci\b|\bguidelines?\b/i.test(title.trim());
}

const creativeMaterialRoleLabels: Record<CreativeMaterialRole, string> = {
  "main-object": "Main object",
  product: "Product",
  "supporting-component": "Supporting component",
  "client-context": "Person / client context"
};

function CreativeMaterialsEditor({
  state,
  dispatch
}: StageProps) {
  const [uploadPending, setUploadPending] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    if (state.uploadedMaterials.length + files.length > 8) {
      setUploadError("Use up to 8 creative material images per brief.");
      return;
    }

    setUploadPending(true);
    setUploadError(null);
    try {
      const items = await Promise.all(
        files.map((file) =>
          uploadCreativeMaterial({
            runId: state.id,
            brandId: state.brand?.id,
            file
          })
        )
      );
      dispatch({ type: "add-uploaded-materials", items });
    } catch (caught) {
      setUploadError(
        caught instanceof Error ? caught.message : "Could not upload the image."
      );
    } finally {
      setUploadPending(false);
    }
  }

  return (
    <div className="compass-creative-material-editor">
      <div className="compass-creative-material-upload-row">
        <label className="btn secondary compass-brief-add-files">
          {uploadPending ? "Uploading…" : "Add material images"}
          <input
            className="file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            disabled={uploadPending}
            onChange={handleUpload}
          />
        </label>
      </div>
      <p className="compass-creative-material-helper">
        The Hook Agent inspects these images before proposing ideas. The Image
        Agent receives them as source materials and uses each image according
        to its assigned role.
      </p>
      {uploadError ? (
        <p className="error-text" role="alert">
          {uploadError}
        </p>
      ) : null}
      {state.uploadedMaterials.length ? (
        <div className="compass-creative-material-grid">
          {state.uploadedMaterials.map((material) => (
            <article
              className="compass-creative-material-card"
              key={material.id}
            >
              <img src={material.url} alt={material.name} />
              <div className="compass-creative-material-fields">
                <div className="compass-creative-material-name">
                  <b>{material.name}</b>
                  <button
                    type="button"
                    aria-label={`Remove ${material.name}`}
                    onClick={() =>
                      dispatch({
                        type: "remove-uploaded-material",
                        id: material.id
                      })
                    }
                  >
                    ×
                  </button>
                </div>
                <label>
                  Use as
                  <select
                    value={material.role}
                    onChange={(event) =>
                      dispatch({
                        type: "update-uploaded-material",
                        id: material.id,
                        changes: {
                          role: event.target.value as CreativeMaterialRole
                        }
                      })
                    }
                  >
                    {creativeMaterialRoles.map((role) => (
                      <option value={role} key={role}>
                        {creativeMaterialRoleLabels[role]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Usage note <span>(optional)</span>
                  <input
                    value={material.description}
                    placeholder="e.g. Keep this bottle as the hero object"
                    onChange={(event) =>
                      dispatch({
                        type: "update-uploaded-material",
                        id: material.id,
                        changes: {
                          description: event.target.value
                        }
                      })
                    }
                  />
                </label>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="compass-signal-memory-empty">
          <div>
            <b>No material images added.</b>
            <span>
              Add a product, person, or object that should appear in the
              generated artwork.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function BrandMaterialsMemoryList({
  state,
  dispatch
}: StageProps) {
  return (
    <section className="memory-editor compass-brand-materials">
      <header>
        <div>
          <h4>Materials</h4>
          <p>
            The same source images shown in Brief materials. Changes made here
            are included in the current creative brief.
          </p>
        </div>
        <span className="pill blue">
          {state.uploadedMaterials.length} image
          {state.uploadedMaterials.length === 1 ? "" : "s"}
        </span>
      </header>
      <CreativeMaterialsEditor state={state} dispatch={dispatch} />
    </section>
  );
}

export function BriefStage({ state, dispatch }: StageProps) {
  const brandMemoryRepository = useBrandMemoryRepository();
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [materialsInitialCategory, setMaterialsInitialCategory] =
    useState<ReferenceLibraryCategory | null>(null);
  const [referenceUploadPending, setReferenceUploadPending] = useState(false);
  const [referenceUploadError, setReferenceUploadError] = useState<
    string | null
  >(null);
  const backAction: WorkflowAction = { type: "set-stage", stage: "start" };
  const generateBlocked = workflowActionBlockReason(state, {
    type: "generate-directions",
    directions: []
  });
  const { generate, loading, error } = useGenerateHooks(state, dispatch);
  const workingCount = state.brand?.memory.working.length ?? 0;
  const avoidCount = state.brand?.memory.avoid.length ?? 0;
  const brandProducts = state.brand?.library.products ?? [];
  const activeProducts = selectedBrandProducts(state);
  const activeProductIds = new Set(activeProducts.map((product) => product.id));
  const availableReferenceCount = state.brand?.library.refs.length ?? 0;
  const materialCount = state.uploadedMaterials.length;

  function openMaterials(
    category: ReferenceLibraryCategory | null = null
  ): void {
    setMaterialsInitialCategory(category);
    setMaterialsOpen(true);
  }

  async function saveReferenceImage(file: File) {
    const clientId = state.brand?.id;
    if (!clientId) return;

    const saved = await brandMemoryRepository.createReferenceImage({
      clientId,
      file
    });
    dispatch({
      type: "sync-brand-references",
      items: [
        saved,
        ...(state.brand?.library.refs ?? []).filter(
          (reference) => reference.id !== saved.id
        )
      ]
    });

    const selectedReference = libraryItemsWithImages([saved], "style")[0];
    if (
      selectedReference &&
      !state.referenceImages.some(
        (reference) => reference.id === selectedReference.id
      )
    ) {
      dispatch({ type: "toggle-reference-image", item: selectedReference });
    }
  }

  async function handleReferenceUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setReferenceUploadPending(true);
    setReferenceUploadError(null);
    try {
      await saveReferenceImage(file);
    } catch (caught) {
      setReferenceUploadError(
        caught instanceof Error
          ? caught.message
          : "Could not upload the reference."
      );
    } finally {
      setReferenceUploadPending(false);
    }
  }

  const mixItems = creativeMixItems(state);
  const totalDeliverables = totalCreativeMixQuantity(state);
  const fixedMixItems = briefServiceTypes
    .map((service) => mixItems.find((item) => item.service === service))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const fixedMixReady = fixedMixItems.length === briefServiceTypes.length;
  useEffect(() => {
    if (!fixedMixReady) dispatch({ type: "apply-monthly-quota" });
  }, [dispatch, fixedMixReady]);

  useEffect(() => {
    const clientId = state.brand?.id;
    if (!clientId) return;

    let active = true;
    void brandMemoryRepository
      .listBrandRules(clientId)
      .then((rules) => {
        if (!active) return;
        const logoRule = findRuleByTitle(rules, "Logo");
        const [logoCandidate] = logoRule
          ? libraryItemsWithImages([logoRule])
          : [];
        dispatch({
          type: "sync-brand-logo-reference",
          item: logoCandidate ?? null
        });
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [brandMemoryRepository, dispatch, state.brand]);

  return (
    <DecisionCard
      eyebrow="02 / Brief"
      title="Shape the creative problem."
      helper="Set the mix, define the objective, and choose the one metric this creative set should move."
      status={state.brand ? `${state.brand.name} context ready` : "Context waiting"}
      statusClass="green"
      className="compass-stage-brief"
      actions={
        <>
          <button
            className="btn ghost"
            type="button"
            onClick={() => dispatch(backAction)}
          >
            ← Back to signal
          </button>
          <div className="compass-brief-generate-actions">
            <HookIdeaModeToggle
              disabled={loading}
              dispatch={dispatch}
            />
            <button
              className="btn orange"
              type="button"
              disabled={Boolean(generateBlocked) || loading}
              title={generateBlocked ?? undefined}
              onClick={generate}
            >
              {loading ? <Spinner /> : null}
              {loading ? "Generating angles…" : "Generate angles →"}
            </button>
          </div>
        </>
      }
    >
      {error ? <p className="repository-message error">{error}</p> : null}
      <div className="brief-grid compass-brief-layout">
        <div className="brief-main">
          <section className="compass-workflow-module brief-setup-module">
            <div className="compass-module-head">
              <div>
                <h3>Creative mix</h3>
                <p>
                  {totalDeliverables} deliverables planned · max 50 per content
                  type
                </p>
              </div>
              <button
                className="btn secondary small"
                type="button"
                onClick={() => dispatch({ type: "apply-monthly-quota" })}
              >
                Use monthly quota
              </button>
            </div>
            <div className="compass-plan-rows">
              {fixedMixItems.map((item) => {
                const label = briefServiceLabel(item.service);
                return (
                  <div className="compass-plan-row" key={item.id}>
                    <span className="compass-type-icon" aria-hidden="true">
                      {briefServiceIcons[item.service]}
                    </span>
                    <div className="compass-plan-copy">
                      <b>{label}</b>
                      <p>{serviceDescriptions[item.service]}</p>
                    </div>
                    <div className="compass-mix-row-controls">
                      <div className="qty">
                        <button
                          type="button"
                          aria-label={`Decrease ${label} quantity`}
                          disabled={item.quantity <= 0}
                          onClick={() =>
                            dispatch({
                              type: "set-creative-mix-quantity",
                              id: item.id,
                              quantity: item.quantity - 1
                            })
                          }
                        >
                          −
                        </button>
                        <input
                          aria-label={`${label} quantity`}
                          type="number"
                          min={QUANTITY_LIMITS.minimum}
                          max={QUANTITY_LIMITS.maximum}
                          value={item.quantity}
                          onChange={(event) =>
                            dispatch({
                              type: "set-creative-mix-quantity",
                              id: item.id,
                              quantity: Number(event.target.value)
                            })
                          }
                        />
                        <button
                          type="button"
                          aria-label={`Increase ${label} quantity`}
                          disabled={item.quantity >= QUANTITY_LIMITS.maximum}
                          onClick={() =>
                            dispatch({
                              type: "set-creative-mix-quantity",
                              id: item.id,
                              quantity: item.quantity + 1
                            })
                          }
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {SHOW_ALBUM_FORMAT_PICKER &&
            fixedMixItems.some(
              (item) => item.service === "album-post" && item.quantity > 0
            ) ? (
              <div className="compass-album-format-picker">
                <div className="compass-album-format-head">
                  <div>
                    <b>Album format</b>
                    <p>
                      Sets the story layout, image agent composition, and final
                      crops.
                    </p>
                  </div>
                  <span>
                    {state.albumFormat === "auto"
                      ? "Best layout per idea"
                      : `${albumFormatPanelCount(state.albumFormat)} images`}
                  </span>
                </div>
                <div
                  className="compass-album-format-options"
                  role="group"
                  aria-label="Album format"
                >
                  <button
                    className={`compass-album-format-auto ${
                      state.albumFormat === "auto" ? "active" : ""
                    }`}
                    type="button"
                    aria-label="Automatically choose the best album format for each idea"
                    aria-pressed={state.albumFormat === "auto"}
                    onClick={() =>
                      dispatch({ type: "set-album-format", format: "auto" })
                    }
                  >
                    <span
                      className="compass-album-format-auto-icon"
                      aria-hidden="true"
                    >
                      <Sparkle size={20} weight="fill" />
                    </span>
                    <span>
                      <b>Auto · best for each idea</b>
                      <small>
                        The Hook Agent chooses from all four layouts using the
                        concept and visual direction.
                      </small>
                    </span>
                  </button>
                  {albumFormats.map((format) => (
                    <button
                      className={
                        state.albumFormat === format ? "active" : ""
                      }
                      type="button"
                      aria-label={albumFormatLabel(format)}
                      aria-pressed={state.albumFormat === format}
                      key={format}
                      onClick={() =>
                        dispatch({ type: "set-album-format", format })
                      }
                    >
                      <AlbumFormatDiagram format={format} />
                      <span>{albumFormatLabel(format)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
          <section className="compass-workflow-module brief-editor-module">
            <div className="compass-module-head">
              <div>
                <h3>Creative brief</h3>
                <p>One clear problem. One clear outcome.</p>
              </div>
            </div>
            <div className="textarea-wrap">
              <label className="compass-brief-field-label" htmlFor="brief">
                <span>Working brief</span>
                <span className="compass-brief-char-count">
                  {state.brief.length} chars
                </span>
              </label>
              <textarea
                id="brief"
                value={state.brief}
                onChange={(event) =>
                  dispatch({ type: "set-brief", brief: event.target.value })
                }
              />
            </div>
          </section>
        </div>
        <aside className="compass-context-stack">
          <section className="compass-context-card">
            <h3>Brief materials</h3>
            <div className="compass-signal-list">
              <div className="compass-signal-line">
                <b>Brand memory</b>
                <span>
                  {state.brand
                    ? `${workingCount} working cues and ${avoidCount} guardrails loaded.`
                    : "Choose a brand to load its memory."}
                </span>
              </div>
              <div className="compass-signal-disclosure-wrap">
                <details className="compass-signal-disclosure" open>
                  <summary>
                    <span className="compass-signal-summary-copy">
                      <b>Product truth</b>
                      <span>
                        {brandProducts.length
                          ? `${activeProducts.length} of ${brandProducts.length} ${pluralize(brandProducts.length, "product")} selected.`
                          : "No product material loaded yet."}
                      </span>
                    </span>
                    <span className="compass-signal-chevron" aria-hidden="true">
                      ›
                    </span>
                  </summary>
                  <div className="compass-signal-detail">
                    {brandProducts.length ? (
                      <div className="compass-product-truth-list">
                        {brandProducts.map((product) => (
                          <label
                            className="compass-product-truth-option"
                            key={product.id}
                          >
                            <input
                              type="checkbox"
                              checked={activeProductIds.has(product.id)}
                              aria-label={`Use product ${product.title}`}
                              onChange={() =>
                                dispatch({
                                  type: "toggle-product-context",
                                  id: product.id
                                })
                              }
                            />
                            <span>
                              <b>{product.title}</b>
                            </span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p>No products are available in this brand library.</p>
                    )}
                  </div>
                </details>
                <button
                  className="compass-signal-add"
                  type="button"
                  aria-label="Add Product truth"
                  title="Add Product truth"
                  onClick={() => openMaterials("product")}
                >
                  <Plus size={13} weight="bold" aria-hidden="true" />
                </button>
              </div>
              <div className="compass-signal-disclosure-wrap">
                <details className="compass-signal-disclosure" open>
                  <summary>
                    <span className="compass-signal-summary-copy">
                      <b>Reference context</b>
                      <span>
                        {state.referenceImages.length
                          ? `${state.referenceImages.length} selected ${pluralize(state.referenceImages.length, "reference")}.`
                          : `No active references · ${availableReferenceCount} available in the library.`}
                      </span>
                    </span>
                    <span className="compass-signal-chevron" aria-hidden="true">
                      ›
                    </span>
                  </summary>
                  <div className="compass-signal-detail">
                    {state.referenceImages.length ? (
                      <div className="compass-active-context-list">
                        {state.referenceImages.map((reference) => (
                          <article key={reference.id}>
                            <img src={reference.url} alt="" />
                            <span>
                              <b>{reference.label}</b>
                              <small>
                                {reference.primary ? "Primary · " : ""}
                                {
                                  referenceImageRoleLabels[
                                    inferredReferenceImageRole(reference)
                                  ]
                                }
                              </small>
                            </span>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p>No references are active in this brief.</p>
                    )}
                  </div>
                </details>
                <button
                  className="compass-signal-add"
                  type="button"
                  aria-label="Add Reference"
                  title="Add Reference"
                  onClick={() => openMaterials("reference")}
                >
                  <Plus size={13} weight="bold" aria-hidden="true" />
                </button>
              </div>
              <div className="compass-signal-disclosure-wrap">
                <details className="compass-signal-disclosure">
                  <summary>
                    <span className="compass-signal-summary-copy">
                      <b>Materials</b>
                      <span>
                      {materialCount
                          ? `${materialCount} source ${pluralize(materialCount, "image")} included.`
                          : "No uploaded materials yet."}
                      </span>
                    </span>
                    <span className="compass-signal-chevron" aria-hidden="true">
                      ›
                    </span>
                  </summary>
                  <div className="compass-signal-detail">
                    {materialCount ? (
                      <div className="compass-active-material-list">
                        {state.uploadedMaterials.map((material) => (
                          <article key={material.id}>
                            <b>{material.name}</b>
                            <span>
                              {creativeMaterialRoleLabels[material.role]}
                              {material.description
                                ? ` · ${material.description}`
                                : ""}
                            </span>
                          </article>
                        ))}
                        {state.attachments.map((name) => (
                          <article key={name}>
                            <b>{name}</b>
                            <span>Attached file</span>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p>No materials are active in this brief.</p>
                    )}
                    <button
                      className="compass-signal-manage"
                      type="button"
                      onClick={() => openMaterials()}
                    >
                      Manage references &amp; materials
                    </button>
                  </div>
                </details>
                <button
                  className="compass-signal-add"
                  type="button"
                  aria-label="Add Materials"
                  title="Add Materials"
                  onClick={() => openMaterials("material")}
                >
                  <Plus size={13} weight="bold" aria-hidden="true" />
                </button>
              </div>
            </div>
          </section>
          <section className="compass-context-card">
            <h3>Primary success metric</h3>
            <div
              className="compass-metric-choice"
              role="group"
              aria-label="Primary success metric"
            >
              {successMetricOptions.map((metric) => (
                <button
                  className={
                    state.successMetric === metric.value ? "active" : ""
                  }
                  type="button"
                  aria-pressed={state.successMetric === metric.value}
                  key={metric.value}
                  onClick={() =>
                    dispatch({
                      type: "set-success-metric",
                      metric: metric.value
                    })
                  }
                >
                  <b>{metric.value}</b>
                  <span>{metric.description}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="compass-context-card compass-principle-card">
            <h3>Creative principle</h3>
            <p>
              Distinctive beats decorative. Each idea should be recognizable in
              one second and arguable in one sentence.
            </p>
          </section>
        </aside>
      </div>
      {materialsOpen ? (
        <div
          className="output-modal-backdrop compass-library-backdrop"
          onClick={() => setMaterialsOpen(false)}
        >
          <section
            className="output-modal compass-material-manager-modal compass-brief-material-manager"
            role="dialog"
            aria-modal="true"
            aria-labelledby="brief-materials-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="compass-material-manager-head">
              <div>
                <h3 id="brief-materials-title">Brief materials</h3>
                <p>
                  Choose visual references, source materials, and supporting
                  files for this brief.
                </p>
              </div>
              <button
                className="compass-material-close"
                type="button"
                aria-label="Close brief materials"
                onClick={() => setMaterialsOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="compass-material-manager-toolbar">
              <div>
                <b>{state.brand?.name ?? "Current brief"}</b>
                <span>Materials included with creative generation</span>
              </div>
              <div
                className="compass-brief-material-totals"
                aria-label="Brief material counts"
              >
                <span>
                  <b>{state.referenceImages.length}</b> references
                </span>
                <span>
                  <b>
                    {state.uploadedMaterials.length}
                  </b>{" "}
                  materials
                </span>
                <span>
                  <b>{state.attachments.length}</b> brief files
                </span>
              </div>
            </div>
            <div className="compass-brief-materials-workspace">
              <section
                className="compass-brief-material-section compass-brief-library-section"
                aria-labelledby="brief-library-title"
              >
                <header className="compass-brief-material-section-head">
                  <div>
                    <h4 id="brief-library-title">Use from library</h4>
                    <p>Select approved brand assets and visual references.</p>
                  </div>
                  <span>Brand library</span>
                </header>
                <div className="compass-brief-material-section-body">
                  <ReferenceLibraryPicker
                    state={state}
                    dispatch={dispatch}
                    initialOpenCategory={materialsInitialCategory}
                    onUploadReferenceImage={saveReferenceImage}
                  />
                </div>
              </section>
              <div className="compass-brief-materials-side">
                <section
                  className="compass-brief-material-section compass-brief-selected-section"
                  aria-labelledby="brief-selected-references-title"
                >
                  <header className="compass-brief-material-section-head">
                    <div>
                      <h4 id="brief-selected-references-title">
                        References in Brief materials
                      </h4>
                      <p>
                        These guide style and composition; they are not source
                        objects.
                      </p>
                    </div>
                    <div className="compass-brief-section-head-actions">
                      <span>{state.referenceImages.length} selected</span>
                      <label
                        className={`btn small secondary compass-reference-upload ${
                          referenceUploadPending ? "disabled" : ""
                        }`}
                      >
                        {referenceUploadPending
                          ? "Uploading…"
                          : "Upload reference"}
                        <input
                          className="file-input"
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          aria-label="Upload reference"
                          disabled={referenceUploadPending}
                          onChange={handleReferenceUpload}
                        />
                      </label>
                    </div>
                  </header>
                  <div className="compass-brief-material-section-body">
                    {referenceUploadError ? (
                      <p className="error-text" role="alert">
                        {referenceUploadError}
                      </p>
                    ) : null}
                    {state.referenceImages.length ? (
                      <div className="compass-selected-reference-grid">
                        {state.referenceImages.map((reference) => (
                          <article
                            className="compass-selected-reference"
                            key={reference.id}
                          >
                            <img src={reference.url} alt={reference.label} />
                            <div>
                              <b>{reference.label}</b>
                              <span>Included in generation</span>
                            </div>
                            <button
                              type="button"
                              aria-label={`Remove ${reference.label} from brief`}
                              onClick={() =>
                                dispatch({
                                  type: "toggle-reference-image",
                                  item: reference
                                })
                              }
                            >
                              Remove
                            </button>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="compass-brief-material-empty">
                        <b>No references selected.</b>
                        <span>
                          Choose an image from the library to add it here.
                        </span>
                      </div>
                    )}
                  </div>
                </section>

                <section
                  className="compass-brief-material-section compass-brief-uploaded-section"
                  aria-labelledby="brief-uploaded-materials-title"
                >
                  <header className="compass-brief-material-section-head">
                    <div>
                      <h4 id="brief-uploaded-materials-title">
                        Materials
                      </h4>
                      <p>
                        Upload the exact products, people, or objects you want
                        used in the artwork.
                      </p>
                    </div>
                    <span>{state.uploadedMaterials.length} images</span>
                  </header>
                  <div className="compass-brief-material-section-body">
                    <div className="compass-brief-material-modal-body">
                      <CreativeMaterialsEditor
                        state={state}
                        dispatch={dispatch}
                      />
                      <div className="compass-brief-files-block">
                        <div>
                          <b>Brief files</b>
                          <span>
                            Documents support the brief but are not used as
                            visual source materials.
                          </span>
                        </div>
                        <label className="compass-brief-document-upload">
                          Attach documents
                          <input
                            className="file-input"
                            type="file"
                            multiple
                            onChange={(event) =>
                              dispatch({
                                type: "attach-files",
                                names: getFileNames(event.target.files)
                              })
                            }
                          />
                        </label>
                      </div>
                      {state.attachments.length ? (
                        <div className="chips compass-attachment-chips">
                          {state.attachments.map((name) => (
                            <span className="chip" key={name}>
                              {name}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </DecisionCard>
  );
}

function AlbumFormatDiagram({ format }: { format: AlbumFormat }) {
  return (
    <span
      className={`compass-album-format-diagram ${format}`}
      aria-hidden="true"
    >
      {Array.from(
        { length: albumFormatPanelCount(format) },
        (_, index) => (
          <i key={index} />
        )
      )}
    </span>
  );
}

type ReferenceLibraryCategory =
  | "guideline"
  | "logo"
  | "product"
  | "material"
  | "reference";

const REFERENCE_LIBRARY_CATEGORIES: readonly [
  ReferenceLibraryCategory,
  string
][] = [
  ["guideline", "Brand guideline"],
  ["logo", "Logo / CI assets"],
  ["product", "Product truth"],
  ["material", "Materials"],
  ["reference", "Reference board"]
];

function libraryItemsWithImages(
  items: readonly LibraryItem[],
  role?: ReferenceImageRole
): ReferenceImageSelection[] {
  return items
    .filter((item) => item.assetUrl)
    .map((item) => ({
      id: `library-${item.id}`,
      url: item.assetUrl as string,
      label: item.title || "Untitled",
      ...(role ? { role } : {})
    }));
}

function findRuleByTitle(
  rules: readonly LibraryItem[],
  title: string
): LibraryItem | undefined {
  return rules.find(
    (rule) => rule.title.trim().toLowerCase() === title.toLowerCase()
  );
}

function extractColorSwatches(rule: LibraryItem | undefined): readonly string[] {
  if (!rule) return [];
  return rule.description
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter((value) => HEX_COLOR_PATTERN.test(value));
}

function ReferenceLibraryPicker({
  state,
  dispatch,
  initialOpenCategory = null,
  onUploadReferenceImage
}: {
  state: WorkflowState;
  dispatch: Dispatch<WorkflowAction>;
  initialOpenCategory?: ReferenceLibraryCategory | null;
  onUploadReferenceImage: (file: File) => Promise<void>;
}) {
  const repository = useBrandMemoryRepository();
  const [brandRules, setBrandRules] = useState<readonly LibraryItem[]>([]);
  const [products, setProducts] = useState<readonly BrandProduct[]>([]);
  const [pastWork, setPastWork] = useState<readonly BrandPastWorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [openCategory, setOpenCategory] =
    useState<ReferenceLibraryCategory | null>(initialOpenCategory);
  const clientId = state.brand?.id;
  const brand = state.brand;

  function toggleExpanded(key: ReferenceLibraryCategory) {
    setOpenCategory((current) => (current === key ? null : key));
  }

  useEffect(() => {
    if (!clientId) {
      setBrandRules([]);
      setProducts([]);
      setPastWork([]);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    void Promise.all([
      repository.listBrandRules(clientId),
      repository.listProducts(clientId),
      repository.listPastWork(clientId)
    ])
      .then(([rules, brandProducts, past]) => {
        if (!active) return;
        setBrandRules(rules);
        setProducts(brandProducts);
        setPastWork(past);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, repository]);

  function upsertBrandRule(saved: LibraryItem) {
    setBrandRules((current) =>
      current.some((rule) => rule.id === saved.id)
        ? current.map((rule) => (rule.id === saved.id ? saved : rule))
        : [...current, saved]
    );
  }

  function saveLatestLogoReference(saved: LibraryItem) {
    upsertBrandRule(saved);
    dispatch({
      type: "sync-brand-logo-reference",
      item: libraryItemsWithImages([saved], "logo")[0] ?? null
    });
  }

  async function addColor(hex: string) {
    const trimmed = hex.trim();
    if (!HEX_COLOR_PATTERN.test(trimmed)) {
      throw new Error("Enter a valid hex color, e.g. #1D1D1F.");
    }
    if (!clientId) return;

    const colorsRule = findRuleByTitle(brandRules, "Colors");
    const nextDescription = colorsRule?.description
      ? `${colorsRule.description}, ${trimmed}`
      : trimmed;
    const saved = colorsRule
      ? await repository.updateBrandRule({
          id: colorsRule.id,
          title: "Colors",
          description: nextDescription
        })
      : await repository.createBrandRule({
          clientId,
          title: "Colors",
          description: nextDescription
        });
    upsertBrandRule(saved);
  }

  async function addProduct(name: string) {
    if (!clientId) return;
    const saved = await repository.createProduct({
      clientId,
      name: name.trim(),
      description: "",
      offer: "",
      keyBenefit: "",
      audience: "",
      claimNotes: ""
    });
    setProducts((current) => [...current, saved]);
    const savedLibraryItem: LibraryItem = {
      id: saved.id,
      title: saved.name,
      description: saved.description
    };
    dispatch({
      type: "sync-brand-products",
      items: [
        ...(brand?.library.products ?? []).filter(
          (item) => item.id !== saved.id
        ),
        savedLibraryItem
      ]
    });
    if (state.selectedProductIds !== undefined) {
      dispatch({ type: "toggle-product-context", id: saved.id });
    }
  }

  const logoRule = findRuleByTitle(brandRules, "Logo");

  const candidatesByCategory: Record<
    ReferenceLibraryCategory,
    (ReferenceImageSelection & { displayLabel?: string })[]
  > = {
    guideline: libraryItemsWithImages(brand?.library.docs ?? [], "content"),
    logo: logoRule ? libraryItemsWithImages([logoRule], "logo") : [],
    product: [],
    material: [],
    reference: [
      ...libraryItemsWithImages(brand?.library.refs ?? [], "style"),
      ...pastWork
        .filter(
          (item): item is BrandPastWorkItem & { imageUrl: string } =>
            Boolean(item.imageUrl)
        )
        .map((item) => ({
          id: `past-work-${item.id}`,
          url: item.imageUrl,
          label: `Past work style reference — ${item.title || "Untitled"}`,
          role: "style" as const,
          displayLabel: item.title || "Past work"
        }))
    ]
  };

  const toneAndStyleRule = findRuleByTitle(brandRules, "Tone & Style");
  const colorSwatches = extractColorSwatches(findRuleByTitle(brandRules, "Colors"));
  const secondaryColorSwatches = extractColorSwatches(
    findRuleByTitle(brandRules, "Secondary colors")
  );

  function renderCategoryBody(key: ReferenceLibraryCategory) {
    if (key === "product") {
      return (
        <div className="reference-category-body">
          {products.length ? (
            <div className="product-name-list">
              {products.map((productItem) => (
                <span className="memory-tag" key={productItem.id}>
                  {productItem.name}
                </span>
              ))}
            </div>
          ) : !loading ? (
            <p className="repository-message">
              No products added yet for this brand.
            </p>
          ) : null}
          <InlineAddForm
            placeholder="Product name"
            actionLabel="Add product"
            onAdd={addProduct}
          />
        </div>
      );
    }

    if (key === "material") {
      return (
        <div className="reference-category-body">
          {state.uploadedMaterials.length ? (
            <div className="reference-grid">
              {state.uploadedMaterials.map((material) => (
                <article
                  className="reference-item checked compass-library-material-item"
                  key={material.id}
                >
                  <img src={material.url} alt={material.name} />
                  <span>{material.name}</span>
                </article>
              ))}
            </div>
          ) : (
            <p className="repository-message">
              No materials added to this brief yet. Add product, person, or
              object images in the Materials panel.
            </p>
          )}
        </div>
      );
    }

    const candidates = candidatesByCategory[key];
    const hasToneAndStyle = key === "guideline" && Boolean(toneAndStyleRule);

    return (
      <div className="reference-category-body">
        {key === "guideline" && toneAndStyleRule ? (
          <div className="reference-tone-style">
            <b>Tone & Style</b>
            <p>{toneAndStyleRule.description}</p>
            <span className="reference-tone-style-note">
              Sent automatically as brand context with every generation.
            </span>
          </div>
        ) : null}

        {loading ? (
          <p className="repository-message">Loading library...</p>
        ) : candidates.length ? (
          <div className="reference-grid">
            {candidates.map((candidate) => {
              const checked = state.referenceImages.some(
                (item) => item.id === candidate.id
              );
              return (
                <label
                  className={`reference-item ${checked ? "checked" : ""}`}
                  key={candidate.id}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      dispatch({
                        type: "toggle-reference-image",
                        item: {
                          id: candidate.id,
                          url: candidate.url,
                          label: candidate.label,
                          role: candidate.role
                        }
                      })
                    }
                  />
                  <img src={candidate.url} alt={candidate.label} />
                  <span>{candidate.displayLabel ?? candidate.label}</span>
                </label>
              );
            })}
          </div>
        ) : !hasToneAndStyle ? (
          <p className="repository-message">
            No{" "}
            {REFERENCE_LIBRARY_CATEGORIES.find(
              ([id]) => id === key
            )?.[1].toLowerCase()}{" "}
            images available yet for this brand.
          </p>
        ) : null}

        {key === "logo" && clientId ? (
          <>
            {colorSwatches.length || secondaryColorSwatches.length ? (
              <div className="reference-color-groups">
                {colorSwatches.length ? (
                  <div className="reference-color-group">
                    <span className="reference-color-group-label">
                      Primary
                    </span>
                    <div className="memory-tags">
                      {colorSwatches.map((hex) => (
                        <BrandKitTag key={hex} value={hex} />
                      ))}
                    </div>
                  </div>
                ) : null}
                {secondaryColorSwatches.length ? (
                  <div className="reference-color-group">
                    <span className="reference-color-group-label">
                      Secondary
                    </span>
                    <div className="memory-tags">
                      {secondaryColorSwatches.map((hex) => (
                        <BrandKitTag key={hex} value={hex} />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            <BrandLogoCard
              clientId={clientId}
              logoItem={logoRule}
              onSaved={saveLatestLogoReference}
            />
            <InlineAddForm
              placeholder="#1D1D1F"
              actionLabel="Add color"
              onAdd={addColor}
            />
          </>
        ) : null}

        {key === "reference" && clientId ? (
          <InlineUploadForm
            actionLabel="Upload reference image"
            onUpload={onUploadReferenceImage}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="source-checks">
      <div className="reference-accordion">
        {REFERENCE_LIBRARY_CATEGORIES.map(([key, label]) => (
          <div className="reference-accordion-row" key={key}>
            <button
              className="reference-accordion-toggle"
              type="button"
              aria-expanded={openCategory === key}
              onClick={() => toggleExpanded(key)}
            >
              <b>{label}</b>
              <span
                className={`reference-toggle-icon ${openCategory === key ? "open" : ""}`}
                aria-hidden="true"
              >
                ⌄
              </span>
            </button>
            {openCategory === key ? renderCategoryBody(key) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function InlineAddForm({
  placeholder,
  actionLabel,
  onAdd
}: {
  placeholder: string;
  actionLabel: string;
  onAdd: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!value.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onAdd(value);
      setValue("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="inline-add-form">
      <input
        value={value}
        placeholder={placeholder}
        disabled={saving}
        onChange={(event) => setValue(event.target.value)}
      />
      <button
        type="button"
        className="btn secondary small"
        disabled={saving}
        onClick={() => void submit()}
      >
        {saving ? "Adding…" : actionLabel}
      </button>
      {error ? <p className="memory-error">{error}</p> : null}
    </div>
  );
}

function InlineUploadForm({
  actionLabel,
  onUpload
}: {
  actionLabel: string;
  onUpload: (file: File) => Promise<void>;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      await onUpload(file);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not upload image."
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="inline-add-form">
      <label
        className={`btn secondary small upload-inline ${uploading ? "disabled" : ""}`}
      >
        {uploading ? "Uploading…" : actionLabel}
        <input
          className="file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={uploading}
          onChange={(event) => void handleUpload(event)}
        />
      </label>
      {error ? <p className="memory-error">{error}</p> : null}
    </div>
  );
}

export function DirectionsStage({ state, dispatch }: StageProps) {
  const selected = selectedDirectionCount(state);
  const requiredCount = totalCreativeMixQuantity(state);
  const editBriefAction: WorkflowAction = {
    type: "set-stage",
    stage: "brief"
  };
  const createOutputsAction: WorkflowAction = { type: "create-outputs" };
  const createOutputsBlocked = workflowActionBlockReason(
    state,
    createOutputsAction
  );
  const [editingDirectionId, setEditingDirectionId] = useState<string | null>(
    null
  );
  const [regeneratingDirectionId, setRegeneratingDirectionId] = useState<
    string | null
  >(null);
  const [regeneratingAll, setRegeneratingAll] = useState(false);
  const [manualHookGroup, setManualHookGroup] = useState<{
    service: ServiceType;
    title: string;
  } | null>(null);
  const [exportingAngles, setExportingAngles] = useState(false);
  const [exportAnglesError, setExportAnglesError] = useState<string | null>(null);
  const {
    generateMore,
    loading: generatingMore,
    loadingService: generatingMoreService,
    error: generateMoreError
  } = useGenerateMoreHooks(state, dispatch);
  const {
    regenerate,
    loadingId: regeneratingHookId,
    error: regenerateError
  } = useRegenerateHook(state, dispatch);
  const {
    regenerateAll,
    loading: regeneratingAllHooks,
    error: regenerateAllError
  } = useRegenerateAllHooks(state, dispatch);
  const {
    create: createSelectedHooks,
    loading: creating,
    error: createError,
    progress: artworkProgress
  } = useCreateSelectedHooks(state, dispatch);

  useEffect(() => {
    if (state.artworkMode === "design-system") return;
    dispatch({ type: "set-artwork-mode", mode: "design-system" });
  }, [dispatch, state.artworkMode]);

  async function handleExportAngles() {
    setExportingAngles(true);
    setExportAnglesError(null);
    try {
      const review = buildAngleExportReview(state);
      if (review.sections.length === 0) {
        throw new Error("Generate or add at least one hook before exporting.");
      }
      const { exportCompassIdeasReviewPdf } = await import(
        "../export-pdf-kit/export-ideas-review-pdf"
      );
      const brandSlug = (state.brand?.name ?? "creative-compass")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const filename = `${brandSlug || "creative-compass"}-angles.pdf`;
      await exportCompassIdeasReviewPdf(
        review.sections,
        filename,
        review.highlightMap,
        state.brand?.name ?? "Creative topics"
      );
    } catch (caught) {
      setExportAnglesError(
        caught instanceof Error ? caught.message : "Could not export angles PDF."
      );
    } finally {
      setExportingAngles(false);
    }
  }

  const angleGroups = buildAngleGroups(state);

  const editingDirection = state.directions.find(
    (direction) => direction.id === editingDirectionId
  );
  const regeneratingDirection = state.directions.find(
    (direction) => direction.id === regeneratingDirectionId
  );

  function handleDeleteDirection(directionId: string) {
    if (!window.confirm("Delete this hook option?")) return;
    dispatch({ type: "delete-direction", id: directionId });
  }

  return (
    <DecisionCard
      eyebrow="03 / Angles"
      title="Pick the hooks for this creative mix."
      helper="Creative Compass preselects a complete first set based on your quota. Keep the recommendations or swap any hook within its creative type."
      status={`Creative Compass picked ${selected} / ${requiredCount}`}
      statusClass={selected === requiredCount ? "green" : "blue"}
      className="compass-stage-angles"
      actions={
        <>
          <button
            className="btn secondary"
            type="button"
            onClick={() => dispatch(editBriefAction)}
          >
            ← Edit brief
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={creating || Boolean(createOutputsBlocked)}
            title={createOutputsBlocked ?? undefined}
            onClick={createSelectedHooks}
          >
            {creating ? <Spinner /> : null}
            {creating
              ? artworkProgress?.total
                ? `Generating artwork ${artworkProgress.completed}/${artworkProgress.total}…`
                : "Preparing artwork…"
              : "Confirm hooks & create →"}
          </button>
        </>
      }
    >
      <section className="compass-angle-settings" aria-label="Artwork settings">
        <div className="compass-angle-setting compass-angle-mode-setting">
          <span className="compass-angle-setting-label">Artwork mode</span>
          <div
            className="compass-angle-mode-options"
            role="group"
            aria-label="Artwork generation mode"
          >
            <button
              className="active"
              type="button"
              disabled={creating}
              aria-pressed="true"
              onClick={() =>
                dispatch({ type: "set-artwork-mode", mode: "design-system" })
              }
            >
              Design system
            </button>
          </div>
        </div>
        <label className="compass-angle-setting">
          <span className="compass-angle-setting-label">Generation path</span>
          <select
            className="compass-angle-model-select"
            aria-label="Generation path"
            value={state.imagePromptModel}
            disabled
          >
            <option value={state.imagePromptModel}>
              Luna treatment → GPT Image 2
            </option>
          </select>
        </label>
        <label className="compass-angle-setting compass-angle-size-setting">
          <span className="compass-angle-setting-label">Output size</span>
          <select
            className="compass-angle-model-select"
            aria-label="Output size"
            value={state.outputSize}
            disabled={creating}
            onChange={(event) =>
              dispatch({
                type: "set-output-size",
                size: event.target.value as WorkflowState["outputSize"]
              })
            }
          >
            {artworkOutputSizes.map((size) => (
              <option key={size} value={size}>
                {artworkOutputSizeLabel(size)}
              </option>
            ))}
          </select>
        </label>
      </section>
      <div className="direction-tools compass-angle-toolbar">
        <div>
          <h3>Review hooks</h3>
          <p>
            Select up to {requiredCount} hooks. Selected hooks export as
            Recommended; the rest stay as Options until deleted.
          </p>
        </div>
        <div className="compass-angle-toolbar-actions">
          <HookIdeaModeToggle
            disabled={
              generatingMore ||
              regeneratingAllHooks ||
              Boolean(regeneratingHookId)
            }
            dispatch={dispatch}
          />
          <button
            className="btn secondary small compass-angle-export-pdf"
            type="button"
            disabled={exportingAngles || state.directions.length === 0}
            onClick={() => void handleExportAngles()}
          >
            {exportingAngles ? <Spinner /> : null}
            {exportingAngles ? "Exporting…" : "Export PDF"}
          </button>
          <button
            className="btn secondary small compass-angle-regenerate-all"
            type="button"
            disabled={
              generatingMore ||
              regeneratingAllHooks ||
              Boolean(regeneratingHookId)
            }
            onClick={() => setRegeneratingAll(true)}
          >
            ↻ Regenerate hooks
          </button>
        </div>
      </div>
      {generateMoreError ? (
        <p className="repository-message error">{generateMoreError}</p>
      ) : null}
      {createError ? (
        <p className="repository-message error">{createError}</p>
      ) : null}
      {regenerateError ? (
        <p className="repository-message error">{regenerateError}</p>
      ) : null}
      {regenerateAllError ? (
        <p className="repository-message error">{regenerateAllError}</p>
      ) : null}
      {exportAnglesError ? (
        <p className="repository-message error">{exportAnglesError}</p>
      ) : null}
      <div className="compass-angle-groups">
        {angleGroups.map((group) => (
          <section className="compass-angle-group" key={group.service}>
            <header className="compass-angle-group-head">
              <div className="compass-angle-group-title">
                <span className="compass-angle-group-icon" aria-hidden="true">
                  {group.initials}
                </span>
                <div>
                  <h3>{group.title}</h3>
                  <p>
                    {group.required} needed · {group.description}
                  </p>
                </div>
              </div>
              <div className="compass-angle-group-head-actions">
                <div className="compass-angle-group-buttons">
                  <button
                    className="btn secondary small compass-angle-generate-ideas"
                    type="button"
                    disabled={generatingMore || regeneratingAllHooks}
                    onClick={() => generateMore(group.service)}
                  >
                    {generatingMoreService === group.service ? <Spinner /> : null}
                    {generatingMoreService === group.service
                      ? "Generating…"
                      : "Generate more ideas"}
                  </button>
                  <button
                    className="btn secondary small compass-angle-add-hook"
                    type="button"
                    disabled={generatingMore || regeneratingAllHooks}
                    onClick={() =>
                      setManualHookGroup({
                        service: group.service,
                        title: group.contentType
                      })
                    }
                  >
                    + Add hook manually
                  </button>
                </div>
                <span
                  className={`compass-angle-group-progress ${group.selected === group.required ? "complete" : ""}`}
                >
                  {group.selected}/{group.required} selected
                </span>
              </div>
            </header>
            <div className="direction-grid compass-angle-grid">
              {group.directions.map(({ direction, originalIndex }, groupIndex) => (
          <article
            className={`direction-card compass-angle-card ${direction.selected ? "selected" : ""}`}
            key={direction.id}
          >
            <button
              className="compass-angle-card-select-surface"
              type="button"
              aria-label={`${direction.selected ? "Deselect" : "Select"} Idea ${originalIndex + 1} card`}
              aria-pressed={direction.selected}
              onClick={() =>
                dispatch({ type: "toggle-direction", id: direction.id })
              }
            />
            <div className="compass-angle-card-top">
              <div>
                <div className="compass-angle-badge-row">
                  <span className="compass-angle-idea-pill">Idea {groupIndex + 1}</span>
                  <span className="compass-angle-format-pill">
                    {group.contentType}
                  </span>
                  {group.service === "album-post" ? (
                    <span className="compass-angle-format-pill">
                      {albumFormatLabel(
                        resolvedAlbumFormatForDirection(
                          state.albumFormat,
                          direction
                        )
                      )}
                    </span>
                  ) : null}
                </div>
                <p className="compass-angle-meta-line">
                  {direction.pillar || "Creative concept"}
                  <b>
                    {" · "}
                    {direction.objective ||
                      successMetricObjectives[state.successMetric]}
                  </b>
                </p>
              </div>
              <div className="compass-angle-top-actions">
                {direction.selected ? (
                  <span className="compass-angle-pick-tag">Your pick</span>
                ) : null}
                <button
                  className="compass-angle-edit"
                  type="button"
                  aria-label={`Edit Idea ${originalIndex + 1}`}
                  title="Edit hook"
                  disabled={regeneratingAllHooks}
                  onClick={() => setEditingDirectionId(direction.id)}
                >
                  <PencilSimple aria-hidden="true" size={16} weight="bold" />
                </button>
              </div>
            </div>
            {direction.manual ? (
              <span className="compass-angle-manual-note">Manually added</span>
            ) : null}
            <div className="compass-angle-hook-wrap">
              <span className="compass-angle-card-kicker">
                {angleHookLabel(group.service)}
              </span>
              <h3>{direction.hook}</h3>
            </div>
            <div className="compass-angle-copy-block">
              <span className="compass-angle-card-kicker">
                {angleSubheadlineLabel(group.service)}
              </span>
              <AngleSubheadline
                text={directionSubheadline(direction)}
                highlight={direction.subheadlineHighlight}
              />
            </div>
            {group.service !== "single-static" &&
            group.service !== "resize" &&
            direction.formatBeats?.length ? (
              <div className="compass-angle-copy-block compass-angle-format-beats">
                <span className="compass-angle-card-kicker">
                  {angleFormatBeatsLabel(group.service)}
                </span>
                <ol>
                  {direction.formatBeats.map((beat, beatIndex) => (
                    <li key={`${direction.id}-beat-${beatIndex}`}>
                      <span>{beatIndex + 1}</span>
                      <p>{beat}</p>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            <div className="compass-angle-copy-block compass-angle-concept-block">
              <span className="compass-angle-card-kicker">
                {angleConceptLabel(group.service)}
              </span>
              <p>{direction.concept}</p>
            </div>
            <div className="compass-angle-copy-block">
              <span className="compass-angle-card-kicker">CTA</span>
              <p className="compass-angle-cta-text">{direction.cta}</p>
            </div>
            <div className="compass-angle-card-foot">
              <span className="compass-angle-number-pill">
                <b>
                  {typeof direction.score === "number"
                    ? Math.round(direction.score)
                    : String(originalIndex + 1).padStart(2, "0")}
                </b>
                <small>{typeof direction.score === "number" ? "score" : "angle"}</small>
              </span>
              <div className="direction-card-actions">
                <button
                  className="btn secondary small"
                  type="button"
                  disabled={
                    regeneratingAllHooks || Boolean(regeneratingHookId)
                  }
                  onClick={() => setRegeneratingDirectionId(direction.id)}
                >
                  {regeneratingHookId === direction.id ? <Spinner /> : null}
                  {regeneratingHookId === direction.id
                    ? "Regenerating…"
                    : "Rewrite hook"}
                </button>
                <button
                  className="btn secondary small compass-angle-delete"
                  type="button"
                  disabled={
                    regeneratingAllHooks ||
                    Boolean(regeneratingHookId) ||
                    creating
                  }
                  onClick={() => handleDeleteDirection(direction.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          </article>
              ))}
            </div>
          </section>
        ))}
      </div>
      {editingDirection ? (
        <HookEditModal
          direction={editingDirection}
          onClose={() => setEditingDirectionId(null)}
          onSave={(direction) => {
            dispatch({
              type: "replace-direction",
              id: editingDirection.id,
              direction
            });
            setEditingDirectionId(null);
          }}
        />
      ) : null}
      {manualHookGroup ? (
        <ManualHookModal
          contentType={manualHookGroup.title}
          defaultObjective={successMetricObjectives[state.successMetric]}
          onClose={() => setManualHookGroup(null)}
          onAdd={(values) => {
            dispatch({
              type: "add-manual-direction",
              service: manualHookGroup.service,
              ...values
            });
            setManualHookGroup(null);
          }}
        />
      ) : null}
      {regeneratingDirection ? (
        <HookRegenerateModal
          direction={regeneratingDirection}
          loading={regeneratingHookId === regeneratingDirection.id}
          error={regenerateError}
          onClose={() => setRegeneratingDirectionId(null)}
          onRegenerate={async (tone) => {
            const succeeded = await regenerate(regeneratingDirection, tone);
            if (succeeded) setRegeneratingDirectionId(null);
          }}
        />
      ) : null}
      {regeneratingAll ? (
        <HookRegenerateAllModal
          count={state.directions.length}
          loading={regeneratingAllHooks}
          error={regenerateAllError}
          onClose={() => setRegeneratingAll(false)}
          onRegenerate={async (tone) => {
            const succeeded = await regenerateAll(tone);
            if (succeeded) setRegeneratingAll(false);
          }}
        />
      ) : null}
    </DecisionCard>
  );
}

function angleHookLabel(service: ServiceType): string {
  if (service === "album-post") return "Cover hook";
  if (service === "ugc-video") return "Opening hook";
  if (service === "motion-static") return "Opening frame";
  return "Hook";
}

function angleSubheadlineLabel(service: ServiceType): string {
  if (service === "album-post") return "Cover sub-headline";
  if (service === "ugc-video") return "Creator setup";
  if (service === "motion-static") return "Supporting line";
  return "Sub-headline";
}

function angleFormatBeatsLabel(service: ServiceType): string {
  if (service === "album-post") return "Inside slides · 3 supporting topics";
  if (service === "ugc-video") return "UGC video flow · 3 beats";
  return "Motion flow · 3 beats";
}

function angleConceptLabel(service: ServiceType): string {
  if (service === "album-post") return "Album concept";
  if (service === "ugc-video") return "UGC concept";
  if (service === "motion-static") return "Motion concept";
  return "Concept";
}

function AngleSubheadline({
  text,
  highlight
}: {
  text: string;
  highlight?: string;
}) {
  const cleanText = text.replace(/\s+/g, " ").trim();
  const resolvedHighlight = resolveSubheadlineHighlight(text, highlight);
  const highlightStart = cleanText.indexOf(resolvedHighlight);
  const before = cleanText.slice(0, highlightStart);
  const after = cleanText.slice(highlightStart + resolvedHighlight.length);

  return (
    <p>
      {before}
      <strong>{resolvedHighlight}</strong>
      {after}
    </p>
  );
}

function HookEditModal({
  direction,
  onClose,
  onSave
}: {
  direction: WorkflowState["directions"][number];
  onClose: () => void;
  onSave: (direction: WorkflowState["directions"][number]) => void;
}) {
  const [draft, setDraft] = useState({
    ...direction,
    subheadline: directionSubheadline(direction)
  });

  const update = (
    key:
      | "hook"
      | "subheadline"
      | "concept"
      | "why"
      | "visual"
      | "cta"
      | "caption",
    value: string
  ) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="output-modal-backdrop" onClick={onClose}>
      <div
        className="output-modal hook-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hook-edit-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="output-modal-head">
          <div>
            <p className="eyebrow">Edit hook</p>
            <h3 id="hook-edit-title">Update this creative direction</h3>
          </div>
          <button
            className="btn ghost"
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="hook-edit-fields">
          <label>
            <span>Hook</span>
            <textarea
              rows={3}
              value={draft.hook}
              onChange={(event) => update("hook", event.target.value)}
            />
          </label>
          <label>
            <span>Sub-headline</span>
            <textarea
              rows={2}
              value={draft.subheadline}
              onChange={(event) => update("subheadline", event.target.value)}
            />
          </label>
          <label>
            <span>Concept</span>
            <textarea
              rows={3}
              value={draft.concept}
              onChange={(event) => update("concept", event.target.value)}
            />
          </label>
          <label>
            <span>Why it might work</span>
            <textarea
              rows={3}
              value={draft.why}
              onChange={(event) => update("why", event.target.value)}
            />
          </label>
          <label>
            <span>Visual direction</span>
            <textarea
              rows={3}
              value={draft.visual}
              onChange={(event) => update("visual", event.target.value)}
            />
          </label>
          <label>
            <span>CTA</span>
            <input
              value={draft.cta}
              onChange={(event) => update("cta", event.target.value)}
            />
          </label>
          <label>
            <span>Supporting points (one per line)</span>
            <textarea
              rows={4}
              value={(draft.supportingPoints ?? []).join("\n")}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  supportingPoints: event.target.value
                    .split("\n")
                    .map((item) => item.trim())
                    .filter(Boolean)
                    .slice(0, 3)
                }))
              }
            />
          </label>
          {draft.service &&
          draft.service !== "single-static" &&
          draft.service !== "resize" ? (
            <label>
              <span>{angleFormatBeatsLabel(draft.service)} (one per line)</span>
              <textarea
                rows={4}
                value={(draft.formatBeats ?? []).join("\n")}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    formatBeats: event.target.value
                      .split("\n")
                      .map((item) => item.trim())
                      .filter(Boolean)
                      .slice(0, 3)
                  }))
                }
              />
            </label>
          ) : null}
          {draft.service === "album-post" ? (
            <label>
              <span>Album layout</span>
              <select
                value={draft.albumFormat ?? "three-horizontal"}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    albumFormat: event.target.value as AlbumFormat
                  }))
                }
              >
                {albumFormats.map((format) => (
                  <option key={format} value={format}>
                    {albumFormatLabel(format)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            <span>CTA action</span>
            <select
              value={draft.ctaActionType ?? "other"}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  ctaActionType: event.target.value as NonNullable<
                    typeof current.ctaActionType
                  >
                }))
              }
            >
              <option value="website">Website</option>
              <option value="line">LINE</option>
              <option value="phone">Phone</option>
              <option value="form">Form</option>
              <option value="inbox">Inbox</option>
              <option value="store">Store</option>
              <option value="other">Other / not verified</option>
            </select>
          </label>
          <label>
            <span>Verified CTA destination</span>
            <input
              value={draft.ctaDestination ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  ctaDestination: event.target.value
                }))
              }
            />
          </label>
          <label>
            <span>Verified contact / footer line</span>
            <input
              value={draft.contactLine ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  contactLine: event.target.value
                }))
              }
            />
          </label>
          <label>
            <span>Caption</span>
            <textarea
              rows={4}
              value={draft.caption}
              onChange={(event) => update("caption", event.target.value)}
            />
          </label>
        </div>
        <div className="output-modal-actions">
          <button className="btn secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={
              !draft.hook.trim() ||
              !draft.subheadline.trim() ||
              !draft.concept.trim()
            }
            onClick={() => onSave(draft)}
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

function ManualHookModal({
  contentType,
  defaultObjective,
  onClose,
  onAdd
}: {
  contentType: string;
  defaultObjective: string;
  onClose: () => void;
  onAdd: (values: {
    pillar: string;
    objective: string;
    hook: string;
    subheadline: string;
    cta: string;
  }) => void;
}) {
  const [pillar, setPillar] = useState("");
  const [objective, setObjective] = useState(defaultObjective);
  const [hook, setHook] = useState("");
  const [subheadline, setSubheadline] = useState("");
  const [cta, setCta] = useState("");
  const complete = Boolean(
    pillar.trim() && hook.trim() && subheadline.trim() && cta.trim()
  );

  return (
    <div className="output-modal-backdrop" onClick={onClose}>
      <div
        className="output-modal compass-manual-hook-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-hook-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="output-modal-head">
          <div>
            <p className="eyebrow">Manual hook</p>
            <h3 id="manual-hook-title">Add a {contentType} topic</h3>
          </div>
          <button className="btn ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="compass-manual-hook-form">
          <label className="compass-manual-hook-field">
            <span>Pillar</span>
            <input
              autoFocus
              value={pillar}
              placeholder="Example: Educational, pain point, product proof"
              onChange={(event) => setPillar(event.target.value)}
            />
          </label>
          <label className="compass-manual-hook-field">
            <span>Objective</span>
            <select
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
            >
              {[
                "Conversion",
                "Awareness",
                "Engagement",
                "Education",
                "Traffic",
                "Lead Generation",
                "Revenue",
                "Efficiency"
              ].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="compass-manual-hook-field full">
            <span>Hook</span>
            <textarea
              rows={3}
              value={hook}
              placeholder="Write the main hook. Keep it clear in one glance."
              onChange={(event) => setHook(event.target.value)}
            />
          </label>
          <label className="compass-manual-hook-field full">
            <span>Sub-headline</span>
            <textarea
              rows={3}
              value={subheadline}
              placeholder="Add the supporting message."
              onChange={(event) => setSubheadline(event.target.value)}
            />
          </label>
          <label className="compass-manual-hook-field full">
            <span>CTA</span>
            <input
              value={cta}
              placeholder="Example: Talk to our team for a free consultation"
              onChange={(event) => setCta(event.target.value)}
            />
          </label>
        </div>
        <div className="output-modal-actions">
          <button className="btn secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={!complete}
            onClick={() =>
              onAdd({ pillar, objective, hook, subheadline, cta })
            }
          >
            Add hook
          </button>
        </div>
      </div>
    </div>
  );
}

function HookRegenerateModal({
  direction,
  loading,
  error,
  onClose,
  onRegenerate
}: {
  direction: WorkflowState["directions"][number];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRegenerate: (feedback: string) => Promise<void>;
}) {
  const [feedback, setFeedback] = useState("");

  return (
    <div className="output-modal-backdrop" onClick={onClose}>
      <div
        className="output-modal hook-regenerate-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hook-regenerate-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="output-modal-head">
          <div>
            <p className="eyebrow">Rewrite hook</p>
            <h3 id="hook-regenerate-title">Rewrite this hook</h3>
          </div>
          <button
            className="btn ghost"
            type="button"
            disabled={loading}
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="hook-regenerate-original">
          <span>Current hook</span>
          <b>{direction.hook}</b>
        </div>
        <label className="output-modal-prompt-label">
          <span>What should change?</span>
          <textarea
            rows={4}
            value={feedback}
            disabled={loading}
            placeholder="Example: Make it shorter, more product-led, clearer, more emotional, or turn it into a curiosity question."
            onChange={(event) => setFeedback(event.target.value)}
          />
        </label>
        <p className="hook-regenerate-note">
          Only this hook will regenerate. The rest of the angle set will stay
          untouched.
        </p>
        {error ? <p className="repository-message error">{error}</p> : null}
        <div className="output-modal-actions">
          <button
            className="btn secondary"
            type="button"
            disabled={loading}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={loading || !feedback.trim()}
            onClick={() => void onRegenerate(feedback)}
          >
            {loading ? <Spinner /> : null}
            {loading ? "Regenerating…" : "Regenerate hook"}
          </button>
        </div>
      </div>
    </div>
  );
}

function HookRegenerateAllModal({
  count,
  loading,
  error,
  onClose,
  onRegenerate
}: {
  count: number;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRegenerate: (tone: string) => Promise<void>;
}) {
  const [tone, setTone] = useState("");

  return (
    <div className="output-modal-backdrop" onClick={onClose}>
      <div
        className="output-modal hook-regenerate-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hook-regenerate-all-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="output-modal-head">
          <div>
            <p className="eyebrow">Regenerate hooks</p>
            <h3 id="hook-regenerate-all-title">
              Change the tone across all {count} hooks
            </h3>
          </div>
          <button
            className="btn ghost"
            type="button"
            disabled={loading}
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <label className="output-modal-prompt-label">
          <span>New writing tone</span>
          <input
            value={tone}
            disabled={loading}
            placeholder="Example: sharper, playful, premium, more direct"
            onChange={(event) => setTone(event.target.value)}
          />
        </label>
        <p className="hook-regenerate-note">
          Creative Compass will keep each Hook's original strategy and selection, then
          rewrite every Hook and its supporting copy in this tone.
        </p>
        {error ? <p className="repository-message error">{error}</p> : null}
        <div className="output-modal-actions">
          <button
            className="btn secondary"
            type="button"
            disabled={loading}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={loading || !tone.trim()}
            onClick={() => void onRegenerate(tone)}
          >
            {loading ? <Spinner /> : null}
            {loading ? "Regenerating hooks…" : "↻ Regenerate hooks"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function StudioStage({
  state,
  dispatch,
  canEdit = true
}: StageProps & { canEdit?: boolean }) {
  const createCheckpoint = useOptionalWorkspace()?.createCheckpoint;
  const [sendingToQc, setSendingToQc] = useState(false);
  const [sendToQcError, setSendToQcError] = useState<string | null>(null);
  const [slidesImporting, setSlidesImporting] = useState(false);
  const [slidesError, setSlidesError] = useState<string | null>(null);
  const [googleSlidesUrl, setGoogleSlidesUrl] = useState<string | null>(null);
  const backAction: WorkflowAction = { type: "set-stage", stage: "directions" };
  const runQaBlocked = workflowActionBlockReason(state, {
    type: "run-qa",
    results: []
  });
  const approvalAction: WorkflowAction = {
    type: "set-stage",
    stage: "approval"
  };
  const approvalBlocked = workflowActionBlockReason(state, approvalAction);
  const { check, loading: checking, error: qaError } = useRunQualityCheck(
    state,
    dispatch
  );
  const {
    create: regenerateAllArtwork,
    loading: regeneratingAllArtwork,
    error: regenerateAllArtworkError,
    progress: regenerateAllArtworkProgress
  } = useCreateSelectedHooks(state, dispatch);
  const creativeCount = reviewCreativeCount(state.outputs);
  const slideCount = createStageClientSlideItems(state).length;
  const failedCount = reviewGuidedImprovementCount(state.outputs);
  const readyCount = state.qaComplete ? creativeCount - failedCount : 0;

  const handleRegenerateAllArtwork = () => {
    if (
      !window.confirm(
        "Regenerate every image in this creative set? Existing images stay in storage as earlier versions."
      )
    ) {
      return;
    }
    regenerateAllArtwork();
  };

  const handleOpenGoogleSlides = async () => {
    setSlidesImporting(true);
    setSlidesError(null);
    setGoogleSlidesUrl(null);
    try {
      const result = await openCreateStageSlidesInGoogleSlides(state);
      setGoogleSlidesUrl(result.url);
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setSlidesError(
        caught instanceof Error
          ? caught.message
          : "Could not import the deck to Google Slides. Please try again."
      );
    } finally {
      setSlidesImporting(false);
    }
  };

  const handleSendToQc = async () => {
    setSendingToQc(true);
    setSendToQcError(null);
    try {
      await createCheckpoint?.("send-to-qc", state.id);
      dispatch(approvalAction);
    } catch (caught) {
      setSendToQcError(
        caught instanceof Error
          ? caught.message
          : "Could not save a recovery point before Internal QC."
      );
    } finally {
      setSendingToQc(false);
    }
  };

  return (
    <DecisionCard
      eyebrow="04 / Build"
      title="Review the creative set."
      helper="Review the drafts, then send them directly to Internal QC. The automated quality check is optional."
      status={
        regeneratingAllArtwork
          ? regenerateAllArtworkProgress?.total
            ? `Generating ${regenerateAllArtworkProgress.completed}/${regenerateAllArtworkProgress.total}…`
            : "Preparing new artwork…"
          : checking
          ? "Checking quality…"
          : !state.qaComplete
            ? "Quality check optional"
            : failedCount
              ? `${readyCount} ready · ${failedCount} suggestion${failedCount === 1 ? "" : "s"}`
              : `${readyCount} / ${creativeCount} ready`
      }
      statusClass={state.qaComplete && !failedCount ? "green" : ""}
      className="compass-stage-build"
      actions={
        <>
          <button
            className="btn secondary"
            type="button"
            disabled={!canEdit}
            onClick={() => dispatch(backAction)}
          >
            ← Back to angles
          </button>
          <button
            className="btn secondary"
            type="button"
            disabled={
              !canEdit || regeneratingAllArtwork || checking || sendingToQc
            }
            onClick={handleRegenerateAllArtwork}
          >
            {regeneratingAllArtwork ? <Spinner /> : null}
            {regeneratingAllArtwork
              ? regenerateAllArtworkProgress?.total
                ? `Regenerating ${regenerateAllArtworkProgress.completed}/${regenerateAllArtworkProgress.total}…`
                : "Preparing…"
              : "↻ Regenerate all images"}
          </button>
          <button
            className="btn secondary"
            type="button"
            disabled={
              !slideCount ||
              slidesImporting ||
              regeneratingAllArtwork ||
              checking ||
              sendingToQc
            }
            title={
              slideCount
                ? `Create ${slideCount} creative slide${slideCount === 1 ? "" : "s"} in Google Slides`
                : "Generate artwork before creating Google Slides"
            }
            onClick={() => void handleOpenGoogleSlides()}
          >
            {slidesImporting ? <Spinner /> : null}
            {slidesImporting ? "Importing to Google…" : "Open in Google Slides"}
          </button>
          <button
            className="btn secondary"
            type="button"
            disabled={
              !canEdit ||
              regeneratingAllArtwork ||
              checking ||
              Boolean(runQaBlocked)
            }
            title={runQaBlocked ?? undefined}
            onClick={check}
          >
            {checking ? <Spinner /> : null}
            {checking
              ? "Checking…"
              : state.qaComplete
                ? "Check again (optional)"
                : "Quality check (optional)"}
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={
              !canEdit ||
              regeneratingAllArtwork ||
              sendingToQc ||
              Boolean(approvalBlocked)
            }
            title={approvalBlocked ?? undefined}
            onClick={() => void handleSendToQc()}
          >
            {sendingToQc ? "Saving recovery point…" : "Send to Internal QC →"}
          </button>
        </>
      }
    >
      <div className="create-stage-stack compass-build-stage-stack">
        <section className="compass-create-intro compass-build-intro">
          <div>
            <h3>Creative set · {state.brand?.name ?? "Selected brand"}</h3>
            <p>
              {!state.qaComplete
                ? "Review the hook, visual direction, and caption. You can send the drafts directly to Internal QC."
                : failedCount
                  ? `Quality check found ${failedCount} guided improvement${failedCount === 1 ? "" : "s"}.`
                  : "Every draft passed the automated quality check and is ready for Internal QC."}
            </p>
          </div>
          <span className="pill">
            {creativeCount} draft{creativeCount === 1 ? "" : "s"}
          </span>
        </section>
        {qaError ? <p className="repository-message error">{qaError}</p> : null}
        {regenerateAllArtworkError ? (
          <p className="repository-message error">{regenerateAllArtworkError}</p>
        ) : null}
        {sendToQcError ? (
          <p className="repository-message error">{sendToQcError}</p>
        ) : null}
        {slidesError ? (
          <p className="repository-message error">{slidesError}</p>
        ) : null}
        {googleSlidesUrl ? (
          <p className="repository-message success">
            Google Slides is ready. {" "}
            <a href={googleSlidesUrl} target="_blank" rel="noreferrer">
              Open the presentation
            </a>
          </p>
        ) : null}
        <OutputGrid state={state} dispatch={dispatch} canEdit={canEdit} />
        {state.qaComplete ? (
          <section className={`compass-build-qa-strip ${failedCount ? "needs" : "ready"}`}>
            <div>
              <b>
                {failedCount
                  ? `${failedCount} guided improvement${failedCount === 1 ? "" : "s"} to review.`
                  : "Quality check complete."}
              </b>
              <p>
                {failedCount
                  ? "You stay in control: use the suggestion, edit the copy, or keep the current version."
                  : "Hooks are clear, first frames are scannable, and each creative has a distinct testable hypothesis."}
              </p>
            </div>
            <span className={`pill ${failedCount ? "amber" : "green"}`}>
              {failedCount ? "Review suggestion" : "Ready for Internal QC"}
            </span>
          </section>
        ) : null}
      </div>
    </DecisionCard>
  );
}

function isUgcOutput(output: CreativeOutput): boolean {
  return output.format.toUpperCase().includes("UGC");
}

function qcContentTypeLabel(output: CreativeOutput): "Static" | "UGC" | "ALBUM" {
  if (isUgcOutput(output)) return "UGC";
  if (output.format.toLowerCase().includes("album")) return "ALBUM";
  return "Static";
}

function UgcTemplatePreview({
  direction,
  compact = false
}: {
  direction: WorkflowState["directions"][number] | undefined;
  compact?: boolean;
}) {
  return (
    <div className={`compass-ugc-template ${compact ? "compact" : ""}`}>
      <div className="compass-ugc-story" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <span className="compass-ugc-creator-dot" aria-hidden="true" />
      <div className="compass-ugc-copy">
        <small>Creator-led UGC</small>
        <b>{direction?.hook ?? "UGC hook"}</b>
        <p>{direction ? directionSubheadline(direction) : "Script direction"}</p>
        {direction?.formatBeats?.length ? (
          <ol>
            {direction.formatBeats.slice(0, 3).map((beat) => (
              <li key={beat}>{beat}</li>
            ))}
          </ol>
        ) : null}
        <span>{direction?.cta ?? "See how it works"}</span>
      </div>
    </div>
  );
}

function isAlbumOutput(output: CreativeOutput): boolean {
  return output.format.trim().toLowerCase() === "album post";
}

function albumPanelIndex(output: CreativeOutput): number {
  const match = output.id.match(/-album-(\d+)-v\d+$/i);
  return match ? Number(match[1]) - 1 : Number.MAX_SAFE_INTEGER;
}

function sortAlbumOutputs(
  outputs: readonly CreativeOutput[]
): readonly CreativeOutput[] {
  return [...outputs].sort(
    (left, right) => albumPanelIndex(left) - albumPanelIndex(right)
  );
}

function groupOutputsForReview(
  outputs: readonly CreativeOutput[]
): readonly (readonly CreativeOutput[])[] {
  if (!outputs.some(isAlbumOutput)) return outputs.map((output) => [output]);

  const albumGroups = new Map<string, CreativeOutput[]>();
  outputs.forEach((output) => {
    const group = albumGroups.get(output.directionId) ?? [];
    group.push(output);
    albumGroups.set(output.directionId, group);
  });
  return Array.from(albumGroups.values(), sortAlbumOutputs);
}

function reviewCreativeGroups(
  outputs: readonly CreativeOutput[]
): readonly (readonly CreativeOutput[])[] {
  const formatGroups = new Map<string, CreativeOutput[]>();
  outputs.forEach((output) => {
    const group = formatGroups.get(output.format) ?? [];
    group.push(output);
    formatGroups.set(output.format, group);
  });
  return Array.from(formatGroups.values()).flatMap((group) =>
    groupOutputsForReview(group)
  );
}

function outputNeedsGuidedImprovement(output: CreativeOutput): boolean {
  return (
    isBuildQualityCheckOutput(output) && output.status === "needs-revision"
  );
}

function reviewCreativeCount(outputs: readonly CreativeOutput[]): number {
  return reviewCreativeGroups(outputs).length;
}

function reviewGroupIsApprovedForRole(
  outputs: readonly CreativeOutput[],
  role: ApprovalRole
): boolean {
  return outputs.every((output) => output.approval[role] === "approved");
}

function reviewGroupIsWaitingForRole(
  outputs: readonly CreativeOutput[],
  role: ApprovalRole
): boolean {
  return outputs.some((output) => currentApprovalRole(output) === role);
}

function reviewGuidedImprovementCount(
  outputs: readonly CreativeOutput[]
): number {
  return reviewCreativeGroups(outputs).filter((group) =>
    group.some(outputNeedsGuidedImprovement)
  ).length;
}

function outputFormatSortRank(format: string): number {
  const normalized = format.trim().toLowerCase();
  if (normalized === "1:1 static") return 0;
  if (normalized === "album post") return 1;
  if (normalized === "9:16 ugc") return 2;
  return 3;
}

function outputSectionTitle(format: string): string {
  const normalized = format.trim().toLowerCase();
  if (normalized === "1:1 static") return "STATIC";
  if (normalized === "album post") return "ALBUM";
  if (normalized === "9:16 ugc") return "UGC VIDEO";
  return format;
}

function AlbumPanelPreview({
  outputs,
  direction,
  format,
  compact = false
}: {
  outputs: readonly CreativeOutput[];
  direction: WorkflowState["directions"][number] | undefined;
  format: AlbumFormat;
  compact?: boolean;
}) {
  const panels = sortAlbumOutputs(outputs).slice(
    0,
    albumFormatPanelCount(format)
  );
  const masterAssetUrl = panels.find(
    (output) => output.albumMasterAssetUrl
  )?.albumMasterAssetUrl;

  return (
    <div
      aria-label={`${panels.length}-image album preview`}
      className={`compass-album-panels format-${format} ${compact ? "compact" : ""}`}
    >
      {masterAssetUrl ? (
        <img
          className="compass-album-master-image"
          src={masterAssetUrl}
          alt={`${direction?.hook ?? "Album creative"} master grid`}
          loading="lazy"
          decoding="async"
        />
      ) : (
        panels.map((output, index) =>
          output.assetUrl ? (
          <div className="compass-album-panel" key={output.id}>
            <img
              src={output.assetUrl}
              alt={`${direction?.hook ?? "Album creative"} image ${index + 1}`}
              loading="lazy"
              decoding="async"
            />
          </div>
        ) : (
          <div
            className="compass-album-panel compass-album-panel-empty"
            key={output.id}
          >
            Image unavailable
          </div>
          )
        )
      )}
    </div>
  );
}

function resolvedAlbumFormatForDirection(
  preference: WorkflowState["albumFormat"],
  direction: WorkflowState["directions"][number] | undefined
): AlbumFormat {
  return resolveAlbumFormat(preference, direction?.albumFormat);
}

function OutputGrid({
  state,
  dispatch,
  canEdit = true
}: {
  state: WorkflowState;
  dispatch: Dispatch<WorkflowAction>;
  canEdit?: boolean;
}) {
  const [previewOutputId, setPreviewOutputId] = useState<string | null>(null);
  const [regenerateOutputId, setRegenerateOutputId] = useState<string | null>(
    null
  );
  const [qaPrompt, setQaPrompt] = useState<string | undefined>();
  const [editOutputId, setEditOutputId] = useState<string | null>(null);
  const previewOutput =
    state.outputs.find((output) => output.id === previewOutputId) ?? null;
  const previewDirection = previewOutput
    ? state.directions.find(
        (candidate) => candidate.id === previewOutput.directionId
      )
    : undefined;
  const previewOutputs = previewOutput
    ? isAlbumOutput(previewOutput)
      ? sortAlbumOutputs(
          state.outputs.filter(
            (output) =>
              isAlbumOutput(output) &&
              output.directionId === previewOutput.directionId
          )
        )
      : [previewOutput]
    : [];
  const regenerateOutput =
    state.outputs.find((output) => output.id === regenerateOutputId) ?? null;
  const regenerateDirection = regenerateOutput
    ? state.directions.find(
        (candidate) => candidate.id === regenerateOutput.directionId
      )
    : undefined;
  const regenerateOutputs = regenerateOutput
    ? isAlbumOutput(regenerateOutput)
      ? sortAlbumOutputs(
          state.outputs.filter(
            (output) =>
              isAlbumOutput(output) &&
              output.directionId === regenerateOutput.directionId
          )
        )
      : [regenerateOutput]
    : [];
  const editOutput = state.outputs.find((output) => output.id === editOutputId);
  const editDirection = state.directions.find(
    (direction) => direction.id === editOutput?.directionId
  );
  const outputGroups = Array.from(
    state.outputs.reduce((groups, output) => {
      const group = groups.get(output.format) ?? [];
      group.push(output);
      groups.set(output.format, group);
      return groups;
    }, new Map<string, CreativeOutput[]>())
  ).sort(
    ([leftFormat], [rightFormat]) =>
      outputFormatSortRank(leftFormat) - outputFormatSortRank(rightFormat)
  );

  if (!state.outputs.length) {
    return (
      <div className="empty">
        <b>No outputs yet.</b>
        <p>Select hooks first.</p>
      </div>
    );
  }

  return (
    <>
      <div className="build-sections">
        {outputGroups.map(([format, outputs]) => {
          const reviewGroups = groupOutputsForReview(outputs);
          return (
          <section className="build-type-section" key={format}>
            <div className="build-section-head">
              <span className="compass-type-icon" aria-hidden="true">
                {format.includes("UGC") ? "UG" : "AD"}
              </span>
              <div>
                <h3>{outputSectionTitle(format)}</h3>
                <p>Review artwork, angle, and caption together.</p>
              </div>
              <strong>{reviewGroups.length}</strong>
            </div>
            <div className="output-grid">
              {reviewGroups.map((reviewOutputs, reviewIndex) => {
                const output = reviewOutputs[0];
                if (!output) return null;
                const album = isAlbumOutput(output);
                const index = state.outputs.indexOf(output);
                const direction = state.directions.find(
                  (candidate) => candidate.id === output.directionId
                );
                const guidedOutput = reviewOutputs.find(
                  outputNeedsGuidedImprovement
                );
                const hasGuidedImprovement = Boolean(guidedOutput);
                const qualityOutput = guidedOutput ?? output;
                const qaReport = isBuildQualityCheckOutput(output)
                  ? qualityOutput.qaReport
                  : undefined;
                const qaSuggestion = qaReport?.suggestion;
                return (
                  <article
                    className={`output-card compass-build-review-card ${qaReport && !hasGuidedImprovement ? "ready qa-passed" : ""} ${qaReport && hasGuidedImprovement ? "attn qa-attention" : ""}`}
                    key={output.id}
                  >
                    <header className="compass-build-card-head">
                      <div>
                        <b>Creative {index + 1}</b>
                        <small>
                          {album
                            ? `${reviewOutputs.length}-image album execution`
                            : `${output.format} execution`}
                        </small>
                      </div>
                      <span
                        className={`pill ${qaReport && !hasGuidedImprovement ? "green" : hasGuidedImprovement ? "amber" : ""}`}
                      >
                        {qaReport && hasGuidedImprovement
                          ? "1 suggestion"
                          : qaReport ? "Ready"
                            : "AI draft"}
                      </span>
                    </header>
                    <div className="compass-build-asset-pair">
                      <button
                        className="preview-area compass-build-preview"
                        type="button"
                        aria-label={
                          album
                            ? `Open album creative ${reviewIndex + 1} preview`
                            : `Open Creative ${index + 1} preview`
                        }
                        onClick={() => setPreviewOutputId(output.id)}
                      >
                        {album ? (
                          <AlbumPanelPreview
                            outputs={reviewOutputs}
                            direction={direction}
                            format={resolvedAlbumFormatForDirection(
                              state.albumFormat,
                              direction
                            )}
                            compact
                          />
                        ) : isUgcOutput(output) ? (
                          <UgcTemplatePreview direction={direction} />
                        ) : output.assetUrl ? (
                          <img
                            className="generated-preview"
                            src={output.assetUrl}
                            alt={direction?.hook ?? `Creative ${index + 1}`}
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <div className="static-preview">
                            <span className="static-mark" />
                            <div className="static-copy">
                              <h3>{direction?.hook}</h3>
                              <p>
                                {direction
                                  ? directionSubheadline(direction)
                                  : null}
                              </p>
                              <span>Learn more</span>
                            </div>
                          </div>
                        )}
                      </button>
                      {direction ? (
                        <BuildCaptionEditor
                          output={output}
                          direction={direction}
                          dispatch={dispatch}
                          canEdit={canEdit}
                        />
                      ) : null}
                    </div>
                    {qaReport &&
                    hasGuidedImprovement &&
                    qualityOutput.qaNote ? (
                      <div className="compass-build-qa needs">
                        <div className="compass-build-qa-head">
                          <span aria-hidden="true">
                            <Sparkle size={17} weight="fill" />
                          </span>
                          <div>
                            <small>
                              {qaReport.agentName || CREATIVE_STRATEGIST_AGENT_NAME}
                            </small>
                            <b>{qaSuggestion?.title || "Refine this draft"}</b>
                          </div>
                          <strong>{qaReport.score}</strong>
                        </div>
                        <QualityActionSummary
                          text={qaSuggestion?.detail || qualityOutput.qaNote}
                        />
                        {qaReport ? (
                          <QualityReportDetails report={qaReport} />
                        ) : null}
                        {qaSuggestion?.suggestedHook ? (
                          <div className="compass-build-qa-suggestion">
                            <small>Suggested hook</small>
                            <b>{qaSuggestion.suggestedHook}</b>
                          </div>
                        ) : null}
                      </div>
                    ) : qaReport && !hasGuidedImprovement ? (
                      <div className="compass-build-qa passed">
                        <div>
                          <small>
                            {qaReport.agentName || CREATIVE_STRATEGIST_AGENT_NAME}
                          </small>
                          <b>{qaReport.summary}</b>
                        </div>
                        <strong>{qaReport.score}</strong>
                        <QualityReportDetails report={qaReport} />
                      </div>
                    ) : null}
                    <footer className="compass-build-output-foot">
                      {hasGuidedImprovement ? (
                        <>
                          <button
                            className="btn primary small"
                            type="button"
                            disabled={!canEdit}
                            onClick={() => {
                              if (isUgcOutput(output)) {
                                setEditOutputId(output.id);
                              } else {
                                setQaPrompt(
                                  qaReport
                                    ? buildQualityRegenerationInstructions(qaReport)
                                    : output.qaNote
                                );
                                setRegenerateOutputId(output.id);
                              }
                            }}
                          >
                            Use suggestion
                          </button>
                          <button
                            className="btn ghost small"
                            type="button"
                            disabled={!canEdit}
                            onClick={() =>
                              reviewOutputs
                                .filter(outputNeedsGuidedImprovement)
                                .forEach((item) =>
                                  dispatch({
                                    type: "resolve-qa-output",
                                    id: item.id
                                  })
                                )
                            }
                          >
                            Keep current
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="btn secondary small"
                            type="button"
                            disabled={!canEdit}
                            onClick={() => setRegenerateOutputId(output.id)}
                          >
                            {album ? "Regenerate album" : "Regenerate draft"}
                          </button>
                          <button
                            className="btn ghost small"
                            type="button"
                            disabled={
                              !canEdit ||
                              reviewOutputs.every(
                                (item) => item.savedToReferences
                              )
                            }
                            onClick={() =>
                              reviewOutputs.forEach((item) =>
                                dispatch({
                                  type: "save-output-reference",
                                  id: item.id
                                })
                              )
                            }
                          >
                            {reviewOutputs.every(
                              (item) => item.savedToReferences
                            )
                              ? album
                                ? "Album saved"
                                : "Reference saved"
                              : album
                                ? "Save album"
                                : "Save reference"}
                          </button>
                        </>
                      )}
                    </footer>
                  </article>
                );
              })}
            </div>
          </section>
          );
        })}
      </div>
      {previewOutput ? (
        <CreativePreviewModal
          output={previewOutput}
          outputs={previewOutputs}
          direction={previewDirection}
          index={state.outputs.indexOf(previewOutput)}
          albumFormat={resolvedAlbumFormatForDirection(
            state.albumFormat,
            previewDirection
          )}
          onClose={() => setPreviewOutputId(null)}
        />
      ) : null}
      {regenerateOutput ? (
        <OutputRegenerateModal
          run={state}
          output={regenerateOutput}
          outputs={regenerateOutputs}
          direction={regenerateDirection}
          dispatch={dispatch}
          initialPrompt={qaPrompt}
          onClose={() => {
            setRegenerateOutputId(null);
            setQaPrompt(undefined);
          }}
        />
      ) : null}
      {editOutput && editDirection ? (
        <CreativeCopyEditModal
          output={editOutput}
          direction={editDirection}
          dispatch={dispatch}
          resolveQa
          onClose={() => setEditOutputId(null)}
        />
      ) : null}
    </>
  );
}

function BuildCaptionEditor({
  output,
  direction,
  dispatch,
  canEdit = true
}: {
  output: CreativeOutput;
  direction: WorkflowState["directions"][number];
  dispatch: Dispatch<WorkflowAction>;
  canEdit?: boolean;
}) {
  const [caption, setCaption] = useState(direction.caption);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setCaption(direction.caption);
  }, [direction.caption]);

  function saveCaption() {
    const nextCaption = caption.trim();
    if (!nextCaption) return;
    dispatch({
      type: "edit-output-direction",
      id: output.id,
      hook: direction.hook,
      caption: nextCaption,
      formatBeats: direction.formatBeats ?? []
    });
    setSaved(true);
  }

  return (
    <div className="compass-build-caption">
      <label htmlFor={`build-caption-${output.id}`}>
        {isUgcOutput(output) ? "Script direction" : "Caption"}
      </label>
      <textarea
        id={`build-caption-${output.id}`}
        aria-label={isUgcOutput(output) ? "Edit script direction" : "Edit caption"}
        value={caption}
        disabled={!canEdit}
        onChange={(event) => {
          setCaption(event.target.value);
          setSaved(false);
        }}
      />
      <div className="compass-build-caption-actions">
        <span aria-live="polite">{saved ? "Saved" : ""}</span>
        <button
          className="btn primary small"
          type="button"
          disabled={!canEdit || !caption.trim() || saved}
          onClick={saveCaption}
        >
          {saved ? "Saved" : "Save"}
        </button>
      </div>
    </div>
  );
}

function QualityReportDetails({ report }: { report: CreativeQualityReport }) {
  const priorityIssues = [...report.gd.criteria, ...report.cs.criteria]
    .filter((criterion) => !criterion.passed)
    .sort((left, right) => left.score - right.score)
    .slice(0, 3);

  if (!priorityIssues.length) return null;

  return (
    <div className="compass-build-qa-details">
      <details>
        <summary>
          View {priorityIssues.length} priority issue
          {priorityIssues.length === 1 ? "" : "s"}
        </summary>
        <ul>
          {priorityIssues.map((criterion) => (
            <li key={criterion.criterion}>
              <span aria-hidden="true">!</span>
              <div>
                <b>{criterion.criterion}</b>
                <p>{criterion.suggestion || criterion.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function QualityActionSummary({ text }: { text: string }) {
  const items = text
    .split(/\n+/)
    .map((item) => item.trim().replace(/^\d+[.)]\s*/, ""))
    .filter(Boolean)
    .slice(0, 3);

  if (!items.length) return null;

  return (
    <ol className="compass-build-qa-actions-summary">
      {items.map((item, index) => (
        <li key={`${index}-${item}`}>{item}</li>
      ))}
    </ol>
  );
}

function CreativePreviewModal({
  output,
  outputs,
  direction,
  index,
  albumFormat,
  onClose
}: {
  output: CreativeOutput;
  outputs: readonly CreativeOutput[];
  direction: WorkflowState["directions"][number] | undefined;
  index: number;
  albumFormat: AlbumFormat;
  onClose: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const album = isAlbumOutput(output);
  const title = album
    ? "Album creative preview"
    : `Creative ${index + 1} preview`;

  return (
    <div className="output-modal-backdrop" onClick={onClose}>
      <div
        aria-labelledby="build-image-preview-title"
        aria-modal="true"
        className={`output-modal compass-build-image-modal ${album ? "compass-album-preview-modal" : ""}`}
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="output-modal-head">
          <div>
            <p className="eyebrow">Creative preview</p>
            <h3 id="build-image-preview-title">{title}</h3>
          </div>
          <button className="btn secondary" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="output-modal-image">
          {album ? (
            <AlbumPanelPreview
              outputs={outputs}
              direction={direction}
              format={albumFormat}
            />
          ) : isUgcOutput(output) ? (
            <UgcTemplatePreview direction={direction} />
          ) : output.assetUrl ? (
            <img src={output.assetUrl} alt={direction?.hook ?? title} />
          ) : (
            <div className="static-preview">
              <span className="static-mark" />
              <div className="static-copy">
                <h3>{direction?.hook}</h3>
                <p>{direction ? directionSubheadline(direction) : null}</p>
                <span>Learn more</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OutputRegenerateModal({
  run,
  output,
  outputs,
  direction,
  dispatch,
  onClose,
  initialPrompt
}: {
  run: WorkflowState;
  output: CreativeOutput;
  outputs: readonly CreativeOutput[];
  direction: WorkflowState["directions"][number] | undefined;
  dispatch: Dispatch<WorkflowAction>;
  onClose: () => void;
  initialPrompt?: string;
}) {
  const createCheckpoint = useOptionalWorkspace()?.createCheckpoint;
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [phase, setPhase] = useState<"idle" | "regenerating" | "checking">(
    "idle"
  );
  const [replacementApplied, setReplacementApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const album = isAlbumOutput(output);
  const busy = phase !== "idle";

  const handleRegenerate = async () => {
    if (!direction) {
      setError("Missing hook details for this creative.");
      return;
    }

    setPhase("regenerating");
    setError(null);
    let imageReplaced = false;

    try {
      const updatedOutputs = album
        ? await regenerateOutputImages({
            run,
            direction,
            extraInstructions: prompt
          })
        : [
            await reviseOutputImage({
              run,
              output,
              instructions: prompt
            })
          ];
      const orderedUpdated = album
        ? sortAlbumOutputs(updatedOutputs)
        : updatedOutputs;
      if (album && orderedUpdated.length < outputs.length) {
        throw new Error("Album regeneration did not return every panel.");
      }
      const replacements = outputs.map((currentOutput, index) => {
        const updated = orderedUpdated[index];
        const assetUrl = updated?.assetUrl;
        if (!updated || !assetUrl) {
          throw new Error("Regeneration did not return an image.");
        }
        return {
          currentOutput,
          updated: { ...updated, assetUrl }
        };
      });
      await createCheckpoint?.("regenerate", run.id);
      replacements.forEach(({ currentOutput, updated }) => {
        dispatch({
          type: "replace-output-asset",
          id: currentOutput.id,
          assetUrl: updated.assetUrl,
          ...(updated.assetStoragePath
            ? { assetStoragePath: updated.assetStoragePath }
            : {}),
          ...(updated.assetBucket ? { assetBucket: updated.assetBucket } : {})
        });
      });
      setReplacementApplied(true);
      imageReplaced = true;
      setPhase("checking");

      const replacementById = new Map(
        replacements.map(({ currentOutput, updated }) => [
          currentOutput.id,
          updated
        ])
      );
      const nextOutputs = run.outputs.map((currentOutput) => {
        const updated = replacementById.get(currentOutput.id);
        if (!updated?.assetUrl) return currentOutput;
        return {
          ...currentOutput,
          assetUrl: updated.assetUrl,
          ...(updated.assetStoragePath
            ? { assetStoragePath: updated.assetStoragePath }
            : {}),
          ...(updated.assetBucket ? { assetBucket: updated.assetBucket } : {}),
          status: "draft" as const,
          qaNote: undefined,
          qaReport: undefined
        };
      });
      const qaResults = await runQualityCheck(
        { ...run, outputs: nextOutputs, qaComplete: false },
        replacements.map(({ currentOutput }) => currentOutput.id)
      );
      dispatch({ type: "run-qa", results: qaResults });
      setPrompt("");
      playGenerationSuccessSound();
      onClose();
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Could not regenerate image.";
      setError(
        imageReplaced
          ? `Image regenerated, but the optional quality check failed: ${message} You can retry it from Build or continue to Internal QC.`
          : message
      );
    } finally {
      setPhase("idle");
    }
  };

  return (
    <div
      className="output-modal-backdrop"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="output-modal"
        role="dialog"
        aria-modal="true"
        aria-label={album ? "Regenerate album" : "Regenerate creative"}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="output-modal-head">
          <div>
            <p className="eyebrow">Creative preview</p>
            <h3>{direction?.hook ?? "Creative"}</h3>
          </div>
          <button
            className="btn ghost"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="output-modal-image">
          {album ? (
            <AlbumPanelPreview
              outputs={outputs}
              direction={direction}
              format={resolvedAlbumFormatForDirection(
                run.albumFormat,
                direction
              )}
            />
          ) : isUgcOutput(output) ? (
            <UgcTemplatePreview direction={direction} />
          ) : output.assetUrl ? (
            <img src={output.assetUrl} alt={direction?.hook ?? "Creative preview"} />
          ) : (
            <div className="static-preview">
              <span className="static-mark" />
              <div className="static-copy">
                <h3>{direction?.hook}</h3>
                <p>{direction ? directionSubheadline(direction) : null}</p>
                <span>Learn more</span>
              </div>
            </div>
          )}
        </div>
        <label className="output-modal-prompt-label">
          <span>
            {album
              ? "Regeneration instructions (optional)"
              : "Revision instructions"}
          </span>
          <textarea
            value={prompt}
            disabled={busy || replacementApplied}
            placeholder="Example: Make the background lighter, remove the text overlay, zoom in on the product."
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <p className="output-modal-reference-note">
          {album
            ? `${artworkModeLabel(run.artworkMode)} mode · album regeneration uses the selected brief and references.`
            : "Art Director enhancement · uses the current artwork and these directions to improve the full composition with GPT Image 2."}
        </p>
        {error ? <p className="repository-message error">{error}</p> : null}
        <div className="output-modal-actions">
          <button
            className="btn secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={busy || replacementApplied || (!album && !prompt.trim())}
            onClick={() => void handleRegenerate()}
          >
            {busy ? <Spinner /> : null}
            {phase === "checking"
              ? "Checking quality..."
              : phase === "regenerating"
                ? "Regenerating..."
                : replacementApplied
                  ? "Image regenerated"
                  : initialPrompt
                    ? "Apply suggestion"
                    : album
                      ? "Regenerate album"
                      : "Regenerate image"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OutputCaptionText({
  caption,
  scrollable = false
}: {
  caption: string | undefined;
  scrollable?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!caption) return null;

  if (scrollable) {
    return (
      <p className="compass-caption-scroll" tabIndex={0}>
        {caption}
      </p>
    );
  }

  return (
    <>
      <p className={expanded ? "expanded" : ""}>{caption}</p>
      {caption.length > CAPTION_CLAMP_THRESHOLD ? (
        <button
          className="fb-see-more"
          type="button"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "See less" : "See more"}
        </button>
      ) : null}
    </>
  );
}

function CreativeCopyEditModal({
  output,
  direction,
  dispatch,
  onClose,
  resolveQa = false
}: {
  output: CreativeOutput;
  direction: WorkflowState["directions"][number];
  dispatch: Dispatch<WorkflowAction>;
  onClose: () => void;
  resolveQa?: boolean;
}) {
  const ugc = isUgcOutput(output);
  const [hook, setHook] = useState(direction.hook);
  const [caption, setCaption] = useState(direction.caption ?? "");
  const [beats, setBeats] = useState((direction.formatBeats ?? []).join("\n"));

  function save() {
    dispatch({
      type: "edit-output-direction",
      id: output.id,
      hook,
      caption,
      formatBeats: beats.split("\n")
    });
    if (resolveQa) dispatch({ type: "resolve-qa-output", id: output.id });
    onClose();
  }

  return (
    <div className="output-modal-backdrop" onClick={onClose}>
      <div
        className="output-modal compass-copy-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-label={ugc ? "Edit UGC script and flow" : "Edit creative copy"}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="output-modal-head">
          <div>
            <p className="eyebrow">{ugc ? "UGC template" : "Creative copy"}</p>
            <h3>{ugc ? "Edit script & flow" : "Edit copy"}</h3>
          </div>
          <button className="btn ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="output-modal-reference-note">
          {ugc
            ? "Update the text placed in the 9:16 phone template. No image generation is used."
            : "Update the hook and caption without leaving Internal QC."}
        </p>
        <label className="output-modal-prompt-label">
          <span>Hook</span>
          <textarea rows={2} value={hook} onChange={(event) => setHook(event.target.value)} />
        </label>
        <label className="output-modal-prompt-label">
          <span>{ugc ? "Script direction" : "Caption"}</span>
          <textarea rows={5} value={caption} onChange={(event) => setCaption(event.target.value)} />
        </label>
        {ugc ? (
          <label className="output-modal-prompt-label">
            <span>Scene / creator flow · one beat per line</span>
            <textarea rows={4} value={beats} onChange={(event) => setBeats(event.target.value)} />
          </label>
        ) : null}
        <div className="output-modal-actions">
          <button className="btn secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="button" onClick={save}>
            Save {ugc ? "UGC update" : "copy"}
          </button>
        </div>
      </div>
    </div>
  );
}

const CAPTION_CLAMP_THRESHOLD = 220;

const REVIEW_ROLES: readonly {
  key: ApprovalRole;
  label: string;
  summary: string;
  checklist: readonly string[];
}[] = [
  {
    key: "graphicDesign",
    label: "GD Review",
    summary: "Visual quality, finish, and brand accuracy",
    checklist: GD_QUALITY_CHECKLIST
  },
  {
    key: "clientService",
    label: "CS Review",
    summary: "Message, caption, details, and client context",
    checklist: CS_QUALITY_CHECKLIST
  },
  {
    key: "projectManager",
    label: "PM Review",
    summary: "Client fit, brief match, and final readiness",
    checklist: ["Client fit", "Brief match", "Final readiness"]
  }
];

function reviewRoleShort(role: ApprovalRole): string {
  if (role === "graphicDesign") return "GD";
  if (role === "clientService") return "CS";
  return "PM";
}

function reviewRoleGuide(role: ApprovalRole): string {
  if (role === "graphicDesign") {
    return "Review artwork quality, layout, hierarchy, and final-file readiness. UGC starts with CS.";
  }
  if (role === "clientService") {
    return "Review the Hook, message, caption, and visual as one clear performance idea.";
  }
  return "Confirm the brief, requested scope, approval history, and client readiness.";
}

function outputIsEligibleForRole(
  output: CreativeOutput,
  role: ApprovalRole
): boolean {
  return approvalRolesForOutput(output).includes(role);
}

export function ApprovalStage({
  state,
  dispatch,
  canEdit = true
}: StageProps & { canEdit?: boolean }) {
  const backAction: WorkflowAction = { type: "set-stage", stage: "studio" };
  const clientAction: WorkflowAction = { type: "set-stage", stage: "client" };
  const clientBlocked = workflowActionBlockReason(state, clientAction);
  const [activeRole, setActiveRole] = useState<ApprovalRole>(() => {
    const revisionOutput = state.outputs.find(
      (output) => output.clientStatus === "revision"
    );
    return revisionOutput
      ? currentApprovalRole(revisionOutput) ?? "graphicDesign"
      : "graphicDesign";
  });
  const [clientSlidesImporting, setClientSlidesImporting] = useState(false);
  const [clientSlidesError, setClientSlidesError] = useState<string | null>(null);
  const [clientGoogleSlidesUrl, setClientGoogleSlidesUrl] = useState<string | null>(
    null
  );
  const reviewGroups = reviewCreativeGroups(state.outputs);
  const totalChecks = reviewGroups.reduce(
    (total, outputs) =>
      total + approvalRolesForOutput(outputs[0]!).length,
    0
  );
  const approvedChecks = reviewGroups.reduce(
    (total, output) =>
      total +
      approvalRolesForOutput(output[0]!).filter((role) =>
        reviewGroupIsApprovedForRole(output, role)
      ).length,
    0
  );
  const readyAssets = pmApprovedClientSlideItems(state).length;
  const totalClientCreatives = reviewCreativeCount(state.outputs);
  const activeRoleConfig =
    REVIEW_ROLES.find(({ key }) => key === activeRole) ?? REVIEW_ROLES[0]!;
  const activeRoleGroups = reviewGroups.filter((outputs) =>
    reviewGroupIsWaitingForRole(outputs, activeRole)
  );
  const activeRoleApproved = reviewGroups.filter(
    (outputs) =>
      outputIsEligibleForRole(outputs[0]!, activeRole) &&
      reviewGroupIsApprovedForRole(outputs, activeRole)
  ).length;
  const activeRoleWaiting = activeRoleGroups.length;
  const activeRoleIndex = REVIEW_ROLES.findIndex(({ key }) => key === activeRole);
  const nextRole = REVIEW_ROLES[activeRoleIndex + 1];
  const approveRoleAction: WorkflowAction = {
    type: "approve-role",
    role: activeRole
  };
  const approveRoleBlocked = workflowActionBlockReason(state, approveRoleAction);

  async function openClientSlidesInGoogle() {
    setClientSlidesImporting(true);
    setClientSlidesError(null);
    setClientGoogleSlidesUrl(null);
    try {
      const result = await openPmApprovedClientSlidesInGoogleSlides(state);
      setClientGoogleSlidesUrl(result.url);
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setClientSlidesError(
        error instanceof Error
          ? error.message
          : "Could not import the client deck to Google Slides. Please try again."
      );
    } finally {
      setClientSlidesImporting(false);
    }
  }

  return (
    <DecisionCard
      eyebrow="05 / Internal QC"
      title="Pass it through the team."
      helper="GD, CS, and PM each pick up only the work they own. Revisions stay inside Internal QC, with the full context attached to the asset."
      status={state.approved ? "Approved" : "Waiting"}
      statusClass={state.approved ? "green" : "blue"}
      className="compass-stage-qc"
      actions={
        <>
          <button
            className="btn secondary"
            type="button"
            onClick={() => dispatch(backAction)}
          >
            ← Back to Build
          </button>
          <button
            className="btn secondary"
            type="button"
            disabled={!canEdit || Boolean(approveRoleBlocked)}
            title={approveRoleBlocked ?? undefined}
            onClick={() => dispatch(approveRoleAction)}
          >
            Approve all · {activeRoleGroups.length}
          </button>
          {nextRole ? (
            <button
              className="btn primary"
              type="button"
              disabled={Boolean(activeRoleGroups.length)}
              title={
                activeRoleGroups.length
                  ? `Approve the remaining ${reviewRoleShort(activeRole)} creatives first.`
                  : undefined
              }
              onClick={() => setActiveRole(nextRole.key)}
            >
              Open {nextRole.label}
            </button>
          ) : (
            <button
              className="btn primary"
              type="button"
              disabled={Boolean(clientBlocked)}
              title={clientBlocked ?? undefined}
              onClick={() => dispatch(clientAction)}
            >
              Open Client Review
            </button>
          )}
        </>
      }
    >
      {state.outputs.length ? (
        <div className="compass-qc-workspace">
            <aside className="compass-qc-progress-rail">
              <span className="compass-context-label">Internal QC</span>
              <h3>Review progress</h3>
              <p>Track each role's queue before client review.</p>
              <div className="compass-qc-overall">
                <div>
                  <b>
                    {totalChecks
                      ? Math.round((approvedChecks / totalChecks) * 100)
                      : 0}
                    %
                  </b>
                  <span>
                    {approvedChecks}/{totalChecks} approvals
                  </span>
                </div>
                <div
                  className="compass-qc-progress-track"
                  role="progressbar"
                  aria-label="Internal QC progress"
                  aria-valuemin={0}
                  aria-valuemax={totalChecks}
                  aria-valuenow={approvedChecks}
                >
                  <span
                    style={{
                      width: `${totalChecks ? (approvedChecks / totalChecks) * 100 : 0}%`
                    }}
                  />
                </div>
              </div>
              <div className="compass-qc-role-list">
                {REVIEW_ROLES.map(({ key, label }) => {
                  const eligible = reviewGroups.filter((outputs) =>
                    outputIsEligibleForRole(outputs[0]!, key)
                  );
                  const approvedForRole = eligible.filter((outputs) =>
                    reviewGroupIsApprovedForRole(outputs, key)
                  ).length;
                  const waitingForRole = reviewGroups.filter((outputs) =>
                    reviewGroupIsWaitingForRole(outputs, key)
                  ).length;
                  return (
                    <div className="compass-qc-role-progress" key={key}>
                      <span className={reviewRoleShort(key).toLowerCase()}>
                        {reviewRoleShort(key)}
                      </span>
                      <div>
                        <b>{label}</b>
                        <small>
                          {waitingForRole
                            ? `${waitingForRole} waiting`
                            : "Queue clear"}
                        </small>
                      </div>
                      <strong>
                        {approvedForRole}/{eligible.length}
                      </strong>
                    </div>
                  );
                })}
              </div>
              <div className="compass-qc-client-ready">
                <b>
                  {readyAssets}/{totalClientCreatives} client-ready
                </b>
                <span>PM-approved assets unlock in Client review.</span>
              </div>
            </aside>
            <div className="compass-qc-main">
              <section className="compass-qc-role-focus">
                <div
                  className="compass-qc-role-tabs"
                  role="tablist"
                  aria-label="Internal review roles"
                >
                  {REVIEW_ROLES.map(({ key, label, summary }) => {
                    const eligible = reviewGroups.filter((outputs) =>
                      outputIsEligibleForRole(outputs[0]!, key)
                    );
                    const roleQueue = reviewGroups.filter((outputs) =>
                      reviewGroupIsWaitingForRole(outputs, key)
                    );
                    const rejected = roleQueue.filter((outputs) =>
                      outputs.some(
                        (output) => output.approval[key] === "rejected"
                      )
                    ).length;
                    const approvedForRole = eligible.filter((outputs) =>
                      reviewGroupIsApprovedForRole(outputs, key)
                    ).length;
                    const waiting = roleQueue.length;
                    return (
                      <button
                        className={`compass-qc-role-tab ${key === activeRole ? "active" : ""} ${rejected ? "attention" : approvedForRole === eligible.length ? "complete" : ""}`}
                        type="button"
                        role="tab"
                        aria-selected={key === activeRole}
                        onClick={() => setActiveRole(key)}
                        key={key}
                      >
                        <span className={reviewRoleShort(key).toLowerCase()}>
                          {reviewRoleShort(key)}
                        </span>
                        <div>
                          <b>{label}</b>
                          <small>{summary}</small>
                        </div>
                        <strong>{waiting}</strong>
                      </button>
                    );
                  })}
                </div>
                <div className="compass-qc-role-guide">
                  <span
                    className={`compass-qc-role-character ${reviewRoleShort(activeRole).toLowerCase()}`}
                    aria-hidden="true"
                  >
                    {reviewRoleShort(activeRole)}
                  </span>
                  <div className="compass-qc-role-speech">
                    <b>{activeRoleConfig?.label}</b>
                    <p>{reviewRoleGuide(activeRole)}</p>
                  </div>
                  {activeRole === "projectManager" ? (
                    <div className="compass-qc-role-guide-actions">
                      <span className="compass-qc-pm-download-note">
                        One Google Slides deck with every PM-approved asset, including UGC.
                      </span>
                      <button
                        className="btn primary compass-qc-client-slides-button"
                        type="button"
                        disabled={
                          !readyAssets || clientSlidesImporting
                        }
                        onClick={() => void openClientSlidesInGoogle()}
                      >
                        {clientSlidesImporting
                          ? "Importing to Google…"
                          : `Open in Google Slides · ${readyAssets}`}
                      </button>
                      {clientSlidesError ? (
                        <span className="compass-qc-client-slides-error" role="alert">
                          {clientSlidesError}
                        </span>
                      ) : null}
                      {clientGoogleSlidesUrl ? (
                        <a
                          className="compass-qc-client-slides-link"
                          href={clientGoogleSlidesUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open presentation again
                        </a>
                      ) : null}
                    </div>
                  ) : (
                    <span className="compass-qc-role-summary">
                      {activeRoleWaiting} to review, {activeRoleApproved} approved
                    </span>
                  )}
                </div>
              </section>
              {activeRole === "graphicDesign" && activeRoleGroups.length ? (
                <WorkflowMaterialPack state={state} />
              ) : null}
              <div className="compass-qc-section-head">
                <div>
                  <span className="compass-context-label">Creative review queue</span>
                  <h3>Assets in {reviewRoleShort(activeRole)} review</h3>
                </div>
                <span>
                  {activeRoleGroups.length} {pluralize(activeRoleGroups.length, "creative")}
                </span>
              </div>
              {activeRoleGroups.length ? (
                <div className="compass-qc-focus-grid">
                  {activeRoleGroups.map((outputs) => {
                    const output = outputs[0]!;
                    return (
                      <QcSlide
                        index={reviewGroups.indexOf(outputs)}
                        output={output}
                        outputs={outputs}
                        direction={state.directions.find(
                          (candidate) => candidate.id === output.directionId
                        )}
                        run={state}
                        role={activeRole}
                        dispatch={dispatch}
                        canEdit={canEdit}
                        key={output.id}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="compass-qc-queue-clear">
                  <span
                    className={`compass-qc-role-character ${reviewRoleShort(activeRole).toLowerCase()}`}
                    aria-hidden="true"
                  >
                    {reviewRoleShort(activeRole)}
                  </span>
                  <div>
                    <b>{reviewRoleShort(activeRole)} queue is clear.</b>
                    <p>
                      {activeRole === "graphicDesign"
                        ? "UGC goes directly to CS, so it does not appear in this queue."
                        : "Nothing is waiting for this role right now."}
                    </p>
                  </div>
                </div>
              )}
            </div>
        </div>
      ) : (
        <div className="empty">
          <b>No creatives yet.</b>
          <p>Create outputs first.</p>
        </div>
      )}
    </DecisionCard>
  );
}

function ApprovalDecisionField({
  output,
  outputs,
  role,
  dispatch,
  canEdit
}: {
  output: CreativeOutput;
  outputs: readonly CreativeOutput[];
  role: ApprovalRole;
  dispatch: Dispatch<WorkflowAction>;
  canEdit: boolean;
}) {
  const [mode, setMode] = useState<"approve" | "changes" | null>(null);
  const [changeType, setChangeType] = useState<"artwork" | "caption" | "both" | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const roleShort = reviewRoleShort(role);
  const ugc = isUgcOutput(output);
  const nextLabel = role === "graphicDesign" ? "CS" : role === "clientService" ? "PM" : "Client";
  const dialogTitleId = `qc-decision-title-${output.id}-${role}`;
  const dialogDescriptionId = `qc-decision-description-${output.id}-${role}`;

  useEffect(() => {
    setMode(null);
    setDraft("");
    setChangeType(null);
    setError(null);
  }, [role, output.id]);

  function submit() {
    if (!canEdit) return;
    const actionableOutputs = outputs.filter(
      (candidate) => currentApprovalRole(candidate) === role
    );
    if (mode === "approve") {
      actionableOutputs.forEach((candidate) =>
        dispatch({
          type: "review-output",
          id: candidate.id,
          role,
          decision: "approved",
          comment: draft.trim()
        })
      );
      setMode(null);
      return;
    }
    const resolvedType = ugc ? "both" : changeType;
    if (!resolvedType || !draft.trim()) {
      setError("Choose what needs to change and add one clear instruction.");
      return;
    }
    const targetRole: ApprovalRole =
      ugc || resolvedType === "caption" ? "clientService" : "graphicDesign";
    actionableOutputs.forEach((candidate) =>
      dispatch({
        type: "route-output-changes",
        id: candidate.id,
        requestedBy: role,
        targetRole,
        comment: draft.trim()
      })
    );
    setMode(null);
  }

  function open(nextMode: "approve" | "changes", preset?: "artwork" | "caption" | "both") {
    setMode(nextMode);
    setChangeType(preset ?? (ugc ? "both" : null));
    setDraft("");
    setError(null);
  }

  return (
    <>
      <div className="review-decision-actions compass-qc-decision-actions">
        {role === "clientService" ? (
          <button
            className="btn secondary small"
            type="button"
            disabled={!canEdit}
            onClick={() => open("changes", ugc ? "both" : "artwork")}
          >
            {ugc ? "Needs UGC update" : "Request design changes"}
          </button>
        ) : role === "projectManager" ? (
          <button
            className="btn secondary small"
            type="button"
            disabled={!canEdit}
            onClick={() => open("changes")}
          >
            Request changes
          </button>
        ) : null}
        <button
          className="btn primary small"
          type="button"
          disabled={!canEdit}
          onClick={() => open("approve")}
        >
          Approve → {nextLabel}
        </button>
      </div>
      {mode ? (
        <div
          className="output-modal-backdrop"
          onClick={() => setMode(null)}
        >
          <div
            className="output-modal compass-qc-decision-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            aria-describedby={dialogDescriptionId}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="output-modal-head">
              <div>
                <p className="eyebrow">QC decision</p>
                <h3 id={dialogTitleId}>
                  {mode === "approve"
                    ? `${roleShort} → ${nextLabel}`
                    : ugc
                      ? "Request UGC update"
                      : "Request changes"}
                </h3>
              </div>
              <button
                className="btn ghost"
                type="button"
                onClick={() => setMode(null)}
              >
                Close
              </button>
            </div>
            <p className="output-modal-reference-note" id={dialogDescriptionId}>
              {mode === "approve"
                ? `Marks ${roleShort} approved and sends this creative to ${nextLabel}.`
                : "Choose the fix owner and add one clear instruction."}
            </p>
            <div className="compass-qc-decision-meta">
              <b>{roleShort} approval</b> · {qcContentTypeLabel(output)} · V{output.revisionCount + 1}
            </div>
            {mode === "changes" && !ugc ? (
              <div className="compass-qc-change-type-field">
                <span>What needs to change?</span>
                <div>
                  {(["artwork", "caption", "both"] as const).map((item) => (
                    <button
                      className={changeType === item ? "on" : ""}
                      type="button"
                      key={item}
                      onClick={() => setChangeType(item)}
                    >
                      {item === "caption" ? "Caption" : item === "both" ? "Both" : "Artwork"}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {mode === "changes" ? (
              <div className="compass-qc-route-preview">
                {ugc || changeType === "caption"
                  ? "Fix owner: CS · Update the hook, script, scenes, creator direction, or caption."
                  : changeType === "artwork"
                    ? "Fix owner: GD · Update and replace the artwork in Internal QC."
                    : changeType === "both"
                      ? "Fix route: GD → CS · Artwork first, then copy."
                      : "Choose one and Creative Compass will route the revision to the right owner."}
              </div>
            ) : null}
            <label className="output-modal-prompt-label">
              <span>{mode === "approve" ? "Handoff note (optional)" : "Change instruction"}</span>
              <textarea
                autoFocus
                value={draft}
                rows={4}
                placeholder={mode === "approve" ? `Optional context for ${nextLabel}.` : "Add one clear, actionable note."}
                aria-invalid={Boolean(error)}
                onChange={(event) => {
                  setDraft(event.target.value);
                  if (error) setError(null);
                }}
              />
            </label>
            {error ? <p className="review-comment-error">{error}</p> : null}
            <div className="output-modal-actions">
              <button
                className="btn secondary"
                type="button"
                onClick={() => setMode(null)}
              >
                Cancel
              </button>
              <button className={mode === "approve" ? "btn primary" : "btn danger"} type="button" onClick={submit}>
                {mode === "approve" ? `Mark ✓ ${roleShort} approved` : "Route changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function QcSlide({
  index,
  output,
  outputs,
  direction,
  run,
  role,
  dispatch,
  canEdit
}: {
  index: number;
  output: CreativeOutput;
  outputs: readonly CreativeOutput[];
  direction: WorkflowState["directions"][number] | undefined;
  run: WorkflowState;
  role: ApprovalRole;
  dispatch: Dispatch<WorkflowAction>;
  canEdit: boolean;
}) {
  const createCheckpoint = useOptionalWorkspace()?.createCheckpoint;
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [editingCopy, setEditingCopy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const roleConfig =
    REVIEW_ROLES.find(({ key }) => key === role) ?? REVIEW_ROLES[0]!;
  const roleShort = reviewRoleShort(role);
  const album = isAlbumOutput(output) && outputs.length > 1;
  const orderedOutputs = album ? sortAlbumOutputs(outputs) : outputs;
  const decision = reviewGroupIsApprovedForRole(outputs, role)
    ? "approved"
    : outputs.some((candidate) => candidate.approval[role] === "rejected")
      ? "rejected"
      : null;
  const decisionClass = decision ?? "pending";
  const clientRevisionRole =
    output.clientStatus === "revision" ? currentApprovalRole(output) : null;
  const clientRevisionComment =
    (clientRevisionRole
      ? output.approvalComments[clientRevisionRole]
      : "") || output.approvalComments.projectManager;

  const handleReplace = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!canEdit) return;
    const files = Array.from(event.target.files ?? []).sort((left, right) =>
      left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base"
      })
    );
    event.target.value = "";
    if (!files.length) return;
    if (album && files.length !== orderedOutputs.length) {
      setUploadError(`Choose exactly ${orderedOutputs.length} album panels in order.`);
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      const targets = album ? orderedOutputs : [output];
      const replacements = [];
      for (const [panelIndex, target] of targets.entries()) {
        const file = files[panelIndex];
        if (!file) continue;
        const replacement = await uploadReplacementAsset({
          run,
          output: target,
          file
        });
        replacements.push({ target, replacement });
      }
      await createCheckpoint?.("replace-image", run.id);
      for (const { target, replacement } of replacements) {
        dispatch({
          type: "replace-output-asset",
          id: target.id,
          ...replacement
        });
      }
    } catch (caught) {
      setUploadError(
        caught instanceof Error
          ? caught.message
          : "Could not upload replacement image."
      );
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    setUploadError(null);
    try {
      for (const target of orderedOutputs) {
        await downloadOutputAsset(target, run.outputs.indexOf(target));
      }
    } catch (caught) {
      setUploadError(
        caught instanceof Error ? caught.message : "Could not download artwork."
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <article
      className={`compass-qc-focus-card ${decision === "rejected" || outputs.some((candidate) => candidate.status === "needs-revision") ? "work-required" : ""}`}
    >
      <div className="compass-qc-focus-asset">
        <button
          className="compass-qc-focus-visual compass-view-preview-button"
          type="button"
          aria-label={`Open ${album ? "album " : ""}creative ${index + 1} preview`}
          onClick={() => setPreviewing(true)}
        >
          {isUgcOutput(output) ? (
            <UgcTemplatePreview direction={direction} compact />
          ) : album ? (
            <AlbumPanelPreview
              outputs={orderedOutputs}
              direction={direction}
              format={resolvedAlbumFormatForDirection(
                run.albumFormat,
                direction
              )}
              compact
            />
          ) : output.assetUrl ? (
            <img
              className="compass-qc-focus-image"
              src={output.assetUrl}
              alt={direction?.hook ?? `Creative ${index + 1}`}
            />
          ) : (
            <div className="static-preview">
              <span className="static-mark" />
              <div className="static-copy">
                <h3>{direction?.hook}</h3>
                <p>{direction ? directionSubheadline(direction) : ""}</p>
                <span>Learn more</span>
              </div>
            </div>
          )}
        </button>
        {direction?.caption ? (
          <div className="compass-qc-focus-caption">
            <span>{isUgcOutput(output) ? "Caption / script direction" : "Caption"}</span>
            <OutputCaptionText caption={direction.caption} scrollable />
          </div>
        ) : null}
      </div>
      <div className="compass-qc-focus-content">
        <header className="compass-qc-focus-head">
          <div>
            <span className="compass-qc-card-role-mark">
              <i className={roleShort.toLowerCase()}>{roleShort}</i>
              {roleConfig.label}
            </span>
            <span className="compass-qc-card-kicker">Creative {index + 1}</span>
            <span className="compass-qc-content-type-badge">
              <i>{isUgcOutput(output) ? "UG" : output.format.toLowerCase().includes("album") ? "AL" : "ST"}</i>
              {qcContentTypeLabel(output)}
            </span>
            <h4>{direction?.hook ?? `Creative ${index + 1}`}</h4>
          </div>
          <span className={`compass-qc-state-badge ${decisionClass}`}>
            {qcDecisionLabel(decision)}
          </span>
        </header>
        <div className="compass-qc-card-meta">
          <span>Content type · {qcContentTypeLabel(output)}</span>
          <span>{qcStatusLabel(output.status)}</span>
        </div>
        {isUgcOutput(output) ? (
          <div className="compass-qc-ugc-ownership">
            <i>UG</i>
            UGC skips GD · CS owns script, scenes, and creator direction
          </div>
        ) : null}
        <div className="compass-qc-check-box">
          <b>{roleShort} checks</b>
          <div className="compass-qc-check-chips">
            {qcChecklistFor(output, role, roleConfig.checklist).map((check) => (
              <span key={check}>{check}</span>
            ))}
          </div>
        </div>
        <QcApprovalTrail output={output} outputs={outputs} />
        {output.clientStatus === "revision" && clientRevisionComment ? (
          <div className="compass-qc-work-note client-request">
            <b>Client changes requested</b>
            <p>{clientRevisionComment}</p>
          </div>
        ) : decision === "rejected" && output.approvalComments[role] ? (
          <div className="compass-qc-work-note">
            <b>Changes requested</b>
            <p>{output.approvalComments[role]}</p>
          </div>
        ) : null}
        <div className="compass-qc-card-actions">
          <div className="compass-qc-card-utilities">
            <div className="compass-qc-asset-actions">
              {role === "graphicDesign" ? <><button
                className="btn secondary small download-action"
                type="button"
                disabled={orderedOutputs.some((candidate) => !candidate.assetUrl) || downloading}
                onClick={() => void handleDownload()}
              >
                {downloading
                  ? "Downloading…"
                  : album
                    ? "Download Album"
                    : "Download Image"}
              </button>
              <label
                className={`btn secondary small upload-inline ${uploading || !canEdit ? "disabled" : ""}`}
                title={album ? `Choose ${orderedOutputs.length} panel files in order.` : undefined}
              >
                {uploading
                  ? "Uploading…"
                  : album
                    ? `Upload ${orderedOutputs.length} panels`
                    : "Upload replacement"}
                <input
                  className="file-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple={album}
                  disabled={uploading || !canEdit}
                  onChange={handleReplace}
                />
              </label>
              </> : role === "clientService" ? (
                <button
                  className="btn secondary small"
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setEditingCopy(true)}
                >
                  {isUgcOutput(output) ? "Edit script & flow" : "Edit copy"}
                </button>
              ) : null}
            </div>
            {uploadError ? (
              <p className="repository-message error">{uploadError}</p>
            ) : null}
          </div>
          <ApprovalDecisionField
            output={output}
            outputs={outputs}
            role={role}
            dispatch={dispatch}
            canEdit={canEdit}
          />
        </div>
      </div>
      {editingCopy && direction ? (
        <CreativeCopyEditModal
          output={output}
          direction={direction}
          dispatch={dispatch}
          onClose={() => setEditingCopy(false)}
        />
      ) : null}
      {previewing ? (
        <CreativePreviewModal
          output={output}
          outputs={orderedOutputs}
          direction={direction}
          index={index}
          albumFormat={resolvedAlbumFormatForDirection(
            run.albumFormat,
            direction
          )}
          onClose={() => setPreviewing(false)}
        />
      ) : null}
    </article>
  );
}

function qcChecklistFor(
  output: CreativeOutput,
  role: ApprovalRole,
  fallback: readonly string[]
): readonly string[] {
  if (role === "graphicDesign" && output.format.toLowerCase().includes("album")) {
    return ["Hero image", "Supporting frames", "Visual consistency", "Final files"];
  }
  if (role === "clientService" && isUgcOutput(output)) {
    return ["Hook & script", "Scene flow", "Creator direction", "Brand fit"];
  }
  if (role === "projectManager" && isUgcOutput(output)) {
    return ["Brief & offer", "Script accuracy", "Production readiness"];
  }
  return fallback;
}

function QcApprovalTrail({
  output,
  outputs
}: {
  output: CreativeOutput;
  outputs: readonly CreativeOutput[];
}) {
  const roles = approvalRolesForOutput(output);
  const currentRole = roles.find(
    (role) => !reviewGroupIsApprovedForRole(outputs, role)
  );
  const internallyApproved = roles.every(
    (role) => reviewGroupIsApprovedForRole(outputs, role)
  );

  return (
    <div className="compass-qc-mini-trail" aria-label="Approval route">
      {roles.map((role, index) => {
        const approved = reviewGroupIsApprovedForRole(outputs, role);
        const current = role === currentRole;
        const short = reviewRoleShort(role);
        return (
          <Fragment key={role}>
            <span className={approved ? "done" : current ? "current" : "future"}>
              {approved ? <i aria-hidden="true">✓</i> : null}
              {approved ? `${short} approved` : short}
            </span>
            {index < roles.length - 1 ? <b aria-hidden="true">→</b> : null}
          </Fragment>
        );
      })}
      <b aria-hidden="true">→</b>
      <span className={internallyApproved ? "done" : "future"}>
        {internallyApproved ? <i aria-hidden="true">✓</i> : null}
        {internallyApproved ? "Client ready" : "Client"}
      </span>
    </div>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

function qcStatusLabel(status: CreativeOutput["status"]): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "fixed":
      return "Fixed";
    case "needs-revision":
      return "Needs revision";
    default:
      return "Draft";
  }
}

function qcDecisionLabel(decision: CreativeOutput["approval"][ApprovalRole]): string {
  if (decision === "approved") return "Approved";
  if (decision === "rejected") return "Rejected";
  return "Pending";
}

function downloadFileName(output: CreativeOutput, index: number, blob: Blob): string {
  const storedName = output.assetStoragePath?.split("/").pop()?.split("?")[0];
  if (storedName && /\.[a-z0-9]{2,5}$/i.test(storedName)) return storedName;
  const extension =
    blob.type === "image/jpeg"
      ? "jpg"
      : blob.type === "image/webp"
        ? "webp"
        : "png";
  return `compass-creative-${index + 1}.${extension}`;
}

export async function downloadOutputAsset(
  output: CreativeOutput,
  index = 0
): Promise<void> {
  if (!output.assetUrl) throw new Error("This creative has no downloadable artwork.");
  const response = await fetch(output.assetUrl);
  if (!response.ok) {
    throw new Error(`Could not download artwork (${response.status}).`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = downloadFileName(output, index, blob);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}

async function downloadAllOutputs(outputs: WorkflowState["outputs"]) {
  for (const [index, output] of outputs.entries()) {
    if (!output.assetUrl) continue;
    await downloadOutputAsset(output, index);
  }
}

function clientCreativeTitle(output: CreativeOutput, index: number): string {
  const format = output.format.toLowerCase();
  const label = format.includes("ugc")
    ? "UGC"
    : format.includes("album")
      ? "Album"
      : format.includes("motion")
        ? "Motion"
        : format.includes("resize")
          ? "Resize"
          : "Static";

  return `${label} ${String(index + 1).padStart(2, "0")}`;
}

type ClientRevisionTarget = "graphicDesign" | "clientService" | "both";

export function ClientStage({
  state,
  dispatch,
  canEdit = true
}: StageProps & { canEdit?: boolean }) {
  const sendClientAction: WorkflowAction = { type: "send-client" };
  const sendClientBlocked = workflowActionBlockReason(state, sendClientAction);
  const backAction: WorkflowAction = { type: "set-stage", stage: "approval" };
  const deliverAction: WorkflowAction = { type: "mark-delivered" };
  const deliverBlocked = workflowActionBlockReason(state, deliverAction);
  const creativeGroups = groupOutputsForReview(state.outputs);
  const approvedCount = creativeGroups.filter((outputs) =>
    outputs.every((output) => output.clientStatus === "approved")
  ).length;
  const allApproved =
    creativeGroups.length > 0 && approvedCount === creativeGroups.length;
  const [revisionOutputId, setRevisionOutputId] = useState<string | null>(null);
  const [previewOutputId, setPreviewOutputId] = useState<string | null>(null);
  const [revisionTarget, setRevisionTarget] =
    useState<ClientRevisionTarget | null>(null);
  const [revisionComment, setRevisionComment] = useState("");
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const revisionOutput = state.outputs.find(
    (output) => output.id === revisionOutputId
  );
  const revisionOutputs = revisionOutput
    ? state.outputs.filter((output) =>
        isAlbumOutput(revisionOutput)
          ? output.directionId === revisionOutput.directionId &&
            isAlbumOutput(output)
          : output.id === revisionOutput.id
      )
    : [];
  const revisionDirection = state.directions.find(
    (direction) => direction.id === revisionOutput?.directionId
  );
  const previewOutput = state.outputs.find(
    (output) => output.id === previewOutputId
  );
  const previewOutputs = previewOutput
    ? state.outputs.filter((output) =>
        isAlbumOutput(previewOutput)
          ? output.directionId === previewOutput.directionId &&
            isAlbumOutput(output)
          : output.id === previewOutput.id
      )
    : [];
  const previewDirection = state.directions.find(
    (direction) => direction.id === previewOutput?.directionId
  );

  useEffect(() => {
    if (canEdit && !state.clientSent && !sendClientBlocked) {
      dispatch(sendClientAction);
    }
  }, [canEdit, dispatch, sendClientBlocked, state.clientSent]);

  function closeRevisionDialog() {
    setRevisionOutputId(null);
    setRevisionTarget(null);
    setRevisionComment("");
    setRevisionError(null);
  }

  function submitRevisionRequest() {
    if (!canEdit || !revisionOutput) return;
    const comment = revisionComment.trim();
    if (!revisionTarget || !comment) {
      setRevisionError(
        "Choose Artwork, Concept, or Both and add one clear change instruction."
      );
      return;
    }
    revisionOutputs.forEach((output) => {
      dispatch({
        type: "request-client-change",
        id: output.id,
        targetRole: revisionTarget,
        comment
      });
    });
    closeRevisionDialog();
  }

  function approveAllClientOutputs() {
    if (!canEdit) return;
    state.outputs.forEach((output) => {
      if (output.clientStatus !== "approved") {
        dispatch({ type: "approve-output", id: output.id });
      }
    });
  }

  return (
    <DecisionCard
      eyebrow="06 / Client"
      title="Make feedback easy to act on."
      helper="The client sees the idea, not the production clutter. Every requested change records what needs fixing and routes it correctly."
      status={`${approvedCount} / ${creativeGroups.length} approved`}
      statusClass={allApproved ? "green" : "blue"}
      className="compass-stage-client"
      actions={
        <>
          <button
            className="btn ghost"
            type="button"
            onClick={() => dispatch(backAction)}
          >
            ← Back to Internal QC
          </button>
          <div className="compass-client-footer-actions">
            <button
              className="btn compass-client-approve-all"
              type="button"
              disabled={!canEdit || !state.clientSent}
              onClick={approveAllClientOutputs}
            >
              Approve all demo assets
            </button>
            <button
              className="btn primary"
              type="button"
              disabled={!canEdit || Boolean(deliverBlocked)}
              title={deliverBlocked ?? undefined}
              onClick={() => dispatch(deliverAction)}
            >
              Deliver and learn →
            </button>
          </div>
        </>
      }
    >
      <div className="client-grid compass-client-grid">
        {creativeGroups.map((outputs, index) => {
          const output = outputs[0];
          if (!output) return null;
          const album = isAlbumOutput(output);
          const direction = state.directions.find(
            (candidate) => candidate.id === output.directionId
          );
          const clientStatus = outputs.some(
            (candidate) => candidate.clientStatus === "revision"
          )
            ? "revision"
            : outputs.every(
                  (candidate) => candidate.clientStatus === "approved"
                )
              ? "approved"
              : "sent";
          const approveBlocked = outputs
            .map((candidate) =>
              workflowActionBlockReason(state, {
                type: "approve-output",
                id: candidate.id
              })
            )
            .find(Boolean);
          return (
            <article
              className={`client-card compass-client-card ${clientStatus}`}
              key={output.id}
            >
              <button
                className="preview-area compass-client-preview compass-view-preview-button"
                type="button"
                aria-label={`Open ${album ? "album " : ""}creative ${index + 1} preview`}
                onClick={() => setPreviewOutputId(output.id)}
              >
                {album ? (
                  <AlbumPanelPreview
                    outputs={outputs}
                    direction={direction}
                    format={resolvedAlbumFormatForDirection(
                      state.albumFormat,
                      direction
                    )}
                    compact
                  />
                ) : output.assetUrl ? (
                  <img
                    className="generated-preview"
                    src={output.assetUrl}
                    alt={direction?.hook ?? `Creative ${index + 1}`}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="static-preview">
                    <span className="static-mark" />
                    <div className="static-copy">
                      <h3>{direction?.hook}</h3>
                      <p>{direction ? directionSubheadline(direction) : ""}</p>
                      <span>Learn more</span>
                    </div>
                  </div>
                )}
              </button>
              <div className="client-card-body compass-client-card-body">
                <div className="compass-client-card-copy">
                  <h3>{clientCreativeTitle(output, index)}</h3>
                  <p>{direction?.hook ?? `Creative ${index + 1}`}</p>
                </div>
                <div className="compass-client-card-actions">
                  <button
                    className="btn small"
                    type="button"
                    disabled={!canEdit || !state.clientSent}
                    onClick={() => {
                      setRevisionOutputId(output.id);
                      setRevisionTarget(
                        isUgcOutput(output) ? "clientService" : null
                      );
                      setRevisionComment("");
                      setRevisionError(null);
                    }}
                  >
                    Request changes
                  </button>
                  <button
                    className="btn small compass-client-approve"
                    type="button"
                    disabled={!canEdit || Boolean(approveBlocked)}
                    title={approveBlocked ?? undefined}
                    onClick={() => {
                      outputs.forEach((candidate) => {
                        if (candidate.clientStatus !== "approved") {
                          dispatch({
                            type: "approve-output",
                            id: candidate.id
                          });
                        }
                      });
                    }}
                  >
                    Approve
                  </button>
                </div>
                {clientStatus === "approved" ||
                clientStatus === "revision" ? (
                  <div className="compass-client-decision-note">
                    {clientStatus === "approved"
                      ? "Approved and ready for delivery."
                      : "Feedback recorded and routed back to Internal QC."}
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
      {previewOutput ? (
        <CreativePreviewModal
          output={previewOutput}
          outputs={previewOutputs}
          direction={previewDirection}
          index={state.outputs.indexOf(previewOutput)}
          albumFormat={resolvedAlbumFormatForDirection(
            state.albumFormat,
            previewDirection
          )}
          onClose={() => setPreviewOutputId(null)}
        />
      ) : null}
      {revisionOutput ? (
        <div className="output-modal-backdrop" onClick={closeRevisionDialog}>
          <div
            className="output-modal compass-qc-decision-modal compass-client-revision-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-revision-title"
            aria-describedby="client-revision-description"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="output-modal-head">
              <div>
                <p className="eyebrow">Client decision</p>
                <h3 id="client-revision-title">Request changes</h3>
              </div>
              <button
                className="btn ghost"
                type="button"
                onClick={closeRevisionDialog}
              >
                Close
              </button>
            </div>
            <p
              className="output-modal-reference-note"
              id="client-revision-description"
            >
              Choose the Internal QC owner for{" "}
              {revisionDirection?.hook ?? "this creative"}
              {revisionOutputs.length > 1
                ? ` and all ${revisionOutputs.length} album images`
                : ""}{" "}
              so the request goes directly to the right team.
            </p>
            <div className="compass-qc-decision-meta">
              <b>Client request</b> · {qcContentTypeLabel(revisionOutput)} · V
              {revisionOutput.revisionCount + 1}
            </div>
            <div className="compass-qc-change-type-field">
              <span>What needs to change?</span>
              <div>
                {(isUgcOutput(revisionOutput)
                  ? (["clientService"] as const)
                  : (["graphicDesign", "clientService", "both"] as const)
                ).map((target) => (
                  <button
                    className={revisionTarget === target ? "on" : ""}
                    type="button"
                    aria-pressed={revisionTarget === target}
                    key={target}
                    onClick={() => {
                      setRevisionTarget(target);
                      if (revisionError) setRevisionError(null);
                    }}
                  >
                    {target === "graphicDesign"
                      ? "Artwork"
                      : target === "clientService"
                        ? "Concept"
                        : "Both"}
                  </button>
                ))}
              </div>
            </div>
            <div className="compass-qc-route-preview">
              {revisionTarget === "graphicDesign"
                ? "Artwork change · Update and replace the visual in Internal QC."
                : revisionTarget === "clientService"
                  ? "Concept change · Update the concept, hook, caption, script, or client-facing details."
                  : revisionTarget === "both"
                    ? "Both · Update the artwork first, then the concept and copy."
                    : "Choose Artwork, Concept, or Both to route this request."}
            </div>
            <label className="output-modal-prompt-label">
              <span>Change instruction</span>
              <textarea
                autoFocus
                value={revisionComment}
                rows={4}
                placeholder="Describe exactly what the client wants changed."
                aria-invalid={Boolean(revisionError)}
                onChange={(event) => {
                  setRevisionComment(event.target.value);
                  if (revisionError) setRevisionError(null);
                }}
              />
            </label>
            {revisionError ? (
              <p className="review-comment-error">{revisionError}</p>
            ) : null}
            <div className="output-modal-actions">
              <button
                className="btn secondary"
                type="button"
                onClick={closeRevisionDialog}
              >
                Cancel
              </button>
              <button
                className="btn danger"
                type="button"
                onClick={submitRevisionRequest}
              >
                Route changes
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DecisionCard>
  );
}

export function SummaryStage({
  state,
  dispatch,
  onCreateRun
}: StageProps & { onCreateRun: () => void }) {
  const backAction: WorkflowAction = { type: "set-stage", stage: "client" };
  const doneAction: WorkflowAction = { type: "mark-done" };
  const doneBlocked = workflowActionBlockReason(state, doneAction);

  return (
    <DecisionCard
      eyebrow="07 / Learn"
      title="Every launch makes the next idea smarter."
      helper="Close the loop by saving the creative hypothesis, performance result, and the pattern worth repeating."
      status="Memory updated"
      statusClass="green"
      actions={
        <>
          <button
            className="btn secondary download-action"
            type="button"
            disabled={!state.outputs.some((output) => output.assetUrl)}
            onClick={() => void downloadAllOutputs(state.outputs)}
          >
            Download all
          </button>
          <button
            className="btn secondary"
            type="button"
            onClick={() => dispatch(backAction)}
          >
            Back to Client
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={Boolean(doneBlocked)}
            title={doneBlocked ?? undefined}
            onClick={() => dispatch(doneAction)}
          >
            Mark sent
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={onCreateRun}
          >
            New creative
          </button>
        </>
      }
    >
      <div className="summary-grid">
        <Metric value={String(state.outputs.length)} label="Final outputs" />
        <Metric value={state.brand?.name ?? "-"} label="Client" />
        <Metric
          value={
            creativeMixItems(state).length === 1
              ? serviceLabels[state.service]
              : `${creativeMixItems(state).length} content types`
          }
          label="Creative mix"
        />
        <Metric value="Passed" label="Quality status" />
      </div>
      <div className="summary-panel">
        <h3>Approved creatives</h3>
        <OutputGrid state={state} dispatch={dispatch} />
      </div>
      <LearningSuggestionsPanel state={state} />
    </DecisionCard>
  );
}

function LearningSuggestionsPanel({ state }: { state: WorkflowState }) {
  const repository = useBrandMemoryRepository();
  const [suggestions, setSuggestions] = useState<
    readonly (LearningSuggestion & {
      id: string;
      status: "pending" | "approved" | "rejected";
    })[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);

    try {
      const results = await suggestBrandLearning(state);
      setSuggestions(
        results.map((item, index) => ({
          ...item,
          id: `suggestion-${index}`,
          status: "pending" as const
        }))
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not generate learning suggestions."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id: string) => {
    const suggestion = suggestions.find((item) => item.id === id);
    if (!suggestion || !state.brand) return;
    const brand = state.brand;

    setSuggestions((current) =>
      current.map((item) =>
        item.id === id ? { ...item, status: "approved" as const } : item
      )
    );

    try {
      await repository.createLearningEntry({
        clientId: brand.id,
        polarity: suggestion.polarity,
        note: suggestion.note,
        sourceRunId: state.id
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save suggestion."
      );
      setSuggestions((current) =>
        current.map((item) =>
          item.id === id ? { ...item, status: "pending" as const } : item
        )
      );
    }
  };

  const handleReject = (id: string) => {
    setSuggestions((current) =>
      current.map((item) =>
        item.id === id ? { ...item, status: "rejected" as const } : item
      )
    );
  };

  return (
    <div className="summary-panel summary-learning">
      <div className="learning-head">
        <div>
          <h3>Learning suggestions</h3>
          <p>
            Creative Compass reviews this run's approvals and rejections and proposes
            brand learning updates for you to approve.
          </p>
        </div>
        <button
          className="btn secondary small"
          type="button"
          disabled={loading || !state.brand}
          onClick={() => void handleGenerate()}
        >
          {loading
            ? "Analyzing…"
            : suggestions.length
              ? "Regenerate"
              : "Suggest learning"}
        </button>
      </div>
      {error ? <p className="repository-message error">{error}</p> : null}
      {suggestions.length ? (
        <div className="learning-grid">
          {suggestions.map((item) => (
            <div className={`learning ${item.polarity}`} key={item.id}>
              <b>{item.polarity === "working" ? "What's working" : "What to avoid"}</b>
              <p>{item.note}</p>
              {item.status === "pending" ? (
                <div className="learning-actions">
                  <button
                    className="btn primary small"
                    type="button"
                    onClick={() => void handleApprove(item.id)}
                  >
                    Approve
                  </button>
                  <button
                    className="btn danger small"
                    type="button"
                    onClick={() => handleReject(item.id)}
                  >
                    Reject
                  </button>
                </div>
              ) : (
                <span
                  className={`pill ${item.status === "approved" ? "green" : ""}`}
                >
                  {item.status === "approved"
                    ? "Added to brand memory"
                    : "Dismissed"}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : !loading ? (
        <p className="repository-message">
          Nothing generated yet. Click "Suggest learning" to have Creative Compass
          propose updates from this run's real approval signal.
        </p>
      ) : null}
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="metric">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

interface RunAttention {
  runId: string;
  brand: Brand;
  service: ServiceType;
  stageLabel: string;
  note: string;
  urgent: boolean;
}

type WorkboardFilter =
  | "all"
  | "mine"
  | "pic"
  | "attention"
  | "active"
  | "unstarted";

function ClientPicControl({ clientId }: { clientId: string }) {
  const collaboration = useOptionalRunCollaboration();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentMember = collaboration?.members.find(
    (member) => member.userId === collaboration.currentUserId
  );
  const clientPic = collaboration?.clientPicByClientId[clientId];

  if (!collaboration?.enabled || !currentMember?.isAdmin) {
    return (
      <small className="workboard-client-pic">
        Client PIC · {clientPic?.displayName ?? "Not assigned"}
      </small>
    );
  }

  return (
    <label className="workboard-client-pic-control">
      <span>Client PIC</span>
      <select
        aria-label="Client PIC"
        disabled={saving}
        value={clientPic?.userId ?? ""}
        onChange={async (event) => {
          const userId = event.target.value;
          if (!userId) return;
          setSaving(true);
          setError(null);
          try {
            await collaboration.setClientPic({ clientId, userId });
          } catch (caught) {
            setError(
              caught instanceof Error ? caught.message : "Could not update PIC."
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        <option value="" disabled>Choose PIC</option>
        {collaboration.members.map((member) => (
          <option key={member.userId} value={member.userId}>
            {member.displayName} · {departmentLabel(member.department)}
          </option>
        ))}
      </select>
      {error ? <em title={error}>Update failed</em> : null}
    </label>
  );
}
const WORKBOARD_PAGE_SIZE = 50;

interface WorkboardProjectState {
  label: string;
  tone: "neutral" | "ready" | "attention" | "active" | "error";
  detail: string;
}

function computeRunAttention(run: WorkflowState): RunAttention | null {
  if (run.done || !run.brand) return null;
  const brand = run.brand;

  if (run.stage === "approval" && !run.approved) {
    const pendingCount = run.outputs.filter(
      (output) =>
        output.approval.graphicDesign !== "approved" ||
        output.approval.clientService !== "approved" ||
        output.approval.projectManager !== "approved"
    ).length;
    if (!pendingCount) return null;
    return {
      runId: run.id,
      brand,
      service: run.service,
      stageLabel: "Internal QC",
      note: `${pendingCount} ${pluralize(pendingCount, "creative")} waiting on GD/CS/PM approval.`,
      urgent: true
    };
  }

  if (run.stage === "client") {
    if (!run.clientSent) {
      return {
        runId: run.id,
        brand,
        service: run.service,
        stageLabel: "Client review",
        note: "Approved internally. Ready to send to the client.",
        urgent: true
      };
    }
    const approvedCount = run.outputs.filter(
      (output) => output.clientStatus === "approved"
    ).length;
    if (run.outputs.length && approvedCount < run.outputs.length) {
      return {
        runId: run.id,
        brand,
        service: run.service,
        stageLabel: "Client review",
        note: `${approvedCount}/${run.outputs.length} approved by client.`,
        urgent: false
      };
    }
  }

  if (run.stage === "summary" && !run.done) {
    return {
      runId: run.id,
      brand,
      service: run.service,
      stageLabel: "Delivered",
      note: "Final set ready. Mark sent to close this run.",
      urgent: false
    };
  }

  return null;
}

function workboardProjectState(
  brand: Brand,
  run: WorkflowState | null,
  attention: RunAttention | null
): WorkboardProjectState {
  if (run) {
    const stage = stages.find((item) => item.id === run.stage);
    return {
      label: "Active",
      tone: attention?.urgent ? "attention" : "active",
      detail: attention?.note ?? `${stage?.name ?? "Creative work"} in progress.`
    };
  }
  return {
    label: "Ready",
    tone: "ready",
    detail: `${brand.name} is ready for a new creative run.`
  };
}

function workboardProjectName(run: WorkflowState): string {
  const firstBriefLine = run.brief
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^project\s*:\s*/i, ""))
    .find(Boolean);
  if (firstBriefLine) {
    return firstBriefLine.length > 58
      ? `${firstBriefLine.slice(0, 57).trimEnd()}…`
      : firstBriefLine;
  }

  const mix = creativeMixItems(run);
  if (mix.length === 1) return `${serviceLabels[mix[0]!.service]} project`;
  return "Mixed creative project";
}

function workboardProjectMeta(run: WorkflowState): string {
  const mix = creativeMixItems(run);
  const service =
    mix.length === 1
      ? serviceLabels[mix[0]!.service]
      : `${mix.length} content types`;
  const timestamp = Date.parse(run.updatedAt);
  const updated = Number.isNaN(timestamp)
    ? "Recently updated"
    : `Updated ${new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric"
      }).format(timestamp)}`;
  return `${service} · ${updated}`;
}

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function Overview({
  state,
  dispatch,
  workspace,
  workspaceDispatch,
  canCreate = true,
  onOpenStudio
}: StageProps & {
  workspace: WorkspaceState;
  workspaceDispatch: Dispatch<WorkspaceAction>;
  canCreate?: boolean;
  onOpenStudio: () => void;
}) {
  const { brands, loading, error } = useBrands();
  const collaboration = useOptionalRunCollaboration();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<WorkboardFilter>("all");
  const [visibleLimit, setVisibleLimit] = useState(WORKBOARD_PAGE_SIZE);

  const runs = workspace.runOrder
    .map((id) => workspace.runsById[id])
    .filter((run): run is WorkflowState => Boolean(run));
  const currentBrandById = new Map(
    brands.map((brand) => [brand.id, brand] as const)
  );
  const visibleBrandIds = new Set(brands.map((brand) => brand.id));

  const attentionItems = runs
    .filter((run) => Boolean(run.brand && visibleBrandIds.has(run.brand.id)))
    .map((run) => computeRunAttention(run))
    .filter((item): item is RunAttention => Boolean(item))
    .sort((a, b) => Number(b.urgent) - Number(a.urgent));

  const attentionByRunId = new Map(
    attentionItems.map((item) => [item.runId, item] as const)
  );
  const memberByUserId = new Map(
    (collaboration?.members ?? []).map((member) => [member.userId, member])
  );
  const activeRuns = runs.filter(
    (run) => !run.done && run.brand && visibleBrandIds.has(run.brand.id)
  );
  const activeClientIds = new Set(activeRuns.map((run) => run.brand!.id));
  const readyBrands = brands.filter(
    (brand) => !activeClientIds.has(brand.id) && canSelectBrand(brand)
  );

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const activeProjectRows = activeRuns.flatMap((run) => {
    const savedBrand = run.brand;
    if (!savedBrand) return [];
    const brand = currentBrandById.get(savedBrand.id) ?? savedBrand;
    const attention = attentionByRunId.get(run.id) ?? null;
    const ownership = collaboration?.ownershipByRunId[run.id] ?? null;
    const ownerUserId = ownership?.currentOwnerUserId ?? null;
    const owner = ownerUserId ? memberByUserId.get(ownerUserId) ?? null : null;
    const clientPic = collaboration?.clientPicByClientId[brand.id] ?? null;
    return [
      {
        key: run.id,
        brand,
        run,
        attention,
        owner,
        ownerUserId,
        clientPic,
        projectName: workboardProjectName(run),
        projectMeta: workboardProjectMeta(run),
        status: workboardProjectState(brand, run, attention)
      }
    ];
  });
  const readyProjectRows = readyBrands.map((brand) => ({
    key: `ready-${brand.id}`,
    brand,
    run: null,
    attention: null,
    owner: null,
    ownerUserId: null,
    clientPic: collaboration?.clientPicByClientId[brand.id] ?? null,
    projectName: "New creative project",
    projectMeta: "Choose a content type to begin",
    status: workboardProjectState(brand, null, null)
  }));
  const allProjectRows = [...activeProjectRows, ...readyProjectRows];
  const projectRows = allProjectRows
    .filter(
      ({ brand, projectName, run, attention, owner, ownerUserId, clientPic }) => {
      const matchesSearch =
        !normalizedQuery ||
        brand.name.toLocaleLowerCase().includes(normalizedQuery) ||
        brand.category.toLocaleLowerCase().includes(normalizedQuery) ||
        projectName.toLocaleLowerCase().includes(normalizedQuery) ||
        owner?.displayName.toLocaleLowerCase().includes(normalizedQuery) ||
        clientPic?.displayName.toLocaleLowerCase().includes(normalizedQuery);
      if (!matchesSearch) return false;
      if (filter === "mine") {
        return Boolean(
          run &&
            collaboration?.currentUserId &&
            ownerUserId === collaboration.currentUserId
        );
      }
      if (filter === "pic") {
        return Boolean(
          collaboration?.currentUserId &&
            clientPic?.userId === collaboration.currentUserId
        );
      }
      if (filter === "attention") return Boolean(attention);
      if (filter === "active") return Boolean(run);
      if (filter === "unstarted") return !run;
      return true;
    })
    .sort((a, b) => {
      const attentionDifference =
        Number(Boolean(b.attention)) - Number(Boolean(a.attention));
      if (attentionDifference) return attentionDifference;
      if (a.run && b.run) {
        return Date.parse(b.run.updatedAt) - Date.parse(a.run.updatedAt);
      }
      if (a.run) return -1;
      if (b.run) return 1;
      return a.brand.name.localeCompare(b.brand.name);
    });
  const visibleProjectRows = projectRows.slice(0, visibleLimit);
  const mineCount = activeProjectRows.filter(
    ({ ownerUserId }) =>
      Boolean(collaboration?.currentUserId) &&
      ownerUserId === collaboration?.currentUserId
  ).length;
  const readyClientCount = readyProjectRows.length;
  const attentionProjectCount = attentionItems.length;
  const picCount = allProjectRows.filter(
    ({ clientPic }) =>
      Boolean(collaboration?.currentUserId) &&
      clientPic?.userId === collaboration?.currentUserId
  ).length;

  function openProject(brand: Brand, run: WorkflowState | null) {
    if (run) {
      workspaceDispatch({ type: "switch-run", id: run.id });
      return;
    }
    if (!canCreate) return;
    if (canSelectBrand(brand)) {
      workspaceDispatch({
        type: "create-run",
        id: createId("run"),
        now: nowIso(),
        keepBrand: false,
        brand
      });
      return;
    }
    dispatch({ type: "set-stage", stage: "start" });
    dispatch({ type: "search-brands", value: brand.name });
    if (!state.brandMenuOpen) dispatch({ type: "toggle-brand-menu" });
    onOpenStudio();
  }

  return (
    <section id="overviewView">
      <div className="ov-head">
        <div>
          <p className="eyebrow">Live workspace</p>
          <h2>Workboard</h2>
          <p>Every project, current owner, and next decision in one place.</p>
        </div>
        <span className="workboard-access-note">
          <CheckCircle size={16} weight="fill" aria-hidden="true" />
          All clients visible
        </span>
      </div>
      <div className="ov-metrics">
        <div className="ov-metric">
          <b>{loading ? "..." : activeProjectRows.length}</b>
          <span>Active projects</span>
        </div>
        <div className="ov-metric">
          <b>{mineCount}</b>
          <span>Assigned to me</span>
        </div>
        <div className="ov-metric attention">
          <b>{attentionProjectCount}</b>
          <span>Need action</span>
        </div>
        <div className="ov-metric">
          <b>{readyClientCount}</b>
          <span>Ready to start</span>
        </div>
      </div>
      <div className="ov-board">
        {error ? (
          <p className="repository-message error">{error.message}</p>
        ) : null}
        <div className="workboard-toolbar">
          <label className="workboard-search">
            <MagnifyingGlass size={17} aria-hidden="true" />
            <span className="sr-only">Search projects</span>
            <input
              type="search"
              value={query}
              placeholder="Search project, client, or owner"
              onChange={(event) => {
                setQuery(event.target.value);
                setVisibleLimit(WORKBOARD_PAGE_SIZE);
              }}
            />
          </label>
          <div className="workboard-filters" aria-label="Filter projects">
            {(
              [
                ["all", "All"],
                ["mine", `Assigned to me ${mineCount}`],
                ["pic", `I'm PIC ${picCount}`],
                ["attention", `Need action ${attentionProjectCount}`],
                ["active", "Active"],
                ["unstarted", "Ready"]
              ] as const
            ).map(([value, label]) => (
              <button
                className={filter === value ? "active" : ""}
                type="button"
                key={value}
                aria-pressed={filter === value}
                onClick={() => {
                  setFilter(value);
                  setVisibleLimit(WORKBOARD_PAGE_SIZE);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="workboard-result-count">
            {loading
              ? "Loading projects"
              : visibleProjectRows.length < projectRows.length
                ? `${visibleProjectRows.length} of ${projectRows.length} shown`
                : `${projectRows.length} shown`}
          </span>
        </div>

        <div className="workboard-table-head" aria-hidden="true">
          <span>Project</span>
          <span>Client</span>
          <span>Status</span>
          <span>Owner</span>
          <span>Stage</span>
          <span>Progress</span>
          <span>Action</span>
        </div>

        <div className="workboard-client-list">
          {loading
            ? Array.from({ length: 5 }, (_, index) => (
                <div
                  className="workboard-client-row workboard-skeleton"
                  aria-hidden="true"
                  key={`workboard-loading-${index}`}
                >
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
              ))
            : null}
          {visibleProjectRows.map(
            ({
              key,
              brand,
              run,
              status,
              attention,
              owner,
              ownerUserId,
              projectName,
              projectMeta
            }) => {
              const stageIndex = run
                ? stages.findIndex((item) => item.id === run.stage)
                : -1;
              const stageLabel = run
                ? stages[stageIndex]?.name ?? "Creative run"
                : "Not started";
              const isCurrentOwner = Boolean(
                ownerUserId && ownerUserId === collaboration?.currentUserId
              );
              const ownerName = run
                ? owner?.displayName ??
                  (collaboration?.enabled ? "Owner pending" : "Current user")
                : "Not assigned";
              const ownerMeta = run
                ? owner
                  ? `${isCurrentOwner ? "You · " : ""}${departmentLabel(owner.department)}`
                  : collaboration?.enabled
                    ? "Syncing team profile"
                    : "Local workspace"
                : "Assigned when started";
              return (
                <article
                  className={`workboard-client-row ${attention?.urgent ? "urgent" : ""}`}
                  key={key}
                >
                  <div className="workboard-project-main">
                    <span className="workboard-project-icon" aria-hidden="true">
                      <Sparkle size={16} weight="duotone" />
                    </span>
                    <span>
                      <b>{projectName}</b>
                      <small>{projectMeta}</small>
                    </span>
                  </div>
                  <div className="workboard-client-main">
                    <span className="avatar ov-av" aria-hidden="true">
                      <BrandLogo brand={brand} />
                    </span>
                    <span>
                      <b>{brand.name}</b>
                      <small>{brand.category || "Uncategorised client"}</small>
                    </span>
                  </div>
                  <div className="workboard-client-status">
                    <span className={`workboard-status ${status.tone}`}>
                      {status.label}
                    </span>
                    <small>{status.detail}</small>
                  </div>
                  <div className="workboard-project-owner">
                    <span className="workboard-owner-avatar" aria-hidden="true">
                      {initials(ownerName) || "NA"}
                    </span>
                    <span>
                      <b>{ownerName}</b>
                      <small>{ownerMeta}</small>
                      <ClientPicControl clientId={brand.id} />
                    </span>
                  </div>
                  <div className="workboard-client-stage">
                    <b>{stageLabel}</b>
                    <small>
                      {run
                        ? `Stage ${stageIndex + 1} of ${stages.length}`
                        : "Ready to start"}
                    </small>
                  </div>
                  <div
                    className="workboard-stage-track"
                    aria-label={
                      run
                        ? `${stageLabel}, stage ${stageIndex + 1} of ${stages.length}`
                        : "No creative stages completed"
                    }
                  >
                    {stages.map((item, index) => (
                      <i
                        className={
                          run && (run.done || index <= stageIndex)
                            ? "complete"
                            : ""
                        }
                        key={item.id}
                      />
                    ))}
                  </div>
                  <div className="workboard-client-action">
                    <button
                      className="btn small"
                      type="button"
                      disabled={!run && !canCreate}
                      title={
                        !run && !canCreate
                          ? "Viewers cannot start new projects."
                          : undefined
                      }
                      onClick={() => openProject(brand, run)}
                    >
                      {run ? "Open" : "Start"}
                      <ArrowRight size={14} weight="bold" aria-hidden="true" />
                    </button>
                  </div>
                </article>
              );
            }
          )}
        </div>

        {visibleProjectRows.length < projectRows.length ? (
          <div className="workboard-load-more">
            <span>
              Showing {visibleProjectRows.length} of {projectRows.length} projects
            </span>
            <button
              className="btn small"
              type="button"
              onClick={() =>
                setVisibleLimit((current) => current + WORKBOARD_PAGE_SIZE)
              }
            >
              Show {Math.min(
                WORKBOARD_PAGE_SIZE,
                projectRows.length - visibleProjectRows.length
              )} more
            </button>
          </div>
        ) : null}

        {!loading && !projectRows.length ? (
          <div className="empty workboard-empty">
            <b>No projects match this view.</b>
            <p>Clear the search or choose a different status filter.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
