import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch
} from "react";
import {
  ArrowRight,
  Bell,
  CheckCircle,
  FileArrowUp,
  MagnifyingGlass,
  PencilSimple,
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
  type BrandAssetKind,
  type BrandDocument,
  type BrandDocumentType,
  type BrandPastWorkItem,
  type BrandProduct
} from "../../domain/brand-memory";
import {
  albumFormatLabel,
  albumFormats,
  inferredReferenceImageRole,
  type AlbumFormat,
  type CreativeOutput,
  type ServiceType
} from "../../domain/creative-run";
import {
  directionSubheadline,
  resolveSubheadlineHighlight
} from "../../domain/subheadline-highlight";
import { useBrandMemoryRepository } from "../../app/providers/brand-memory-provider";
import { useBrands } from "../../app/providers/brand-provider";
import { useClientIntakeRepository } from "../../app/providers/client-intake-provider";
import { useOptionalRunCollaboration } from "../../app/providers/run-collaboration-provider";
import { departmentLabel } from "../../domain/run-collaboration";
import {
  CLIENT_CATEGORY_MAX_LENGTH,
  validateClientCategory,
  validateFacebookUrl,
  validateOnboardingQuestionnaire,
  validateQuestionnaireGoogleSheetUrl
} from "../../domain/client-ingestion";
import {
  suggestBrandLearning,
  type LearningSuggestion
} from "../../services/brand-learning/suggest-brand-learning";
import { pluralize } from "../../shared/utils/text";
import { createId, nowIso } from "../../shared/utils/id";
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
  defaultArtworkContextSelection,
  selectedBrandProducts,
  selectedUploadedMaterials,
  totalCreativeMixQuantity
} from "./model";
import {
  selectedDirectionCount,
  workflowActionBlockReason
} from "./rules";
import { presentBrandMemoryText } from "./brand-memory-presentation";
import { useCreateSelectedHooks } from "./use-create-selected-hooks";
import {
  useGenerateMoreHooks,
  useRegenerateAllHooks,
  useRegenerateHook
} from "./use-generate-hooks";
import type { BrandMemoryRepository } from "../../ports/brand-memory-repository";
import {
  DecisionCard,
  HookGenerationModelSelect,
  Spinner,
  type StageProps
} from "./stages/shared";
import {
  AlbumFormatModal,
  AlbumFormatThumb
} from "./stages/album-format-modal";
import { PreflightModal } from "./stages/preflight-modal";
import { ConfirmationReferenceGrid } from "./stages/brief-confirmation-modal";
import {
  groupOutputsForReview,
  isAlbumOutput,
  isUgcOutput,
  qcContentTypeLabel,
  resolvedAlbumFormatForDirection
} from "./review/output-groups";
import {
  AlbumPanelPreview,
  CreativePreviewModal
} from "./review/creative-previews";
import {
  downloadAlbumArchive,
  downloadAllOutputs,
  downloadOutputAsset
} from "./review/downloads";
import { ApprovalStage } from "./stages/approval-stage";
import {
  BrandKitTag,
  BrandLogoCard,
  BriefStage,
  CreativeMaterialsEditor,
  HEX_COLOR_PATTERN,
  LibraryEditModal,
  extractColorSwatches,
  findRuleByTitle
} from "./stages/brief-stage";
import { StudioStage } from "./stages/studio-stage";

export {
  ApprovalStage,
  BriefStage,
  StudioStage,
  downloadAlbumArchive,
  downloadOutputAsset
};

export function StartStage({ state, dispatch }: StageProps) {
  const { brands, loading, error, refresh } = useBrands();
  const brandMemoryRepository = useBrandMemoryRepository();
  const [profileSection, setProfileSection] =
    useState<BrandProfileSection>("brand");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [memoryRevision, setMemoryRevision] = useState(0);
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [setupBrand, setSetupBrand] = useState<Brand | null>(null);
  const [mappingBrand, setMappingBrand] = useState<Brand | null>(null);
  const [queuedBrandName, setQueuedBrandName] = useState<string | null>(null);
  const [assetCounts, setAssetCounts] = useState<BrandAssetCounts>({
    material: 0,
    reference: 0
  });
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
  const updateAssetCount = useCallback(
    (kind: BrandAssetKind, count: number) => {
      setAssetCounts((current) =>
        current[kind] === count ? current : { ...current, [kind]: count }
      );
    },
    []
  );

  useEffect(() => {
    if (currentSetupBrand && !canStartBrandIngestion(currentSetupBrand)) {
      setSetupBrand(null);
    }
  }, [currentSetupBrand]);

  useEffect(() => {
    const clientId = state.brand?.id;
    if (!clientId) {
      setAssetCounts({ material: 0, reference: 0 });
      return;
    }
    let active = true;
    setAssetCounts({ material: 0, reference: 0 });
    void brandMemoryRepository
      .listAssetImages(clientId)
      .then((images) => {
        if (!active) return;
        setAssetCounts({
          material: images.filter((image) => image.kind === "material").length,
          reference: images.filter((image) => image.kind === "reference").length
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [brandMemoryRepository, state.brand?.id]);

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
            assetCounts={assetCounts}
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
          assetCounts={assetCounts}
          onAssetCountChange={updateAssetCount}
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
  assetCounts,
  onOpenLibrary
}: {
  state: WorkflowState;
  assetCounts: BrandAssetCounts;
  onOpenLibrary: (section: BrandProfileSection) => void;
}) {
  const brand = state.brand;
  const rows: readonly [string, number, BrandProfileSection][] = [
    ["CI", brand?.library.brand.length ?? 0, "brand"],
    ["Guideline", brand?.library.docs.length ?? 0, "docs"],
    [
      "Reference style",
      (brand?.library.refs.length ?? 0) + assetCounts.reference,
      "refs"
    ],
    [
      "Materials",
      Math.max(assetCounts.material, state.uploadedMaterials.length),
      "materials"
    ],
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
        ...(questionnaire
          ? {
              questionnaire: {
                text: questionnaire.text,
                sourceUrl: questionnaire.sourceUrl ?? questionnaireUrl.trim(),
                sheetTitle: questionnaire.sheetTitle,
                extractedFields: questionnaire.extractedFields
              }
            }
          : {})
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
        ...(questionnaire
          ? {
              questionnaire: {
                text: questionnaire.text,
                sourceUrl: questionnaire.sourceUrl ?? questionnaireUrl.trim(),
                sheetTitle: questionnaire.sheetTitle,
                extractedFields: questionnaire.extractedFields
              }
            }
          : {})
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
): Promise<OnboardingQuestionnaireSource | null> {
  const urlError = validateQuestionnaireGoogleSheetUrl(sheetUrl);
  if (urlError) throw new Error(urlError);

  const questionnaire = await readQuestionnaire(sheetUrl.trim());
  if (!questionnaire) return null;
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
            ? "Select a page to analyze, or choose another page and leave it blank to use GPT-5.6 Terra web discovery."
            : "Facebook is optional. Leave it blank to use GPT-5.6 Terra to find Thailand-focused brand details."}
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
              aria-label="Facebook URL"
              value={manualFacebookUrl}
              disabled={disabled}
              placeholder="https://www.facebook.com/brand.page"
              onChange={(event) =>
                onManualFacebookUrlChange(event.target.value)
              }
            />
            <small>
              Optional. Leave it blank to skip Facebook extraction and search
              Thailand-focused web sources with GPT-5.6 Terra.
            </small>
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
            : "Creative Compass reads a Questionnaire tab (including common naming variants) and extracts answered fields from its {{field_name}} placeholders."}
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
          <li>Questionnaire tab (read-only)</li>
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
        <span>Questionnaire Google Sheet URL</span>
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
          If the Sheet contains a Questionnaire tab (for example 1. Questionnaire
          or Questionaies), Creative Compass imports it as read-only onboarding
          context. If not, analysis continues without it.
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
        ...(questionnaire
          ? {
              questionnaire: {
                text: questionnaire.text,
                sourceUrl: questionnaire.sourceUrl ?? questionnaireUrl.trim(),
                sheetTitle: questionnaire.sheetTitle,
                extractedFields: questionnaire.extractedFields
              }
            }
          : {}),
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
          Questionnaire is used when its tab exists. Facebook is optional.
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
              aria-label="Facebook URL"
              value={facebookUrl}
              disabled={saving}
              placeholder="https://www.facebook.com/brand.page"
              onChange={(event) => setFacebookUrl(event.target.value)}
            />
            <small>
              Optional. Leave it blank to skip Facebook extraction and search
              Thailand-focused web sources with GPT-5.6 Terra.
            </small>
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
      return "Validating brand source";
    case "scraping_facebook_posts":
      return "Scraping Facebook posts";
    case "scraping_facebook_ads":
      return "Scraping Ads Library";
    case "searching_fallback":
      return "Searching Thailand web sources";
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

type BrandAssetCounts = Record<BrandAssetKind, number>;

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
  assetCounts,
  onAssetCountChange,
  onSectionChange,
  onClose
}: {
  state: WorkflowState;
  dispatch: Dispatch<WorkflowAction>;
  section: BrandProfileSection;
  assetCounts: BrandAssetCounts;
  onAssetCountChange: (kind: BrandAssetKind, count: number) => void;
  onSectionChange: (section: BrandProfileSection) => void;
  onClose: () => void;
}) {
  const brand = state.brand;
  if (!brand) return null;

  const counts: Record<BrandProfileSection, number> = {
    brand: brand.library.brand.length,
    products: brand.library.products.length,
    docs: brand.library.docs.length,
    refs: brand.library.refs.length + assetCounts.reference,
    materials: Math.max(assetCounts.material, state.uploadedMaterials.length),
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
                onAssetCountChange={onAssetCountChange}
              />
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function BrandProfileSectionContent({
  state,
  dispatch,
  section,
  onAssetCountChange
}: {
  state: WorkflowState;
  dispatch: Dispatch<WorkflowAction>;
  section: BrandProfileSection;
  onAssetCountChange: (kind: BrandAssetKind, count: number) => void;
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
        <BrandProductsMemoryList clientId={brand.id} dispatch={dispatch} />
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
          state={state}
          dispatch={dispatch}
          onAssetCountChange={onAssetCountChange}
        />
      ) : null}
      {section === "materials" ? (
        <BrandMaterialsMemoryList
          state={state}
          dispatch={dispatch}
          onAssetCountChange={onAssetCountChange}
        />
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
      if (!imported) {
        throw new Error("No supported Questionnaire tab was found in this Sheet.");
      }
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

function BrandProductsMemoryList({
  clientId,
  dispatch
}: {
  clientId: string;
  dispatch: Dispatch<WorkflowAction>;
}) {
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
  const syncProducts = useCallback(
    (items: readonly BrandProduct[]) => {
      setProducts(items);
      dispatch({
        type: "sync-brand-products",
        items: items.map((product) => ({
          id: product.id,
          title: product.name,
          description: product.description
        }))
      });
    },
    [dispatch]
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    void repository
      .listProducts(clientId)
      .then((items) => {
        if (!active) return;
        syncProducts(items);
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
  }, [clientId, repository, syncProducts]);

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
        syncProducts(
          products.map((product) =>
            product.id === updated.id ? updated : product
          )
        );
      } else {
        const created = await repository.createProduct({
          clientId,
          ...input
        });
        syncProducts([...products, created]);
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
      syncProducts(
        products.filter((candidate) => candidate.id !== product.id)
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

function sameLibraryItems(
  left: readonly LibraryItem[],
  right: readonly LibraryItem[]
): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const other = right[index];
      return (
        other?.id === item.id &&
        other.title === item.title &&
        other.description === item.description &&
        other.assetUrl === item.assetUrl
      );
    })
  );
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

  function commitBrandRules(nextItems: readonly LibraryItem[]) {
    setItems(nextItems);
    onBrandRulesSaved(nextItems);
  }

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
        if (rules.length && !sameLibraryItems(rules, initialItems)) {
          onBrandRulesSaved(rules);
        }
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
        commitBrandRules(upsertLibraryItem(items, updated));
      } else {
        const created = await repository.createBrandRule({
          clientId,
          title: nextTitle,
          description: nextDescription
        });
        commitBrandRules(upsertLibraryItem(items, created));
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
      commitBrandRules(items.filter((rule) => rule.id !== item.id));
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
          commitBrandRules(upsertLibraryItem(items, saved))
        }
      />
      <section className="brand-colors-section" aria-label="Brand colors">
        <ColorsCard
          clientId={clientId}
          ruleTitle="Colors"
          label="Primary colors"
          colorsItem={colorsItem}
          onSaved={(saved) =>
            commitBrandRules(upsertLibraryItem(items, saved))
          }
          onDeleted={(id) =>
            commitBrandRules(items.filter((item) => item.id !== id))
          }
        />
        <ColorsCard
          clientId={clientId}
          ruleTitle="Secondary colors"
          label="Secondary colors"
          colorsItem={secondaryColorsItem}
          onSaved={(saved) =>
            commitBrandRules(upsertLibraryItem(items, saved))
          }
          onDeleted={(id) =>
            commitBrandRules(items.filter((item) => item.id !== id))
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
            commitBrandRules(brandRules);
            onGuidelinesSaved(guidelines);
          }}
          onClose={() => setGuidelineDialogOpen(false)}
        />
      ) : null}
    </section>
  );
}

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

function BrandReferencesMemoryList({
  state,
  dispatch,
  onAssetCountChange
}: StageProps & {
  onAssetCountChange: (kind: BrandAssetKind, count: number) => void;
}) {
  return (
    <section className="memory-editor compass-brand-references">
      <CreativeMaterialsEditor
        state={state}
        dispatch={dispatch}
        kind="reference"
        legacyReferences={state.brand?.library.refs}
        onAssetCountChange={onAssetCountChange}
      />
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

const successMetricObjectives: Record<
  WorkflowState["successMetric"],
  string
> = {
  CTR: "Awareness",
  CVR: "Conversion",
  CPA: "Efficiency",
  ROAS: "Revenue"
};

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

function BrandMaterialsMemoryList({
  state,
  dispatch,
  onAssetCountChange
}: StageProps & {
  onAssetCountChange: (kind: BrandAssetKind, count: number) => void;
}) {
  return (
    <section className="memory-editor compass-brand-materials">
      <CreativeMaterialsEditor
        state={state}
        dispatch={dispatch}
        onAssetCountChange={onAssetCountChange}
      />
    </section>
  );
}

export function DirectionsStage({ state, dispatch }: StageProps) {
  const brandMemoryRepository = useBrandMemoryRepository();
  const [artworkContextSelection, setArtworkContextSelection] = useState(
    defaultArtworkContextSelection
  );
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
  const [albumFormatDirectionId, setAlbumFormatDirectionId] = useState<
    string | null
  >(null);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const preflightReferenceImages = state.referenceImages.filter(
    (reference) => inferredReferenceImageRole(reference) !== "logo"
  );
  const preflightAvailableReferences = [
    ...(state.brand?.library.refs ?? [])
      .filter((item) => item.assetUrl)
      .map((item) => {
        const selectedReference = preflightReferenceImages.find(
          (reference) => reference.url === item.assetUrl
        );
        return (
          selectedReference ?? {
            id: `library-${item.id}`,
            url: item.assetUrl as string,
            label: item.title || "Untitled",
            role: "style" as const
          }
        );
      })
      .filter(
        (reference) => inferredReferenceImageRole(reference) !== "logo"
      ),
    ...preflightReferenceImages.filter(
      (reference) =>
        !(state.brand?.library.refs ?? []).some(
          (item) => item.assetUrl === reference.url
        )
    )
  ];
  const [manualHookGroup, setManualHookGroup] = useState<{
    service: ServiceType;
    title: string;
  } | null>(null);
  const [generateMoreGroup, setGenerateMoreGroup] = useState<{
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
  } = useCreateSelectedHooks(state, dispatch, brandMemoryRepository);

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
      const brandName = state.brand?.name?.trim() || "Creative Compass";
      const safeBrandName = brandName
        .replace(/[\\/:*?"<>|]+/g, "-")
        .replace(/\s+/g, " ")
        .trim();
      const filename = `${safeBrandName || "Creative Compass"} - Creative Topics.pdf`;
      await exportCompassIdeasReviewPdf(
        review.sections,
        filename,
        review.highlightMap,
        brandName
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
  const preflightServiceOrder: Record<ServiceType, number> = {
    "single-static": 0,
    "album-post": 1,
    "ugc-video": 2,
    "motion-static": 3,
    resize: 4
  };
  const preflightDirections = state.directions
    .filter((direction) => direction.selected)
    .slice()
    .sort(
      (left, right) =>
        preflightServiceOrder[left.service ?? state.service] -
        preflightServiceOrder[right.service ?? state.service]
    );
  const preflightContext = {
    runId: state.id,
    brief: state.brief,
    brandContext: state.brand
      ? {
          name: state.brand.name,
          category: state.brand.category,
          products: selectedBrandProducts(state).map((item) =>
            item.description.trim()
              ? `${item.title}: ${item.description}`
              : item.title
          ),
          documents: state.brand.library.docs.map((item) =>
            item.description.trim()
              ? `${item.title}: ${item.description}`
              : item.title
          ),
          working: state.brand.memory.working,
          avoid: state.brand.memory.avoid
        }
      : null
  };
  const preflightRevisionFeedback = state.outputs.reduce<
    Record<string, string>
  >((feedbackByDirection, output) => {
    const feedback = Object.values(output.approvalComments)
      .map((comment) => comment.trim())
      .filter(Boolean);
    if (!feedback.length) return feedbackByDirection;
    const previous = feedbackByDirection[output.directionId];
    feedbackByDirection[output.directionId] = [
      previous,
      ...feedback
    ].filter(Boolean).join("\n");
    return feedbackByDirection;
  }, {});

  const editingDirection = state.directions.find(
    (direction) => direction.id === editingDirectionId
  );
  const regeneratingDirection = state.directions.find(
    (direction) => direction.id === regeneratingDirectionId
  );
  const albumFormatDirection = state.directions.find(
    (direction) => direction.id === albumFormatDirectionId
  );

  function handleDeleteDirection(directionId: string) {
    if (!window.confirm("Delete this hook option?")) return;
    dispatch({ type: "delete-direction", id: directionId });
  }

  function handleToggleDirection(
    direction: WorkflowState["directions"][number]
  ) {
    const selectingAlbum =
      direction.service === "album-post" && !direction.selected;
    dispatch({ type: "toggle-direction", id: direction.id });
    if (selectingAlbum) setAlbumFormatDirectionId(direction.id);
  }

  return (
    <DecisionCard
      eyebrow="Create · Hooks"
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
            onClick={() => setPreflightOpen(true)}
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
      <div className="direction-tools compass-angle-toolbar">
        <div>
          <h3>Review hooks</h3>
          <p>
            Select up to {requiredCount} hooks. Selected hooks export as
            Recommended; the rest stay as Options until deleted.
          </p>
        </div>
        <div className="compass-angle-toolbar-actions">
          <HookGenerationModelSelect
            disabled={
              generatingMore ||
              regeneratingAllHooks ||
              Boolean(regeneratingHookId)
            }
            state={state}
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
      {preflightOpen ? (
        <PreflightModal
          directions={preflightDirections}
          fallbackService={state.service}
          context={preflightContext}
          revisionFeedbackByDirectionId={preflightRevisionFeedback}
          artworkBrief={state.artworkBrief}
          onArtworkBriefChange={(brief) =>
            dispatch({ type: "set-artwork-brief", brief })
          }
          contextSelection={artworkContextSelection}
          onContextSelectionChange={setArtworkContextSelection}
          contextAvailability={{
            brandCiCount:
              (state.brand?.library.docs.length ?? 0) +
              (state.brand?.library.brand.filter((item) =>
                isCiOrGuidelineTitle(item.title)
              ).length ?? 0),
            brandColorCount: Array.from(
              new Set([
                ...extractColorSwatches(
                  findRuleByTitle(state.brand?.library.brand ?? [], "Colors")
                ),
                ...extractColorSwatches(
                  findRuleByTitle(
                    state.brand?.library.brand ?? [],
                    "Secondary colors"
                  )
                )
              ])
            ).length
          }}
          artworkMode={state.artworkMode}
          onArtworkModeChange={(mode) =>
            dispatch({ type: "set-artwork-mode", mode })
          }
          visualInputs={{
            referenceCount: preflightReferenceImages.length,
            materialCount: selectedUploadedMaterials(state).length,
            referencePreview: (
              <ConfirmationReferenceGrid
                references={preflightAvailableReferences}
                selectedReferences={preflightReferenceImages}
                onToggle={(reference) =>
                  dispatch({
                    type: "toggle-reference-image",
                    item: reference
                  })
                }
              />
            ),
            referenceEditor: (
              <CreativeMaterialsEditor
                state={{
                  ...state,
                  referenceImages: preflightReferenceImages
                }}
                dispatch={dispatch}
                kind="reference"
                legacyReferences={state.brand?.library.refs ?? []}
              />
            ),
            materialEditor: (
              <CreativeMaterialsEditor
                state={state}
                dispatch={dispatch}
                kind="material"
              />
            )
          }}
          onCancel={() => setPreflightOpen(false)}
          onContinue={() => {
            setPreflightOpen(false);
            createSelectedHooks(artworkContextSelection);
          }}
        />
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
                    onClick={() =>
                      setGenerateMoreGroup({
                        service: group.service,
                        title: group.contentType
                      })
                    }
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
            <div
              className={`compass-model-comparison ${group.modelGroups.length > 1 ? "is-comparing" : ""}`}
            >
              {group.modelGroups.map((modelGroup) => (
                <section
                  className="compass-model-column"
                  key={`${group.service}-${modelGroup.key}`}
                  aria-label={`${modelGroup.label} comparison`}
                >
                  <header className="compass-model-column-head">
                    <div>
                      <h4>{modelGroup.label}</h4>
                      <p>{modelGroup.provider}</p>
                    </div>
                    <span>{modelGroup.directions.length} ideas</span>
                  </header>
                  <div className="direction-grid compass-angle-grid compass-model-idea-grid">
              {modelGroup.directions.map(({ direction, originalIndex }, groupIndex) => (
          <article
            className={`direction-card compass-angle-card ${direction.selected ? "selected" : ""}`}
            key={direction.id}
          >
            <button
              className="compass-angle-card-select-surface"
              type="button"
              aria-label={`${direction.selected ? "Deselect" : "Select"} Idea ${originalIndex + 1} card`}
              aria-pressed={direction.selected}
              onClick={() => handleToggleDirection(direction)}
            />
            <div className="compass-angle-card-top">
              <div>
                <div className="compass-angle-badge-row">
                  <span className="compass-angle-idea-pill">Idea {groupIndex + 1}</span>
                  <span className="compass-angle-format-pill">
                    {group.contentType}
                  </span>
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
            {directionSubheadline(direction) ? (
              <div className="compass-angle-copy-block">
                <span className="compass-angle-card-kicker">
                  {angleSubheadlineLabel(group.service)}
                </span>
                <AngleSubheadline
                  text={directionSubheadline(direction)}
                  highlight={direction.subheadlineHighlight}
                />
              </div>
            ) : null}
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
            {group.service === "album-post" ? (
              <div className="angle-album-format-slot">
                {direction.selected ? (
                  <button
                    className="angle-album-format"
                    type="button"
                    aria-label={`Choose Album format for Idea ${groupIndex + 1}`}
                    onClick={() => setAlbumFormatDirectionId(direction.id)}
                  >
                    <AlbumFormatThumb
                      format={direction.albumFormat ?? "three-horizontal"}
                    />
                    <span className="angle-album-format-copy">
                      <b>
                        {albumFormatLabel(
                          direction.albumFormat ?? "three-horizontal"
                        )}
                      </b>
                      <small>Album feed format</small>
                    </span>
                    <strong>›</strong>
                  </button>
                ) : (
                  <div className="angle-album-placeholder" aria-hidden="true">
                    <AlbumFormatThumb
                      format={direction.albumFormat ?? "three-horizontal"}
                    />
                    <span>
                      <b>Album format</b>
                      <small>Available after selection</small>
                    </span>
                  </div>
                )}
              </div>
            ) : null}
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
      {generateMoreGroup ? (
        <GenerateMoreIdeasModal
          contentType={generateMoreGroup.title}
          onClose={() => setGenerateMoreGroup(null)}
          onGenerate={(direction) => {
            const service = generateMoreGroup.service;
            setGenerateMoreGroup(null);
            generateMore(service, direction);
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
      {albumFormatDirection ? (
        <AlbumFormatModal
          direction={albumFormatDirection}
          onClose={() => setAlbumFormatDirectionId(null)}
          onApply={(format) => {
            dispatch({
              type: "set-direction-album-format",
              id: albumFormatDirection.id,
              format
            });
            setAlbumFormatDirectionId(null);
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
  if (service === "album-post") return "Inside slides";
  if (service === "ugc-video") return "UGC video flow";
  return "Motion flow";
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
    pillar.trim() && hook.trim() && cta.trim()
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
            <span>Sub-headline (optional)</span>
            <textarea
              aria-label="Sub-headline"
              rows={3}
              value={subheadline}
              placeholder="Add only when it contributes something the hook does not already say."
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

function GenerateMoreIdeasModal({
  contentType,
  onClose,
  onGenerate
}: {
  contentType: string;
  onClose: () => void;
  onGenerate: (direction: string) => void;
}) {
  const [direction, setDirection] = useState("");

  return (
    <div className="output-modal-backdrop" onClick={onClose}>
      <div
        className="output-modal hook-regenerate-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="generate-more-ideas-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="output-modal-head">
          <div>
            <p className="eyebrow">Generate more ideas</p>
            <h3 id="generate-more-ideas-title">
              More {contentType} ideas
            </h3>
          </div>
          <button className="btn ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <label className="output-modal-prompt-label">
          <span>What kind of ideas do you want? (optional)</span>
          <textarea
            rows={5}
            value={direction}
            autoFocus
            maxLength={3000}
            placeholder="Example: Explore quieter premium moments, unusual camera angles, and ideas that make the product part of a real daily ritual."
            onChange={(event) => setDirection(event.target.value)}
          />
        </label>
        <p className="hook-regenerate-note">
          Leave this blank to let Creative Compass find a different direction
          from the current hooks.
        </p>
        <div className="output-modal-actions">
          <button className="btn secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            type="button"
            onClick={() => onGenerate(direction)}
          >
            Generate ideas
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
  const fixingCount = creativeGroups.filter((outputs) =>
    outputs.some((output) => output.clientStatus === "revision")
  ).length;
  const allApproved =
    creativeGroups.length > 0 && approvedCount === creativeGroups.length;
  const [revisionOutputId, setRevisionOutputId] = useState<string | null>(null);
  const [previewOutputId, setPreviewOutputId] = useState<string | null>(null);
  const [approvalOutputId, setApprovalOutputId] = useState<string | null>(null);
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
  const approvalOutputs =
    creativeGroups.find((outputs) =>
      outputs.some((output) => output.id === approvalOutputId)
    ) ?? [];
  const approvalOutput = approvalOutputs[0];
  const approvalDirection = state.directions.find(
    (direction) => direction.id === approvalOutput?.directionId
  );
  const approvalGroupIndex = approvalOutput
    ? creativeGroups.findIndex((outputs) =>
        outputs.some((output) => output.id === approvalOutput.id)
      )
    : -1;

  useEffect(() => {
    if (canEdit && !state.clientSent && !sendClientBlocked) {
      dispatch(sendClientAction);
    }
  }, [canEdit, dispatch, sendClientBlocked, state.clientSent]);

  useEffect(() => {
    if (!approvalOutputId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setApprovalOutputId(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [approvalOutputId]);

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
        "Choose Artwork, Caption, or Both and add one clear change instruction."
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

  return (
    <DecisionCard
      eyebrow="Client Review · Per creative"
      title="Turn every comment into a clear fix task."
      helper="The client chooses Artwork, Caption, or Both and leaves one actionable comment. Creative Compass routes the work internally and sends it back to the client only after PM rechecks it."
      status={
        fixingCount
          ? `${approvedCount} approved · ${fixingCount} fixing`
          : `${approvedCount} / ${creativeGroups.length} approved`
      }
      statusClass={allApproved ? "green" : fixingCount ? "amber" : "blue"}
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
              className="btn primary"
              type="button"
              disabled={!canEdit || Boolean(deliverBlocked)}
              title={deliverBlocked ?? undefined}
              onClick={() => dispatch(deliverAction)}
            >
              Complete delivery →
            </button>
          </div>
        </>
      }
    >
      <section className="client-flow-note compass-client-flow-note">
        <div>
          <b>Client comments do not reopen Create.</b>
          <p>
            The affected creative moves to Internal QC while other approved
            creatives remain ready for delivery.
          </p>
        </div>
        <div
          className="client-flow-route compass-client-flow-route"
          aria-label="Client revision route"
        >
          <span>Client comment</span>
          <i aria-hidden="true">→</i>
          <span>Fix owner</span>
          <i aria-hidden="true">→</i>
          <span>PM recheck</span>
          <i aria-hidden="true">→</i>
          <span>Client</span>
        </div>
      </section>
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
          const unapproveBlocked = outputs
            .map((candidate) =>
              workflowActionBlockReason(state, {
                type: "unapprove-output",
                id: candidate.id
              })
            )
            .find(Boolean);
          const feedbackOutput = outputs.find(
            (candidate) =>
              candidate.approvalComments.graphicDesign.trim() ||
              candidate.approvalComments.clientService.trim()
          );
          const artworkFeedback =
            feedbackOutput?.approvalComments.graphicDesign.trim() ?? "";
          const captionFeedback =
            feedbackOutput?.approvalComments.clientService.trim() ?? "";
          const feedbackComment = artworkFeedback || captionFeedback;
          const feedbackLabel =
            artworkFeedback && captionFeedback
              ? "Artwork + caption · GD → CS"
              : artworkFeedback
                ? "Artwork · GD"
                : captionFeedback
                  ? `${isUgcOutput(output) ? "Script" : "Caption"} · CS`
                  : "";
          const hasReturnedFeedback =
            Boolean(feedbackComment) &&
            (clientStatus === "revision" || output.revisionCount > 0);
          const statusLabel =
            clientStatus === "approved"
              ? "Approved"
              : clientStatus === "revision"
                ? "Internal fix in progress"
                : hasReturnedFeedback
                  ? "Ready to recheck"
                  : "Awaiting decision";
          const statusClass =
            clientStatus === "approved"
              ? "green"
              : clientStatus === "revision"
                ? "amber"
                : "blue";
          return (
            <article
              className={`client-card compass-client-card ${
                clientStatus === "revision"
                  ? "revision fixing"
                  : clientStatus === "approved"
                    ? "approved"
                    : hasReturnedFeedback
                      ? "resubmitted"
                      : "sent"
              }`}
              key={output.id}
            >
              <button
                className={`preview-area client-preview compass-client-preview compass-view-preview-button${
                  album ? " album-client-preview" : ""
                }`}
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
                      {direction && directionSubheadline(direction) ? (
                        <p>{directionSubheadline(direction)}</p>
                      ) : null}
                      <span>Learn more</span>
                    </div>
                  </div>
                )}
              </button>
              <div className="client-body client-card-body compass-client-card-body">
                <div className="client-state-row compass-client-state-row">
                  <span className={`badge ${statusClass}`}>{statusLabel}</span>
                  <small>
                    {qcContentTypeLabel(output)} · V{output.revisionCount + 1}
                  </small>
                </div>
                <div className="compass-client-card-copy">
                  <h3>{clientCreativeTitle(output, index)}</h3>
                  <p>{direction?.hook ?? `Creative ${index + 1}`}</p>
                </div>
                <div className="client-caption compass-client-caption">
                  <b>{isUgcOutput(output) ? "Caption / script" : "Caption"}</b>
                  <p>{direction?.caption ?? "No caption provided."}</p>
                </div>
                {hasReturnedFeedback ? (
                  <div className="client-feedback-summary">
                    <b>{feedbackLabel}</b>
                    {feedbackComment}
                  </div>
                ) : null}
                <div className="client-actions compass-client-card-actions">
                  {clientStatus === "approved" ? (
                    <button
                      className="btn small undo-approval"
                      type="button"
                      disabled={!canEdit || Boolean(unapproveBlocked)}
                      title={unapproveBlocked ?? undefined}
                      onClick={() => {
                        outputs.forEach((candidate) => {
                          dispatch({
                            type: "unapprove-output",
                            id: candidate.id
                          });
                        });
                      }}
                    >
                      Undo approval
                    </button>
                  ) : (
                    <>
                      <button
                        className="btn small"
                        type="button"
                        disabled={
                          !canEdit ||
                          !state.clientSent ||
                          clientStatus === "revision"
                        }
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
                        disabled={
                          !canEdit ||
                          Boolean(approveBlocked) ||
                          clientStatus === "revision"
                        }
                        title={approveBlocked ?? undefined}
                        onClick={() => setApprovalOutputId(output.id)}
                      >
                        Approve creative
                      </button>
                    </>
                  )}
                </div>
                <div className="client-note compass-client-decision-note">
                  {clientStatus === "approved"
                    ? "Approved and ready for delivery. You can undo before completing delivery."
                    : clientStatus === "revision"
                      ? "The fix is with the internal owner. PM will recheck it before it returns here."
                      : hasReturnedFeedback
                        ? "Updated version returned after PM recheck."
                        : "Waiting for the client decision."}
                </div>
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
          brandName={state.brand?.name}
          onClose={() => setPreviewOutputId(null)}
        />
      ) : null}
      {approvalOutput ? (
        <div
          className="output-modal-backdrop compass-client-approve-backdrop"
          onClick={() => setApprovalOutputId(null)}
        >
          <div
            className="output-modal compass-client-approve-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-approve-title"
            aria-describedby="client-approve-description"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="compass-client-approve-mark" aria-hidden="true">
              ✓
            </span>
            <h3 id="client-approve-title">Approve this creative?</h3>
            <p
              className="compass-client-approve-sub"
              id="client-approve-description"
            >
              This marks V{approvalOutput.revisionCount + 1} as ready for
              delivery.
            </p>
            <div className="compass-client-approve-asset">
              <b>
                {clientCreativeTitle(
                  approvalOutput,
                  Math.max(approvalGroupIndex, 0)
                )}{" "}
                · V{approvalOutput.revisionCount + 1}
              </b>
              <span>
                {qcContentTypeLabel(approvalOutput)} ·{" "}
                {approvalDirection?.hook ?? "Creative"}
              </span>
            </div>
            <p className="compass-client-approve-note">
              You can undo the approval from the card until delivery is
              completed.
            </p>
            <div className="output-modal-actions compass-client-approve-actions">
              <button
                className="btn"
                type="button"
                autoFocus
                onClick={() => setApprovalOutputId(null)}
              >
                Cancel
              </button>
              <button
                className="btn lime compass-client-confirm-approval"
                type="button"
                onClick={() => {
                  approvalOutputs.forEach((candidate) => {
                    if (candidate.clientStatus !== "approved") {
                      dispatch({
                        type: "approve-output",
                        id: candidate.id
                      });
                    }
                  });
                  setApprovalOutputId(null);
                }}
              >
                Confirm approval
              </button>
            </div>
          </div>
        </div>
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
                        ? isUgcOutput(revisionOutput)
                          ? "Script"
                          : "Caption"
                        : "Both"}
                  </button>
                ))}
              </div>
            </div>
            <div className="compass-qc-route-preview">
              {revisionTarget === "graphicDesign"
                ? "Artwork change · Update and replace the visual in Internal QC."
                : revisionTarget === "clientService"
                  ? `${isUgcOutput(revisionOutput) ? "Script" : "Caption"} change · Update the hook, caption, script, or client-facing details.`
                  : revisionTarget === "both"
                    ? "Both · Update the artwork first, then the caption or script."
                    : `Choose Artwork, ${isUgcOutput(revisionOutput) ? "Script" : "Caption"}, or Both to route this request.`}
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
  onCreateRun,
  onOpenWorkboard
}: StageProps & {
  onCreateRun: () => void;
  onOpenWorkboard: () => void;
}) {
  const doneAction: WorkflowAction = { type: "mark-done" };
  const doneBlocked = workflowActionBlockReason(state, doneAction);
  const creativeGroups = groupOutputsForReview(state.outputs);
  const approvedCreativeCount = creativeGroups.filter((outputs) =>
    outputs.every((output) => output.clientStatus === "approved")
  ).length;
  const shippedDirections = state.directions.filter((direction) =>
    state.outputs.some((output) => output.directionId === direction.id)
  );
  const elapsedDays = Math.max(
    0,
    (Date.parse(state.updatedAt) - Date.parse(state.createdAt)) /
      (1000 * 60 * 60 * 24)
  );
  const elapsedLabel = Number.isFinite(elapsedDays)
    ? elapsedDays < 0.1
      ? "<0.1d"
      : `${elapsedDays.toFixed(1)}d`
    : "—";
  const capturedLearnings = summaryCapturedLearnings(state);
  const savedReferenceCount = state.outputs.filter(
    (output) => output.savedToReferences
  ).length;

  const finishRun = () => {
    if (!doneBlocked) dispatch(doneAction);
  };

  return (
    <DecisionCard
      eyebrow="Learn · Captured automatically"
      title="Delivery complete. Memory updated."
      helper="Creative hypotheses, approvals, revision routes, and patterns are saved without adding another blocking team step."
      status="Memory updated"
      statusClass="green"
      className="compass-stage-learn"
      actions={
        <>
          <span className="pill green compass-learn-memory-pill">
            Creative memory compounds
          </span>
          <div className="compass-learn-footer-actions">
            <button
              className="btn secondary download-action"
              type="button"
              disabled={!state.outputs.some((output) => output.assetUrl)}
              onClick={() => void downloadAllOutputs(state.outputs)}
            >
              Download all
            </button>
            <button
              className="btn"
              type="button"
              disabled={Boolean(doneBlocked)}
              title={doneBlocked ?? undefined}
              onClick={() => {
                finishRun();
                onOpenWorkboard();
              }}
            >
              View workboard
            </button>
            <button
              className="btn orange"
              type="button"
              disabled={Boolean(doneBlocked)}
              title={doneBlocked ?? undefined}
              onClick={() => {
                finishRun();
                onCreateRun();
              }}
            >
              Start the next run →
            </button>
          </div>
        </>
      }
    >
      <div className="learn-hero compass-learn-hero">
        <section className="learn-card dark compass-learn-shipped">
          <h3>
            The creative set is shipped.
            <br />
            Now let the evidence talk.
          </h3>
          <p>
            Performance feedback will attach to the exact hook, format, and
            visual pattern that created it.
          </p>
          <div className="metric-cards compass-learn-metrics">
            <Metric
              value={String(approvedCreativeCount)}
              label="approved creatives"
            />
            <Metric
              value={String(shippedDirections.length)}
              label="hypotheses shipped"
            />
            <Metric value={elapsedLabel} label="idea-to-launch" />
          </div>
        </section>
        <section className="learn-card compass-learn-captured">
          <h3>What Creative Compass learned</h3>
          <div className="learning-list compass-learn-list">
            {capturedLearnings.map((learning) => (
              <div className="learning-line" key={learning.title}>
                <b>{learning.title}</b>
                <p>{learning.detail}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="memory-update compass-memory-update">
        <article className="memory-update-card">
          <span className="learn-icon">↗</span>
          <h3>Working pattern captured</h3>
          <p>
            Approval decisions and revision routes from this run are preserved
            as evidence for the next learning review.
          </p>
        </article>
        <article className="memory-update-card">
          <span className="learn-icon orange">✦</span>
          <h3>
            {savedReferenceCount
              ? "Approved creative saved"
              : "Approved creative ready"}
          </h3>
          <p>
            {savedReferenceCount
              ? `${savedReferenceCount} approved creative${savedReferenceCount === 1 ? " is" : "s are"} available in the reference library.`
              : "The delivered set remains attached to its hypotheses and can be saved to the reference library."}
          </p>
        </article>
        <article className="memory-update-card">
          <span className="learn-icon blue">∞</span>
          <h3>Next test ready</h3>
          <p>
            Creative Compass can turn an approved hypothesis into one
            controlled variation instead of starting the next run from zero.
          </p>
        </article>
      </div>
      <LearningSuggestionsPanel state={state} />
    </DecisionCard>
  );
}

function summaryCapturedLearnings(
  state: WorkflowState
): readonly { title: string; detail: string }[] {
  const working = state.brand?.memory.working.slice(0, 3) ?? [];
  if (working.length) {
    return working.map((note, index) => ({
      title: `Working pattern ${index + 1}`,
      detail: presentBrandMemoryText(note).text
    }));
  }

  const shippedDirections = state.directions.filter((direction) =>
    state.outputs.some((output) => output.directionId === direction.id)
  );
  const directionLearnings = shippedDirections.slice(0, 3).map((direction) => ({
    title: direction.hook,
    detail:
      direction.why ||
      direction.concept ||
      "The approved hypothesis stays attached to this delivered creative."
  }));
  if (directionLearnings.length) return directionLearnings;

  return [
    {
      title: "Delivery evidence captured.",
      detail:
        "Approved creatives, review decisions, and revision routes remain attached to this run."
    }
  ];
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
const WORKBOARD_PAGE_SIZE = 5;

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
  const [visibleLimitByClient, setVisibleLimitByClient] = useState<
    Record<string, number>
  >({});

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
      if (a.run && b.run) {
        return Date.parse(b.run.updatedAt) - Date.parse(a.run.updatedAt);
      }
      if (a.run) return -1;
      if (b.run) return 1;
      return a.brand.name.localeCompare(b.brand.name);
    });
  type ProjectRow = (typeof projectRows)[number];
  function groupProjects(rows: ProjectRow[]) {
    return Array.from(
      rows
        .reduce(
          (groups, row) => {
            const existing = groups.get(row.brand.id);
            if (existing) {
              existing.projects.push(row);
            } else {
              groups.set(row.brand.id, {
                brand: row.brand,
                projects: [row]
              });
            }
            return groups;
          },
          new Map<string, { brand: Brand; projects: ProjectRow[] }>()
        )
        .values()
    );
  }
  const projectGroups = groupProjects(projectRows);
  const visibleProjectGroups = projectGroups.map((group) => ({
    ...group,
    totalProjectCount: group.projects.length,
    projects: group.projects.slice(
      0,
      visibleLimitByClient[group.brand.id] ?? WORKBOARD_PAGE_SIZE
    )
  }));
  const visibleProjectCount = visibleProjectGroups.reduce(
    (count, group) => count + group.projects.length,
    0
  );
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
                setVisibleLimitByClient({});
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
                  setVisibleLimitByClient({});
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="workboard-result-count">
            {loading
              ? "Loading projects"
              : `${visibleProjectGroups.length} ${pluralize(
                  visibleProjectGroups.length,
                  "client"
                )} · ${visibleProjectCount} ${pluralize(
                  visibleProjectCount,
                  "project"
                )} shown`}
          </span>
        </div>

        <div className="workboard-project-table-head" aria-hidden="true">
          <span>Project</span>
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
          {visibleProjectGroups.map(
            ({ brand, projects, totalProjectCount }) => (
            <section
              className="workboard-client-group"
              aria-label={`Projects for ${brand.name}`}
              key={brand.id}
            >
              <header className="workboard-client-group-head">
                <div className="workboard-client-main">
                  <span className="avatar ov-av" aria-hidden="true">
                    <BrandLogo brand={brand} />
                  </span>
                  <span>
                    <b>{brand.name}</b>
                    <small>{brand.category || "Uncategorised client"}</small>
                  </span>
                </div>
                <span className="workboard-client-project-count">
                  {totalProjectCount}{" "}
                  {pluralize(totalProjectCount, "project")}
                </span>
                <ClientPicControl clientId={brand.id} />
              </header>
              <div className="workboard-client-projects">
                {projects.map(
                  ({
                    key,
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
                      ownerUserId &&
                        ownerUserId === collaboration?.currentUserId
                    );
                    const ownerName = run
                      ? owner?.displayName ??
                        (collaboration?.enabled
                          ? "Owner pending"
                          : "Current user")
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
                        className={`workboard-project-row ${attention?.urgent ? "urgent" : ""}`}
                        key={key}
                      >
                        <div className="workboard-project-main">
                          <span
                            className="workboard-project-icon"
                            aria-hidden="true"
                          >
                            <Sparkle size={16} weight="duotone" />
                          </span>
                          <span>
                            <b>{projectName}</b>
                            <small>{projectMeta}</small>
                          </span>
                        </div>
                        <div className="workboard-client-status">
                          <span className={`workboard-status ${status.tone}`}>
                            {status.label}
                          </span>
                          <small>{status.detail}</small>
                        </div>
                        <div className="workboard-project-owner">
                          <span
                            className="workboard-owner-avatar"
                            aria-hidden="true"
                          >
                            {initials(ownerName) || "NA"}
                          </span>
                          <span>
                            <b>{ownerName}</b>
                            <small>{ownerMeta}</small>
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
                                ? "You cannot start a new project."
                                : undefined
                            }
                            onClick={() => openProject(brand, run)}
                          >
                            {run ? "Open" : "Start"}
                            <ArrowRight
                              size={14}
                              weight="bold"
                              aria-hidden="true"
                            />
                          </button>
                        </div>
                      </article>
                    );
                  }
                )}
              </div>
              {projects.length < totalProjectCount ? (
                <div className="workboard-client-load-more">
                  <span>
                    Showing {projects.length} of {totalProjectCount} projects
                  </span>
                  <button
                    className="btn small"
                    type="button"
                    onClick={() =>
                      setVisibleLimitByClient((current) => ({
                        ...current,
                        [brand.id]:
                          (current[brand.id] ?? WORKBOARD_PAGE_SIZE) +
                          WORKBOARD_PAGE_SIZE
                      }))
                    }
                  >
                    See more
                  </button>
                </div>
              ) : null}
            </section>
            )
          )}
        </div>

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
