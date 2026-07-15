import {
  useEffect,
  useState,
  type ChangeEvent,
  type Dispatch,
  type ReactNode
} from "react";
import {
  canSelectBrand,
  canStartBrandIngestion,
  type Brand,
  type LibraryItem
} from "../../domain/brand";
import {
  brandDocumentTypeLabels,
  brandDocumentTypes,
  type BrandDocument,
  type BrandDocumentType,
  type BrandPastWorkItem,
  type BrandProduct
} from "../../domain/brand-memory";
import {
  artworkOutputSizeLabel,
  artworkOutputSizes,
  creativeMaterialRoles,
  type AngleExportGroup,
  type ApprovalRole,
  type CreativeOutput,
  type CreativeMaterialRole,
  type ServiceType
} from "../../domain/creative-run";
import {
  directionSubheadline,
  resolveSubheadlineHighlight
} from "../../domain/subheadline-highlight";
import {
  CS_QUALITY_CHECKLIST,
  GD_QUALITY_CHECKLIST
} from "../../domain/quality-check";
import { useBrandMemoryRepository } from "../../app/providers/brand-memory-provider";
import { useBrands } from "../../app/providers/brand-provider";
import { useClientIntakeRepository } from "../../app/providers/client-intake-provider";
import { validateFacebookUrl } from "../../domain/client-ingestion";
import { regenerateOutputImage } from "../../services/artwork-generation/openai-image-generation";
import { uploadReplacementAsset } from "../../services/artwork-generation/replace-output-asset";
import { uploadCreativeMaterial } from "../../services/creative-materials/upload-creative-material";
import {
  suggestBrandLearning,
  type LearningSuggestion
} from "../../services/brand-learning/suggest-brand-learning";
import { getFileNames } from "../../shared/utils/files";
import { playGenerationSuccessSound } from "../../shared/utils/notification-sound";
import { pluralize } from "../../shared/utils/text";
import { serviceLabels } from "./config";
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
import { creativeMixItems, totalCreativeMixQuantity } from "./model";
import { selectedDirectionCount, workflowActionBlockReason } from "./rules";
import { presentBrandMemoryText } from "./brand-memory-presentation";
import { useCreateSelectedHooks } from "./use-create-selected-hooks";
import {
  useGenerateHooks,
  useGenerateMoreHooks,
  useRegenerateAllHooks,
  useRegenerateHook
} from "./use-generate-hooks";
import { useRunQualityCheck } from "./use-run-quality-check";

interface StageProps {
  state: WorkflowState;
  dispatch: Dispatch<WorkflowAction>;
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
  const continueAction: WorkflowAction = { type: "set-stage", stage: "brief" };
  const continueBlocked = workflowActionBlockReason(state, continueAction);
  const search = state.brandSearch.trim().toLowerCase();
  const visibleBrands = brands.filter((brand) =>
    `${brand.name} ${brand.category} ${brand.mappingStatus ?? ""} ${brand.serviceStatus ?? ""}`
      .toLowerCase()
      .includes(search)
  );

  return (
    <DecisionCard
      eyebrow="01 / Signal"
      title="Start with what the brand already knows."
      helper="Choose a brand to load its voice, visual rules, product truths, approved work, and creative learnings."
      status={state.brand ? "Memory loaded" : "Memory waiting"}
      statusClass={state.brand ? "green" : "blue"}
      className="neo-signal-stage"
      actions={
        <>
          <span className="pill neo-signal-before-output">
            Signal before output
          </span>
          <div className="neo-signal-footer-actions">
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
      <div className="neo-start-grid">
        <section className="neo-brand-select-card">
          <span className="neo-card-label">Brand workspace</span>
          <div className="dropdown">
            <button
              className="select-btn"
              type="button"
              aria-haspopup="listbox"
              aria-expanded={state.brandMenuOpen}
              onClick={() => dispatch({ type: "toggle-brand-menu" })}
            >
              <span className="select-left">
                <span className="avatar neo-brand-select-avatar">
                  {state.brand?.initials ?? "NE"}
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
                onCreated={refresh}
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
                      <span className="avatar">{brand.initials}</span>
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
                          {canAddMapping ? "Add to Neo" : "Set up brand"}
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
                    <span className="avatar">{brand.initials}</span>
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
          {setupBrand ? (
            <ExistingBrandSetupPanel
              key={setupBrand.id}
              brand={setupBrand}
              onCancel={() => setSetupBrand(null)}
              onQueued={async () => {
                await refresh();
                setSetupBrand(null);
              }}
            />
          ) : null}
          {mappingBrand ? (
            <MappingBrandSetupPanel
              key={mappingBrand.id}
              brand={mappingBrand}
              onCancel={() => setMappingBrand(null)}
              onCreated={async () => {
                await refresh();
                setMappingBrand(null);
              }}
            />
          ) : null}
          {!state.brand ? (
            <div className="neo-start-blank">
              <b>Brand context is your unfair advantage.</b>
              <p>
                neo keeps approved references, uploaded brand materials, and
                past performance close to every creative decision.
              </p>
            </div>
          ) : (
            <div className="neo-start-blank">
              <b>{state.brand.name} context is ready.</b>
              <p>
                Voice, visual rules, products, references, and creative
                learnings are connected to this run.
              </p>
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
          section={profileSection}
          onSectionChange={setProfileSection}
        />
      </div>
      {state.brand && libraryOpen ? (
        <BrandLibraryModal
          state={state}
          section={profileSection}
          onSectionChange={setProfileSection}
          onClose={() => {
            setLibraryOpen(false);
            setMemoryRevision((current) => current + 1);
          }}
        />
      ) : null}
    </DecisionCard>
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
    [
      "Business context",
      (brand?.memory.working.length ?? 0) + (brand?.memory.avoid.length ?? 0),
      "learning"
    ],
    ["Product list & info", brand?.library.products.length ?? 0, "products"]
  ];
  const total = rows.reduce((sum, [, count]) => sum + count, 0);

  return (
    <section className="neo-material-uploader">
      <div className="neo-materials-head">
        <div>
          <b>Brand materials</b>
          <small>
            Keep the source context close without taking over the welcome page.
          </small>
        </div>
        <div className="neo-materials-head-actions">
          <span className="pill blue">{total} files</span>
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
      <div className="neo-materials-compact-grid">
        {rows.map(([label, count, section], index) => (
          <div
            className={`neo-material-compact-row ${index === rows.length - 1 ? "wide" : ""}`}
            key={label}
          >
            <div>
              <b>{label}</b>
              <span>{count} files</span>
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
  onCreated: () => Promise<void>;
}) {
  const repository = useClientIntakeRepository();
  const [facebookUrl, setFacebookUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createAndQueue() {
    const urlError = validateFacebookUrl(facebookUrl);
    if (urlError) {
      setError(urlError);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await repository.createDraftClient({
        name: brand.name,
        facebookUrl: facebookUrl.trim()
      });
      await onCreated();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not add this client to Neo."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="client-intake-card">
      <div className="client-intake-heading">
        <span>Add {brand.name} to Neo</span>
        <small>
          This client exists in the mapping sheet but has no Neo data yet.
        </small>
      </div>
      <div className="client-intake-form">
        <label>
          <span>Facebook URL</span>
          <input
            value={facebookUrl}
            disabled={saving}
            placeholder="https://www.facebook.com/brand.page"
            onChange={(event) => setFacebookUrl(event.target.value)}
          />
        </label>
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
            {saving ? "Adding..." : "Add and analyze"}
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
  onQueued: () => Promise<void>;
}) {
  const repository = useClientIntakeRepository();
  const [facebookUrl, setFacebookUrl] = useState(brand.facebookUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function queueIngestion() {
    const urlError = validateFacebookUrl(facebookUrl);
    if (urlError) {
      setError(urlError);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await repository.queueExistingClient({
        clientId: brand.id,
        facebookUrl: facebookUrl.trim()
      });
      await onQueued();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not queue brand setup."
      );
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
        <label>
          <span>Facebook URL</span>
          <input
            value={facebookUrl}
            disabled={saving}
            placeholder="https://www.facebook.com/brand.page"
            onChange={(event) => setFacebookUrl(event.target.value)}
          />
        </label>
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
            {saving ? "Queuing..." : "Analyze brand"}
          </button>
        </div>
      </div>
    </section>
  );
}

function AddClientPanel({
  open,
  onToggle,
  onCreated
}: {
  open: boolean;
  onToggle: () => void;
  onCreated: () => Promise<void>;
}) {
  const repository = useClientIntakeRepository();
  const [name, setName] = useState("");
  const [facebookUrl, setFacebookUrl] = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
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

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const result = await repository.createDraftClient({
        name: trimmedName,
        facebookUrl: facebookUrl.trim(),
        ...(category.trim() ? { category: category.trim() } : {})
      });
      await onCreated();
      setName("");
      setFacebookUrl("");
      setCategory("");
      setMessage(
        `${result.brand.name} draft created. Ingestion job ${result.jobId} queued.`
      );
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
        <small>Requires Facebook URL. Backend harness will ingest sources.</small>
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
              placeholder="Example: Premium restaurant"
              onChange={(event) => setCategory(event.target.value)}
            />
          </label>
          {error ? <p className="repository-message error">{error}</p> : null}
          {message ? <p className="repository-message">{message}</p> : null}
          <button
            className="btn secondary"
            type="button"
            disabled={saving}
            onClick={() => void createClient()}
          >
            {saving ? "Creating draft..." : "Create client draft"}
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
    return "This client is in the mapping sheet but has no brand memory in Neo yet.";
  }

  if (!canSelectBrand(brand)) {
    return "This client is still being ingested. Wait until Brand Memory is ready.";
  }

  return null;
}

function clientStatusLabel(brand: NonNullable<WorkflowState["brand"]>): string {
  if (brand.existsInSystem === false) return "No Neo data yet";

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
      return `${brand.category} · Ready`;
    case "needs_review":
      return `${brand.category} · Needs review`;
    case "failed":
      return "Ingestion failed";
    default:
      return brand.category;
  }
}

function clientSubtitle(brand: Brand): string {
  if (
    brand.category === "Awaiting brand ingestion" &&
    (brand.ingestionStatus === "ready" ||
      brand.ingestionStatus === "needs_review")
  ) {
    return brand.ingestionStatus === "needs_review"
      ? "Brand memory ready · Review recommended"
      : "Brand memory ready";
  }

  return brand.category;
}

type BrandProfileSection =
  | "brand"
  | "products"
  | "docs"
  | "refs"
  | "past"
  | "learning";

const brandProfileSections: readonly [BrandProfileSection, string, string][] = [
  ["brand", "Brand kit", "Rules, voice, CI, claim guardrails"],
  ["products", "Products", "Offers, benefits, audience, claim notes"],
  ["docs", "Documents", "Guidelines, briefs, factsheets, extracted text"],
  ["refs", "References", "Visual inspiration, avoid, competitors"],
  ["past", "Past work", "Delivered runs and approved learnings"],
  ["learning", "Brand learning", "What's working and what to avoid"]
];

function BrandProfilePanel({
  state,
  section,
  onSectionChange
}: {
  state: WorkflowState;
  section: BrandProfileSection;
  onSectionChange: (section: BrandProfileSection) => void;
}) {
  const brand = state.brand;
  const [memoryExpanded, setMemoryExpanded] = useState(false);

  if (!brand) {
    return (
      <section className="neo-signal-memory-card">
        <div className="neo-signal-memory-top">
          <div>
            <h3>Brand memory</h3>
            <p>Nothing loaded yet.</p>
          </div>
        </div>
        <div className="neo-signal-memory-content">
          <div className="neo-signal-memory-empty">
            <div>
              <b>No memory loaded.</b>
              <span>Choose a brand to reveal the signal stack.</span>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <aside className="neo-signal-memory-card" aria-label="Brand profile">
      <div className="neo-signal-memory-top">
        <div>
          <h3>{brand.name} memory</h3>
          <p>{clientSubtitle(brand)}</p>
        </div>
        <nav className="neo-signal-memory-tabs" aria-label="Brand memory sections">
          {brandProfileSections.map(([id, label, description]) => (
            <button
              key={id}
              className={section === id ? "active" : ""}
              type="button"
              title={description}
              onClick={() => {
                onSectionChange(id);
                setMemoryExpanded(false);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
      <div
        className={`neo-signal-memory-viewport ${memoryExpanded ? "expanded" : "collapsed"}`}
      >
        <div className="neo-signal-memory-content">
          <BrandProfileSectionContent state={state} section={section} />
        </div>
        {!memoryExpanded ? (
          <div className="neo-signal-memory-fade">
            <button
              type="button"
              aria-label="See more brand memory"
              onClick={() => setMemoryExpanded(true)}
            >
              See more
            </button>
          </div>
        ) : (
          <button
            className="neo-signal-memory-collapse"
            type="button"
            aria-label="See less brand memory"
            onClick={() => setMemoryExpanded(false)}
          >
            See less
          </button>
        )}
      </div>
    </aside>
  );
}

function BrandLibraryModal({
  state,
  section,
  onSectionChange,
  onClose
}: {
  state: WorkflowState;
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
    past: 0,
    learning: brand.memory.working.length + brand.memory.avoid.length
  };
  const activeSection =
    brandProfileSections.find(([id]) => id === section) ?? brandProfileSections[0];

  return (
    <div className="output-modal-backdrop neo-library-backdrop" onClick={onClose}>
      <section
        className="output-modal neo-material-manager-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="brand-library-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="neo-material-manager-head">
          <div>
            <p className="eyebrow">Brand Library</p>
            <h3 id="brand-library-title">Manage brand materials</h3>
            <p>
              Search, organize, update, and remove the source memory used by neo.
            </p>
          </div>
          <button
            className="neo-material-close"
            type="button"
            aria-label="Close brand library"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="neo-material-manager-toolbar">
          <div>
            <b>{brand.name}</b>
            <span>Live Brand Memory</span>
          </div>
          <span className="pill green">Used in creative context</span>
        </div>
        <div className="neo-material-manager-window">
          <nav className="neo-material-folder-nav" aria-label="Brand library folders">
            {brandProfileSections.map(([id, label, description], index) => (
              <button
                className={`neo-material-folder-btn ${section === id ? "active" : ""}`}
                type="button"
                key={id}
                onClick={() => onSectionChange(id)}
              >
                <span className="neo-material-folder-icon" aria-hidden="true">
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
          <section className="neo-material-browser">
            <div className="neo-material-browser-head">
              <div>
                <b>{activeSection?.[1]}</b>
                <span>{activeSection?.[2]}</span>
              </div>
              <span>
                {counts[section]} item{counts[section] === 1 ? "" : "s"}
              </span>
            </div>
            <div className="neo-material-browser-content">
              <BrandProfileSectionContent state={state} section={section} />
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function BrandProfileSectionContent({
  state,
  section
}: {
  state: WorkflowState;
  section: BrandProfileSection;
}) {
  const brand = state.brand;
  if (!brand) return null;

  return (
    <div className="brand-profile-body">
      {section === "brand" ? (
        <BrandKitMemoryList
          clientId={brand.id}
          initialItems={brand.library.brand}
        />
      ) : null}
      {section === "products" ? (
        <BrandProductsMemoryList clientId={brand.id} />
      ) : null}
      {section === "docs" ? (
        <BrandDocumentsMemoryList
          clientId={brand.id}
          libraryItems={brand.library.docs}
        />
      ) : null}
      {section === "refs" ? (
        <MemoryList
          title="References"
          description="Upload visuals or links, then mark them inspiration, avoid, competitor, or past winner."
          action="Add reference"
          upload="Upload reference"
          items={brand.library.refs}
        />
      ) : null}
      {section === "past" ? (
        <PastWorkPreview state={state} clientId={brand.id} />
      ) : null}
      {section === "learning" ? <BrandLearning state={state} /> : null}
    </div>
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

  return (
    <section className="memory-editor">
      <header>
        <div>
          <h4>Products</h4>
          <p>
            Default offers, benefits, audience, and claim notes extracted by
            Neo. Review and edit before generation.
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
      {error ? <p className="memory-error">{error}</p> : null}
      {formOpen ? (
        <div className="memory-form product-memory-form">
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
                <span>Editable AI default</span>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => openEditForm(product)}
                >
                  Edit
                </button>
                <button
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

function BrandKitMemoryList({
  clientId,
  initialItems
}: {
  clientId: string;
  initialItems: readonly LibraryItem[];
}) {
  const repository = useBrandMemoryRepository();
  const [items, setItems] = useState<readonly LibraryItem[]>(initialItems);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [analyzingGuideline, setAnalyzingGuideline] = useState(false);
  const [guidelineError, setGuidelineError] = useState<string | null>(null);
  const [guidelineTextOpen, setGuidelineTextOpen] = useState(false);
  const [guidelineText, setGuidelineText] = useState("");
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

  async function mergeColorsIntoRule(
    ruleTitle: string,
    newColors: readonly string[]
  ) {
    if (!newColors.length) return;

    const rule = findRuleByTitle(items, ruleTitle);
    const existingColors = extractColorSwatches(rule);
    const merged = Array.from(
      new Set(
        [...existingColors, ...newColors].map((value) => value.toUpperCase())
      )
    );
    const saved = rule
      ? await repository.updateBrandRule({
          id: rule.id,
          title: ruleTitle,
          description: merged.join(", ")
        })
      : await repository.createBrandRule({
          clientId,
          title: ruleTitle,
          description: merged.join(", ")
        });
    setItems((current) =>
      current.some((item) => item.id === saved.id)
        ? current.map((item) => (item.id === saved.id ? saved : item))
        : [...current, saved]
    );
  }

  async function handleAnalyzeGuideline(
    source: { file: File } | { text: string }
  ) {
    setAnalyzingGuideline(true);
    setGuidelineError(null);

    try {
      const analysis = await repository.analyzeGuideline(
        "file" in source
          ? { clientId, file: source.file }
          : { clientId, text: source.text }
      );

      if (analysis.summary.trim()) {
        const existing = findRuleByTitle(items, "Tone & Style");
        const saved = existing
          ? await repository.updateBrandRule({
              id: existing.id,
              title: "Tone & Style",
              description: analysis.summary.trim()
            })
          : await repository.createBrandRule({
              clientId,
              title: "Tone & Style",
              description: analysis.summary.trim()
            });
        setItems((current) =>
          current.some((item) => item.id === saved.id)
            ? current.map((item) => (item.id === saved.id ? saved : item))
            : [...current, saved]
        );
      }

      await mergeColorsIntoRule("Colors", analysis.primaryColors);
      await mergeColorsIntoRule("Secondary colors", analysis.secondaryColors);

      if ("text" in source) {
        setGuidelineText("");
        setGuidelineTextOpen(false);
      }
    } catch (caught) {
      setGuidelineError(
        caught instanceof Error
          ? caught.message
          : "Could not analyze guideline."
      );
    } finally {
      setAnalyzingGuideline(false);
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

  const logoItem = items.find(
    (item) => item.title.trim().toLowerCase() === "logo"
  );
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
          <span>Usable for AI</span>
          <button
            type="button"
            disabled={saving}
            onClick={() => openEditForm(item)}
          >
            Edit
          </button>
          <button
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

  return (
    <section className="memory-editor">
      <header>
        <div>
          <h4>Brand kit</h4>
          <p>Store the core rules: voice, CI, claim safety, and do/don’t.</p>
        </div>
        <div className="memory-actions">
          <label
            className={`btn secondary upload-inline ${analyzingGuideline ? "disabled" : ""}`}
            title="Upload a PDF or image guideline. Neo will extract tone, style, and brand colors automatically."
          >
            {analyzingGuideline ? "Analyzing…" : "Upload guideline"}
            <input
              className="file-input"
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              disabled={analyzingGuideline}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void handleAnalyzeGuideline({ file });
              }}
            />
          </label>
          <button
            className="btn secondary"
            type="button"
            disabled={analyzingGuideline}
            onClick={() => setGuidelineTextOpen((current) => !current)}
          >
            {guidelineTextOpen ? "Cancel" : "Paste guideline text"}
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
      {guidelineTextOpen ? (
        <div className="memory-form">
          <label>
            <span>Guideline text</span>
            <textarea
              value={guidelineText}
              disabled={analyzingGuideline}
              placeholder="Paste brand guideline text: voice, tone, positioning, color names, or hex codes..."
              rows={4}
              onChange={(event) => setGuidelineText(event.target.value)}
            />
          </label>
          <div className="memory-form-actions">
            <button
              className="btn ghost"
              type="button"
              disabled={analyzingGuideline}
              onClick={() => {
                setGuidelineTextOpen(false);
                setGuidelineText("");
              }}
            >
              Cancel
            </button>
            <button
              className="btn primary"
              type="button"
              disabled={analyzingGuideline || !guidelineText.trim()}
              onClick={() =>
                void handleAnalyzeGuideline({ text: guidelineText })
              }
            >
              {analyzingGuideline ? "Analyzing…" : "Analyze text"}
            </button>
          </div>
        </div>
      ) : null}
      {guidelineError ? <p className="memory-error">{guidelineError}</p> : null}
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
      {error ? <p className="memory-error">{error}</p> : null}
      {formOpen ? (
        <div className="memory-form">
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

function MemoryList({
  title,
  description,
  action,
  upload,
  items
}: {
  title: string;
  description: string;
  action: string;
  upload: string;
  items: WorkflowState["brand"] extends null
    ? never
    : NonNullable<WorkflowState["brand"]>["library"]["brand"];
}) {
  return (
    <section className="memory-editor">
      <header>
        <div>
          <h4>{title}</h4>
          <p>{description}</p>
        </div>
        <div className="memory-actions">
          <button
            className="btn secondary"
            type="button"
            disabled
            title="Coming soon"
          >
            {upload}
          </button>
          <button
            className="btn primary"
            type="button"
            disabled
            title="Coming soon"
          >
            {action}
          </button>
        </div>
      </header>
      {items.length ? (
        <div className="memory-item-list">
          {items.map((item) => (
            <article className="memory-item" key={item.id}>
              <b>{item.title}</b>
              <p>{item.description}</p>
              <span>Usable for AI</span>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty">
          <b>No {title.toLowerCase()} yet.</b>
          <p>Add memory here before using it in generation.</p>
        </div>
      )}
    </section>
  );
}

function BrandDocumentsMemoryList({
  clientId,
  libraryItems
}: {
  clientId: string;
  libraryItems: NonNullable<WorkflowState["brand"]>["library"]["docs"];
}) {
  const repository = useBrandMemoryRepository();
  const [documents, setDocuments] = useState<readonly BrandDocument[]>([]);
  const [documentType, setDocumentType] =
    useState<BrandDocumentType>("brand_guideline");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section className="memory-editor">
      <header>
        <div>
          <h4>Documents</h4>
          <p>Upload briefs, guidelines, factsheets, and references for AI.</p>
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
      {error ? <p className="memory-error">{error}</p> : null}
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
      {libraryItems.length ? (
        <>
          <span className="memory-subhead">Library notes</span>
          <div className="memory-item-list">
            {libraryItems.map((item) => (
              <article className="memory-item" key={item.id}>
                <b>{item.title}</b>
                <p>{item.description}</p>
                <span>Usable for AI</span>
              </article>
            ))}
          </div>
        </>
      ) : null}
      {!loading && !documents.length && !libraryItems.length ? (
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
              <div className="past-work-media-placeholder">Facebook post</div>
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
            Delivered Neo work is shown separately when available.
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
          <span className="memory-subhead">Delivered by Neo</span>
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
  "album-post": "4:5 swipeable story",
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

type BriefMaterialsSection = "uploads" | "references";

const briefMaterialSections: readonly [
  BriefMaterialsSection,
  string,
  string
][] = [
  ["uploads", "Working files", "Files attached specifically to this brief"],
  ["references", "References", "Select visual context from the brand library"]
];

const creativeMaterialRoleLabels: Record<CreativeMaterialRole, string> = {
  "main-object": "Main object",
  product: "Product",
  "supporting-component": "Supporting component",
  "client-context": "Client context"
};

export function BriefStage({ state, dispatch }: StageProps) {
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [materialsSection, setMaterialsSection] =
    useState<BriefMaterialsSection>("uploads");
  const [materialUploadPending, setMaterialUploadPending] = useState(false);
  const [materialUploadError, setMaterialUploadError] = useState<string | null>(
    null
  );
  const backAction: WorkflowAction = { type: "set-stage", stage: "start" };
  const generateBlocked = workflowActionBlockReason(state, {
    type: "generate-directions",
    directions: []
  });
  const { generate, loading, error } = useGenerateHooks(state, dispatch);
  const workingCount = state.brand?.memory.working.length ?? 0;
  const avoidCount = state.brand?.memory.avoid.length ?? 0;
  const productTitle = state.brand?.library.products[0]?.title;
  const availableReferenceCount = state.brand?.library.refs.length ?? 0;
  const signalItems = [
    {
      label: "Brand memory",
      detail: state.brand
        ? `${workingCount} working cues and ${avoidCount} guardrails loaded.`
        : "Choose a brand to load its memory."
    },
    {
      label: "Product truth",
      detail: productTitle ?? "No product material loaded yet."
    },
    {
      label: "Reference context",
      detail: state.referenceImages.length
        ? `${state.referenceImages.length} selected ${pluralize(state.referenceImages.length, "reference")}.`
        : `${availableReferenceCount} ${pluralize(availableReferenceCount, "reference")} available in the library.`
    }
  ];

  const mixItems = creativeMixItems(state);
  const totalDeliverables = totalCreativeMixQuantity(state);
  const fixedMixItems = briefServiceTypes
    .map((service) => mixItems.find((item) => item.service === service))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const fixedMixReady = fixedMixItems.length === briefServiceTypes.length;
  const materialSummary = [
    {
      label: "Brand files",
      detail: state.attachments.length + state.uploadedMaterials.length
        ? `${state.attachments.length + state.uploadedMaterials.length} ${pluralize(state.attachments.length + state.uploadedMaterials.length, "file")} attached`
        : "No files yet"
    },
    {
      label: "Selected references",
      detail: state.referenceImages.length
        ? `${state.referenceImages.length} selected`
        : "None selected"
    },
    {
      label: "Library references",
      detail: availableReferenceCount
        ? `${availableReferenceCount} available`
        : "No references yet"
    }
  ];

  useEffect(() => {
    if (!fixedMixReady) dispatch({ type: "apply-monthly-quota" });
  }, [dispatch, fixedMixReady]);

  async function handleCreativeMaterialUpload(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    if (state.uploadedMaterials.length + files.length > 8) {
      setMaterialUploadError("Use up to 8 creative material images per brief.");
      return;
    }

    setMaterialUploadPending(true);
    setMaterialUploadError(null);
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
      setMaterialUploadError(
        caught instanceof Error ? caught.message : "Could not upload the image."
      );
    } finally {
      setMaterialUploadPending(false);
    }
  }

  return (
    <DecisionCard
      eyebrow="02 / Brief"
      title="Shape the creative problem."
      helper="Set the mix, define the objective, and choose the one metric this creative set should move."
      status={state.brand ? `${state.brand.name} context ready` : "Context waiting"}
      statusClass="green"
      className="neo-stage-brief"
      actions={
        <>
          <button
            className="btn ghost"
            type="button"
            onClick={() => dispatch(backAction)}
          >
            ← Back to signal
          </button>
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
        </>
      }
    >
      {error ? <p className="repository-message error">{error}</p> : null}
      <div className="brief-grid neo-brief-layout">
        <div className="brief-main">
          <section className="neo-workflow-module brief-setup-module">
            <div className="neo-module-head">
              <div>
                <h3>Creative mix</h3>
                <p>{totalDeliverables} deliverables planned</p>
              </div>
              <button
                className="btn secondary small"
                type="button"
                onClick={() => dispatch({ type: "apply-monthly-quota" })}
              >
                Use monthly quota
              </button>
            </div>
            <div className="neo-plan-rows">
              {fixedMixItems.map((item) => {
                const label = briefServiceLabel(item.service);
                return (
                  <div className="neo-plan-row" key={item.id}>
                    <span className="neo-type-icon" aria-hidden="true">
                      {briefServiceIcons[item.service]}
                    </span>
                    <div className="neo-plan-copy">
                      <b>{label}</b>
                      <p>{serviceDescriptions[item.service]}</p>
                    </div>
                    <div className="neo-mix-row-controls">
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
                          min={0}
                          max={9}
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
                          disabled={totalDeliverables >= 9}
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
          </section>
          <section className="neo-workflow-module brief-editor-module">
            <div className="neo-module-head">
              <div>
                <h3>Creative brief</h3>
                <p>One clear problem. One clear outcome.</p>
              </div>
            </div>
            <div className="textarea-wrap">
              <label className="neo-brief-field-label" htmlFor="brief">
                <span>Working brief</span>
                <span className="neo-brief-char-count">
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
        <aside className="neo-context-stack">
          <section className="neo-context-card">
            <h3>Signal stack</h3>
            <div className="neo-signal-list">
              {signalItems.map((item) => (
                <div className="neo-signal-line" key={item.label}>
                  <b>{item.label}</b>
                  <span>{item.detail}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="neo-context-card">
            <h3>Primary success metric</h3>
            <div
              className="neo-metric-choice"
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
          <section className="neo-context-card neo-principle-card">
            <h3>Creative principle</h3>
            <p>
              Distinctive beats decorative. Each idea should be recognizable in
              one second and arguable in one sentence.
            </p>
          </section>
          <section className="neo-context-card neo-material-card">
            <h3>Uploaded materials</h3>
            <button
              className="neo-material-summary-open"
              type="button"
              aria-label="Manage uploaded materials"
              onClick={() => setMaterialsOpen(true)}
            >
              <span className="neo-material-summary">
                {materialSummary.map((item) => (
                  <span className="neo-material-summary-line" key={item.label}>
                    <b>{item.label}</b>
                    <span>{item.detail}</span>
                  </span>
                ))}
              </span>
            </button>
          </section>
        </aside>
      </div>
      {materialsOpen ? (
        <div
          className="output-modal-backdrop neo-library-backdrop"
          onClick={() => setMaterialsOpen(false)}
        >
          <section
            className="output-modal neo-material-manager-modal neo-brief-material-manager"
            role="dialog"
            aria-modal="true"
            aria-labelledby="brief-materials-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="neo-material-manager-head">
              <div>
                <p className="eyebrow">Brief materials</p>
                <h3 id="brief-materials-title">Uploaded materials</h3>
                <p>
                  Manage working files and choose the visual references attached
                  to this creative brief.
                </p>
              </div>
              <button
                className="neo-material-close"
                type="button"
                aria-label="Close uploaded materials"
                onClick={() => setMaterialsOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="neo-material-manager-toolbar">
              <div>
                <b>{state.brand?.name ?? "Current brief"}</b>
                <span>Creative input library</span>
              </div>
              <span className="pill green">Used in this generation</span>
            </div>
            <div className="neo-material-manager-window">
              <nav
                className="neo-material-folder-nav"
                aria-label="Uploaded material folders"
              >
                {briefMaterialSections.map(([id, label, description], index) => {
                  const count =
                    id === "uploads"
                      ? state.attachments.length + state.uploadedMaterials.length
                      : state.referenceImages.length;
                  return (
                    <button
                      className={`neo-material-folder-btn ${materialsSection === id ? "active" : ""}`}
                      type="button"
                      key={id}
                      onClick={() => setMaterialsSection(id)}
                    >
                      <span className="neo-material-folder-icon" aria-hidden="true">
                        {index + 1}
                      </span>
                      <span>
                        <b>{label}</b>
                        <small>
                          {count} item{count === 1 ? "" : "s"} · {description}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </nav>
              <section className="neo-material-browser">
                <div className="neo-material-browser-head">
                  <div>
                    <b>
                      {materialsSection === "uploads"
                        ? "Working files"
                        : "References"}
                    </b>
                    <span>
                      {materialsSection === "uploads"
                        ? "Upload products or client materials and tell Neo how each image should be used."
                        : "Choose the approved visual context for generation."}
                    </span>
                  </div>
                  <span>
                    {materialsSection === "uploads"
                      ? state.attachments.length + state.uploadedMaterials.length
                      : state.referenceImages.length}{" "}
                    selected
                  </span>
                </div>
                <div className="neo-material-browser-content">
                  {materialsSection === "uploads" ? (
                    <div className="neo-brief-material-modal-body">
                      <div className="neo-creative-material-upload-row">
                      <label className="btn secondary neo-brief-add-files">
                        {materialUploadPending ? "Uploading…" : "Add product / client images"}
                        <input
                          className="file-input"
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          multiple
                          disabled={materialUploadPending}
                          onChange={handleCreativeMaterialUpload}
                        />
                      </label>
                      <label className="neo-brief-document-upload">
                        Attach other files
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
                      <p className="neo-creative-material-helper">
                        The Hook agent will inspect these images before proposing ideas. The image agent will receive them as source references.
                      </p>
                      {materialUploadError ? (
                        <p className="error-text" role="alert">{materialUploadError}</p>
                      ) : null}
                      {state.uploadedMaterials.length ? (
                        <div className="neo-creative-material-grid">
                          {state.uploadedMaterials.map((material) => (
                            <article className="neo-creative-material-card" key={material.id}>
                              <img src={material.url} alt={material.name} />
                              <div className="neo-creative-material-fields">
                                <div className="neo-creative-material-name">
                                  <b>{material.name}</b>
                                  <button
                                    type="button"
                                    aria-label={`Remove ${material.name}`}
                                    onClick={() => dispatch({ type: "remove-uploaded-material", id: material.id })}
                                  >×</button>
                                </div>
                                <label>
                                  Use as
                                  <select
                                    value={material.role}
                                    onChange={(event) => dispatch({
                                      type: "update-uploaded-material",
                                      id: material.id,
                                      changes: { role: event.target.value as CreativeMaterialRole }
                                    })}
                                  >
                                    {creativeMaterialRoles.map((role) => (
                                      <option value={role} key={role}>{creativeMaterialRoleLabels[role]}</option>
                                    ))}
                                  </select>
                                </label>
                                <label>
                                  Usage note <span>(optional)</span>
                                  <input
                                    value={material.description}
                                    placeholder="e.g. Keep this bottle as the hero object"
                                    onChange={(event) => dispatch({
                                      type: "update-uploaded-material",
                                      id: material.id,
                                      changes: { description: event.target.value }
                                    })}
                                  />
                                </label>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : null}
                      {state.attachments.length ? (
                        <div className="chips neo-attachment-chips">
                          {state.attachments.map((name) => (
                            <span className="chip" key={name}>
                              {name}
                            </span>
                          ))}
                        </div>
                      ) : !state.uploadedMaterials.length ? (
                        <div className="neo-signal-memory-empty">
                          <div>
                            <b>No working files attached.</b>
                            <span>Add only files that should influence this brief.</span>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <ReferenceLibraryPicker state={state} dispatch={dispatch} />
                  )}
                </div>
              </section>
            </div>
          </section>
        </div>
      ) : null}
    </DecisionCard>
  );
}

type ReferenceLibraryCategory = "guideline" | "logo" | "product" | "reference";

const REFERENCE_LIBRARY_CATEGORIES: readonly [
  ReferenceLibraryCategory,
  string
][] = [
  ["guideline", "Brand guideline"],
  ["logo", "Logo / CI assets"],
  ["product", "Product materials"],
  ["reference", "Reference board"]
];

function libraryItemsWithImages(items: readonly LibraryItem[]) {
  return items
    .filter((item) => item.assetUrl)
    .map((item) => ({
      id: `library-${item.id}`,
      url: item.assetUrl as string,
      label: item.title || "Untitled"
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
  dispatch
}: {
  state: WorkflowState;
  dispatch: Dispatch<WorkflowAction>;
}) {
  const repository = useBrandMemoryRepository();
  const [brandRules, setBrandRules] = useState<readonly LibraryItem[]>([]);
  const [products, setProducts] = useState<readonly BrandProduct[]>([]);
  const [pastWork, setPastWork] = useState<readonly BrandPastWorkItem[]>([]);
  const [refImages, setRefImages] = useState<readonly LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [openCategory, setOpenCategory] =
    useState<ReferenceLibraryCategory | null>(null);
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
      setRefImages([]);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setRefImages(brand?.library.refs ?? []);

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
  }

  async function uploadReferenceImage(file: File) {
    if (!clientId) return;
    const saved = await repository.createReferenceImage({ clientId, file });
    setRefImages((current) => [saved, ...current]);
  }

  const logoRule = findRuleByTitle(brandRules, "Logo");

  const candidatesByCategory: Record<
    ReferenceLibraryCategory,
    { id: string; url: string; label: string }[]
  > = {
    guideline: libraryItemsWithImages(brand?.library.docs ?? []),
    logo: logoRule ? libraryItemsWithImages([logoRule]) : [],
    product: [],
    reference: [
      ...libraryItemsWithImages(refImages),
      ...pastWork
        .filter(
          (item): item is BrandPastWorkItem & { imageUrl: string } =>
            Boolean(item.imageUrl)
        )
        .map((item) => ({
          id: `past-work-${item.id}`,
          url: item.imageUrl,
          label: item.title || "Past work"
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
                        item: candidate
                      })
                    }
                  />
                  <img src={candidate.url} alt={candidate.label} />
                  <span>{candidate.label}</span>
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
              onSaved={upsertBrandRule}
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
            onUpload={uploadReferenceImage}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="source-checks">
      <h3>Use from library</h3>
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
  const autoSelectAction: WorkflowAction = { type: "auto-select-directions" };
  const [moreInstructions, setMoreInstructions] = useState("");
  const [editingDirectionId, setEditingDirectionId] = useState<string | null>(
    null
  );
  const [regeneratingDirectionId, setRegeneratingDirectionId] = useState<
    string | null
  >(null);
  const [regeneratingAll, setRegeneratingAll] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [moreComposerOpen, setMoreComposerOpen] = useState(false);
  const [exportingAngles, setExportingAngles] = useState(false);
  const [exportAnglesError, setExportAnglesError] = useState<string | null>(null);
  const {
    generateMore,
    loading: generatingMore,
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
    error: createError
  } = useCreateSelectedHooks(state, dispatch);

  function handleGenerateMore() {
    generateMore(moreInstructions);
    setMoreInstructions("");
    setMoreComposerOpen(false);
  }

  async function handleExportAngles() {
    setExportingAngles(true);
    setExportAnglesError(null);
    try {
      const review = buildAngleExportReview(state);
      if (review.sections.length === 0) {
        throw new Error(
          "Choose at least one Angle as Recommended or Option before exporting."
        );
      }
      const { exportIdeasReviewPdf } = await import(
        "../export-pdf-kit/export-ideas-review-pdf"
      );
      const brandSlug = (state.brand?.name ?? "neo")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      await exportIdeasReviewPdf(
        review.sections,
        `${brandSlug || "neo"}-angles.pdf`,
        review.highlightMap
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

  return (
    <DecisionCard
      eyebrow="Angles"
      title="Pick the hooks for this creative mix."
      status={`${selected}/${requiredCount} selected`}
      statusClass="blue"
      className="neo-stage-angles"
      actions={
        <>
          <button
            className="btn secondary"
            type="button"
            onClick={() => dispatch(editBriefAction)}
          >
            Edit brief
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={creating || Boolean(createOutputsBlocked)}
            title={createOutputsBlocked ?? undefined}
            onClick={createSelectedHooks}
          >
            {creating ? <Spinner /> : null}
            {creating ? "Generating artwork…" : "Confirm hooks and create"}
          </button>
        </>
      }
    >
      <section className="neo-angle-settings" aria-label="Artwork settings">
        <div className="neo-angle-setting neo-angle-mode-setting">
          <span className="neo-angle-setting-label">Artwork mode</span>
          <div
            className="neo-angle-mode-options"
            role="group"
            aria-label="Artwork generation mode"
          >
            <button
              className={state.artworkMode === "standard" ? "active" : ""}
              type="button"
              disabled={creating}
              aria-pressed={state.artworkMode === "standard"}
              onClick={() =>
                dispatch({ type: "set-artwork-mode", mode: "standard" })
              }
            >
              Standard
            </button>
            <button
              className={state.artworkMode === "design-system" ? "active" : ""}
              type="button"
              disabled={creating}
              aria-pressed={state.artworkMode === "design-system"}
              onClick={() =>
                dispatch({ type: "set-artwork-mode", mode: "design-system" })
              }
            >
              Design system
            </button>
          </div>
        </div>
        <label className="neo-angle-setting">
          <span className="neo-angle-setting-label">Image prompt model</span>
          <select
            className="neo-angle-model-select"
            aria-label="Image prompt model"
            value={state.imagePromptModel}
            disabled={creating}
            onChange={(event) =>
              dispatch({
                type: "set-image-prompt-model",
                model: event.target.value as WorkflowState["imagePromptModel"]
              })
            }
          >
            <option value="gpt-5.6-terra">GPT 5.6 (OpenAI)</option>
            <option value="anthropic/claude-sonnet-4.6">
              Claude Sonnet 4.6 (OpenRouter)
            </option>
          </select>
        </label>
        <label className="neo-angle-setting neo-angle-size-setting">
          <span className="neo-angle-setting-label">Output size</span>
          <select
            className="neo-angle-model-select"
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
      <div className="direction-tools neo-angle-toolbar">
        <div>
          <h3>Review recommended hooks</h3>
          <p>
            Select {requiredCount} hooks, or let Neo pick the strongest set
            for this mix.
          </p>
        </div>
        <div className="neo-angle-toolbar-actions">
          <button
            className="btn primary small"
            type="button"
            onClick={() => dispatch(autoSelectAction)}
          >
            Let Neo pick
          </button>
          <div className="neo-angle-overflow">
            <button
              className="neo-angle-overflow-trigger"
              type="button"
              aria-label="More hook actions"
              aria-haspopup="menu"
              aria-expanded={actionsMenuOpen}
              onClick={() => setActionsMenuOpen((open) => !open)}
            >
              <span aria-hidden="true">•••</span>
            </button>
            {actionsMenuOpen ? (
              <div className="neo-angle-overflow-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  disabled={exportingAngles || state.directions.length === 0}
                  onClick={() => {
                    setActionsMenuOpen(false);
                    void handleExportAngles();
                  }}
                >
                  <span>Export PDF</span>
                  <small>Download the grouped review</small>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={regeneratingAllHooks || Boolean(regeneratingHookId)}
                  onClick={() => {
                    setActionsMenuOpen(false);
                    setRegeneratingAll(true);
                  }}
                >
                  <span>Regenerate all</span>
                  <small>Rewrite every hook with a new tone</small>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={generatingMore || regeneratingAllHooks}
                  onClick={() => {
                    setActionsMenuOpen(false);
                    setMoreComposerOpen(true);
                  }}
                >
                  <span>Generate more</span>
                  <small>Add another round of directions</small>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {moreComposerOpen ? (
        <div className="direction-generate-more neo-angle-generate-more">
          <input
            autoFocus
            value={moreInstructions}
            disabled={generatingMore || regeneratingAllHooks}
            placeholder="Add direction for the next round (optional)"
            onChange={(event) => setMoreInstructions(event.target.value)}
          />
          <button
            className="btn primary small"
            type="button"
            disabled={generatingMore || regeneratingAllHooks}
            onClick={handleGenerateMore}
          >
            {generatingMore ? <Spinner /> : null}
            {generatingMore ? "Generating…" : "Generate"}
          </button>
          <button
            className="neo-angle-composer-close"
            type="button"
            aria-label="Close generate more"
            disabled={generatingMore}
            onClick={() => setMoreComposerOpen(false)}
          >
            ×
          </button>
        </div>
      ) : null}
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
      <div className="neo-angle-groups">
        {angleGroups.map((group) => (
          <section className="neo-angle-group" key={group.service}>
            <header className="neo-angle-group-head">
              <div className="neo-angle-group-title">
                <span className="neo-angle-group-icon" aria-hidden="true">
                  {group.initials}
                </span>
                <div>
                  <h3>{group.title}</h3>
                  <p>
                    {group.required} needed · {group.description}
                  </p>
                </div>
              </div>
              <span
                className={`neo-angle-group-progress ${group.selected === group.required ? "complete" : ""}`}
              >
                {group.selected}/{group.required} selected
              </span>
            </header>
            <div className="direction-grid neo-angle-grid">
              {group.directions.map(({ direction, originalIndex }, groupIndex) => (
          <article
            className={`direction-card neo-angle-card ${direction.selected ? "selected" : ""}`}
            key={direction.id}
          >
            <button
              className="neo-angle-card-select-surface"
              type="button"
              aria-label={`${direction.selected ? "Deselect" : "Select"} Idea ${originalIndex + 1} card`}
              aria-pressed={direction.selected}
              onClick={() =>
                dispatch({ type: "toggle-direction", id: direction.id })
              }
            />
            <div className="neo-angle-card-top">
              <div>
                <div className="neo-angle-badge-row">
                  <span className="neo-angle-idea-pill">Idea {groupIndex + 1}</span>
                  <span className="neo-angle-format-pill">
                    {group.contentType}
                  </span>
                </div>
                <p className="neo-angle-meta-line">
                  Creative concept
                  <b> · {successMetricObjectives[state.successMetric]}</b>
                </p>
              </div>
              <div className="neo-angle-top-actions">
                <select
                  className={`neo-angle-export-select is-${direction.exportGroup ?? "unselected"}`}
                  aria-label={`Export group for Idea ${originalIndex + 1}`}
                  value={direction.exportGroup ?? ""}
                  onChange={(event) =>
                    dispatch({
                      type: "set-direction-export-group",
                      id: direction.id,
                      group: event.target.value
                        ? (event.target.value as AngleExportGroup)
                        : null
                    })
                  }
                >
                  <option value="recommended">Recommended</option>
                  <option value="option">Option</option>
                  <option value="">Not selected</option>
                </select>
              </div>
            </div>
            <div className="neo-angle-hook-wrap">
              <span className="neo-angle-card-kicker">
                {angleHookLabel(group.service)}
              </span>
              <h3>{direction.hook}</h3>
            </div>
            <div className="neo-angle-copy-block">
              <span className="neo-angle-card-kicker">
                {angleSubheadlineLabel(group.service)}
              </span>
              <AngleSubheadline
                text={directionSubheadline(direction)}
                highlight={direction.subheadlineHighlight}
              />
            </div>
            {direction.formatBeats?.length ? (
              <div className="neo-angle-copy-block neo-angle-format-beats">
                <span className="neo-angle-card-kicker">
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
            <div className="neo-angle-copy-block neo-angle-concept-block">
              <span className="neo-angle-card-kicker">
                {angleConceptLabel(group.service)}
              </span>
              <p>{direction.concept}</p>
            </div>
            <div className="neo-angle-copy-block">
              <span className="neo-angle-card-kicker">CTA</span>
              <p className="neo-angle-cta-text">{direction.cta}</p>
            </div>
            <div className="neo-angle-card-foot">
              <span className="neo-angle-number-pill">
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
                  disabled={regeneratingAllHooks}
                  onClick={() => setEditingDirectionId(direction.id)}
                >
                  Edit
                </button>
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
                    : "Regenerate"}
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
          <button className="btn ghost" type="button" onClick={onClose}>
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
  onRegenerate: (tone: string) => Promise<void>;
}) {
  const [tone, setTone] = useState("");

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
            <p className="eyebrow">Regenerate hook</p>
            <h3 id="hook-regenerate-title">Keep the idea, change the tone</h3>
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
          <span>Original hook</span>
          <b>{direction.hook}</b>
          <p>{directionSubheadline(direction)}</p>
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
          Neo will preserve the original strategic idea and rewrite its hook
          and supporting copy in this tone.
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
            <p className="eyebrow">Regenerate all hooks</p>
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
          Neo will keep each Hook's original strategy and selection, then
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
            {loading ? "Regenerating all…" : "Regenerate all hooks"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function StudioStage({ state, dispatch }: StageProps) {
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
  const failedCount = state.outputs.filter(
    (output) => output.status === "needs-revision"
  ).length;

  return (
    <DecisionCard
      eyebrow="Build"
      title="Review the creative set."
      status={
        checking
          ? "Checking quality…"
          : !state.qaComplete
            ? "Quality waiting"
            : failedCount
              ? `${failedCount} flagged`
              : "Quality passed"
      }
      statusClass={state.qaComplete && !failedCount ? "green" : ""}
      className="neo-stage-build"
      actions={
        <>
          <button
            className="btn secondary"
            type="button"
            onClick={() => dispatch(backAction)}
          >
            Back to Angles
          </button>
          <button
            className={`btn ${state.qaComplete ? "secondary" : "primary"}`}
            type="button"
            disabled={checking || Boolean(runQaBlocked)}
            title={runQaBlocked ?? undefined}
            onClick={check}
          >
            {checking ? <Spinner /> : null}
            {checking
              ? "Checking…"
              : state.qaComplete
                ? "Recheck quality"
                : "Check quality"}
          </button>
          <button
            className={`btn ${state.qaComplete ? "primary" : "secondary"}`}
            type="button"
            disabled={Boolean(approvalBlocked)}
            title={approvalBlocked ?? undefined}
            onClick={() => dispatch(approvalAction)}
          >
            Send to internal QC
          </button>
        </>
      }
    >
      <div className="create-stage-stack neo-build-stage-stack">
        <section className="neo-create-intro neo-build-intro">
          <div>
            <span className="neo-context-label">Creative set</span>
            <h3>
              {state.outputs.length} creative
              {state.outputs.length === 1 ? "" : "s"} ready for review
            </h3>
            <p>
              Review the artwork and caption together, then run the quality
              check before Internal QC.
            </p>
          </div>
          <span
            className={`pill ${state.qaComplete && !failedCount ? "green" : failedCount ? "red" : ""}`}
          >
            {!state.qaComplete
              ? "Quality check waiting"
              : failedCount
                ? `${failedCount} to review`
                : "Ready for Internal QC"}
          </span>
        </section>
        {qaError ? <p className="repository-message error">{qaError}</p> : null}
        <OutputGrid state={state} dispatch={dispatch} />
      </div>
    </DecisionCard>
  );
}

function isUgcOutput(output: CreativeOutput): boolean {
  return output.format.toUpperCase().includes("UGC");
}

function UgcTemplatePreview({
  direction,
  compact = false
}: {
  direction: WorkflowState["directions"][number] | undefined;
  compact?: boolean;
}) {
  return (
    <div className={`neo-ugc-template ${compact ? "compact" : ""}`}>
      <div className="neo-ugc-story" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <span className="neo-ugc-creator-dot" aria-hidden="true" />
      <div className="neo-ugc-copy">
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

function OutputGrid({
  state,
  dispatch
}: {
  state: WorkflowState;
  dispatch: Dispatch<WorkflowAction>;
}) {
  const [previewOutputId, setPreviewOutputId] = useState<string | null>(null);
  const [qaPrompt, setQaPrompt] = useState<string | undefined>();
  const [editOutputId, setEditOutputId] = useState<string | null>(null);
  const previewOutput =
    state.outputs.find((output) => output.id === previewOutputId) ?? null;
  const previewDirection = previewOutput
    ? state.directions.find(
        (candidate) => candidate.id === previewOutput.directionId
      )
    : undefined;
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
        {outputGroups.map(([format, outputs]) => (
          <section className="build-type-section" key={format}>
            <div className="build-section-head">
              <span className="neo-type-icon" aria-hidden="true">
                {format.includes("UGC") ? "UG" : "AD"}
              </span>
              <div>
                <h3>{format} creatives</h3>
                <p>Review artwork, angle, and caption together.</p>
              </div>
              <strong>{outputs.length}</strong>
            </div>
            <div className="output-grid">
              {outputs.map((output) => {
                const index = state.outputs.indexOf(output);
                const direction = state.directions.find(
                  (candidate) => candidate.id === output.directionId
                );
                return (
                  <article
                    className={`output-card neo-create-card ${output.status === "ready" || output.status === "fixed" ? "ready" : ""} ${output.status === "needs-revision" ? "attn" : ""}`}
                    key={output.id}
                  >
                    <div className="output-title neo-create-card-head">
                      <div className="neo-create-card-badges">
                        <span className="neo-create-idea-pill">
                          Creative {index + 1}
                        </span>
                        <span className="neo-create-format-pill">
                          {output.format}
                        </span>
                      </div>
                      <span
                        className={`pill ${output.status === "ready" || output.status === "fixed" ? "green" : output.status === "needs-revision" ? "red" : ""}`}
                      >
                        {output.status === "needs-revision"
                          ? "Needs revision"
                          : output.status === "ready" ||
                              output.status === "fixed"
                            ? "Ready"
                            : "Draft"}
                      </span>
                    </div>
                    <div className="neo-create-hook-wrap">
                      <span className="neo-create-card-kicker">Hook</span>
                      <h3>{direction?.hook ?? `Creative ${index + 1}`}</h3>
                      {direction ? (
                        <p>{directionSubheadline(direction)}</p>
                      ) : null}
                    </div>
                    <button
                      className="preview-area"
                      type="button"
                      aria-label={`Open Creative ${index + 1} preview`}
                      onClick={() => setPreviewOutputId(output.id)}
                    >
                      {isUgcOutput(output) ? (
                        <UgcTemplatePreview direction={direction} />
                      ) : output.assetUrl ? (
                        <img
                          className="generated-preview"
                          src={output.assetUrl}
                          alt={direction?.hook ?? `Creative ${index + 1}`}
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
                    {output.status === "needs-revision" && output.qaNote ? (
                      <div className="neo-output-qa-callout">
                        <span>Suggested improvement</span>
                        <b>Quality check found a fix</b>
                        <p>{output.qaNote}</p>
                        <div>
                          <button
                            className="btn primary small"
                            type="button"
                            onClick={() => {
                              if (isUgcOutput(output)) {
                                setEditOutputId(output.id);
                              } else {
                                setQaPrompt(output.qaNote);
                                setPreviewOutputId(output.id);
                              }
                            }}
                          >
                            Use suggestion
                          </button>
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() =>
                              dispatch({ type: "resolve-qa-output", id: output.id })
                            }
                          >
                            Keep current
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <div className="output-caption">
                      <span className="neo-create-card-kicker">Caption</span>
                      <OutputCaptionText caption={direction?.caption} />
                    </div>
                    <div className="neo-output-card-action neo-create-card-foot">
                      <div className="neo-create-cta-block">
                        <span className="neo-create-card-kicker">CTA</span>
                        <b>{direction?.cta ?? "Review creative"}</b>
                      </div>
                      <button
                        className="btn secondary small"
                        type="button"
                        onClick={() => setPreviewOutputId(output.id)}
                      >
                        Open creative
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {previewOutput ? (
        <OutputRegenerateModal
          run={state}
          output={previewOutput}
          direction={previewDirection}
          dispatch={dispatch}
          initialPrompt={qaPrompt}
          onClose={() => {
            setPreviewOutputId(null);
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

function OutputRegenerateModal({
  run,
  output,
  direction,
  dispatch,
  onClose,
  initialPrompt
}: {
  run: WorkflowState;
  output: CreativeOutput;
  direction: WorkflowState["directions"][number] | undefined;
  dispatch: Dispatch<WorkflowAction>;
  onClose: () => void;
  initialPrompt?: string;
}) {
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRegenerate = async () => {
    if (!direction) {
      setError("Missing hook details for this creative.");
      return;
    }

    setRegenerating(true);
    setError(null);

    try {
      const updated = await regenerateOutputImage({
        run,
        direction,
        extraInstructions: prompt
      });
      if (!updated.assetUrl) {
        throw new Error("Regeneration did not return an image.");
      }
      dispatch({
        type: "replace-output-asset",
        id: output.id,
        assetUrl: updated.assetUrl,
        ...(updated.assetStoragePath
          ? { assetStoragePath: updated.assetStoragePath }
          : {}),
        ...(updated.assetBucket ? { assetBucket: updated.assetBucket } : {})
      });
      setPrompt("");
      playGenerationSuccessSound();
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not regenerate image."
      );
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="output-modal-backdrop" onClick={onClose}>
      <div
        className="output-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="output-modal-head">
          <div>
            <p className="eyebrow">Creative preview</p>
            <h3>{direction?.hook ?? "Creative"}</h3>
          </div>
          <button className="btn ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="output-modal-image">
          {isUgcOutput(output) ? (
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
          <span>Regeneration instructions (optional)</span>
          <textarea
            value={prompt}
            disabled={regenerating}
            placeholder="Example: Make the background lighter, remove the text overlay, zoom in on the product."
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <p className="output-modal-reference-note">
          {`${run.artworkMode === "design-system" ? "Design system" : "Standard"} mode · ${
            run.referenceImages.length
              ? `using ${run.referenceImages.length} reference ${
                run.referenceImages.length === 1 ? "image" : "images"
              } from Brief · Use from library: ${run.referenceImages
                .map((item) => item.label)
                .join(", ")}`
              : "no reference images selected. Pick logo or past work in Brief · Use from library."
          }`}
        </p>
        {error ? <p className="repository-message error">{error}</p> : null}
        <div className="output-modal-actions">
          <button
            className="btn secondary"
            type="button"
            disabled={regenerating}
            onClick={onClose}
          >
            Close
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={regenerating}
            onClick={() => void handleRegenerate()}
          >
            {regenerating ? <Spinner /> : null}
            {regenerating
              ? "Regenerating…"
              : initialPrompt
                ? "Apply suggestion"
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
      <p className="neo-caption-scroll" tabIndex={0}>
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
        className="output-modal neo-copy-edit-modal"
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

function approvalRolesForOutput(output: CreativeOutput): readonly ApprovalRole[] {
  return isUgcOutput(output)
    ? ["clientService", "projectManager"]
    : ["graphicDesign", "clientService", "projectManager"];
}

function outputIsEligibleForRole(
  output: CreativeOutput,
  role: ApprovalRole
): boolean {
  return approvalRolesForOutput(output).includes(role);
}

export function ApprovalStage({ state, dispatch }: StageProps) {
  const backAction: WorkflowAction = { type: "set-stage", stage: "studio" };
  const approveAllAction: WorkflowAction = { type: "approve-all" };
  const approveAllBlocked = workflowActionBlockReason(
    state,
    approveAllAction
  );
  const clientAction: WorkflowAction = { type: "set-stage", stage: "client" };
  const clientBlocked = workflowActionBlockReason(state, clientAction);
  const [activeRole, setActiveRole] = useState<ApprovalRole>(() =>
    state.outputs.some((output) => output.clientStatus === "revision")
      ? "projectManager"
      : "graphicDesign"
  );
  const totalChecks = state.outputs.reduce(
    (total, output) => total + approvalRolesForOutput(output).length,
    0
  );
  const approvedChecks = state.outputs.reduce(
    (total, output) =>
      total +
      approvalRolesForOutput(output).filter(
        (role) => output.approval[role] === "approved"
      ).length,
    0
  );
  const readyAssets = state.outputs.filter((output) =>
    approvalRolesForOutput(output).every(
      (role) => output.approval[role] === "approved"
    )
  ).length;
  const activeRoleConfig =
    REVIEW_ROLES.find(({ key }) => key === activeRole) ?? REVIEW_ROLES[0]!;
  const activeRoleOutputs = state.outputs.filter((output) =>
    outputIsEligibleForRole(output, activeRole)
  );
  const activeRoleApproved = activeRoleOutputs.filter(
    (output) => output.approval[activeRole] === "approved"
  ).length;
  const activeRoleWaiting = activeRoleOutputs.length - activeRoleApproved;

  return (
    <DecisionCard
      eyebrow="Internal QC"
      title="Pass it through the team."
      status={state.approved ? "Approved" : "Pending"}
      statusClass={state.approved ? "green" : "blue"}
      className="neo-stage-qc"
      actions={
        <>
          <button
            className="btn secondary"
            type="button"
            onClick={() => dispatch(backAction)}
          >
            Back to Build
          </button>
          <button
            className="btn secondary"
            type="button"
            disabled={Boolean(approveAllBlocked)}
            title={approveAllBlocked ?? undefined}
            onClick={() => dispatch(approveAllAction)}
          >
            Approve all
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={Boolean(clientBlocked)}
            title={clientBlocked ?? undefined}
            onClick={() => dispatch(clientAction)}
          >
            Open client review
          </button>
        </>
      }
    >
      {state.outputs.length ? (
        <div className="neo-qc-workspace">
            <aside className="neo-qc-progress-rail">
              <span className="neo-context-label">Internal QC</span>
              <h3>Review progress</h3>
              <p>Track each role's queue before client review.</p>
              <div className="neo-qc-overall">
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
                  className="neo-qc-progress-track"
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
              <div className="neo-qc-role-list">
                {REVIEW_ROLES.map(({ key, label }) => {
                  const eligible = state.outputs.filter((output) =>
                    outputIsEligibleForRole(output, key)
                  );
                  const approvedForRole = eligible.filter(
                    (output) => output.approval[key] === "approved"
                  ).length;
                  return (
                    <div className="neo-qc-role-progress" key={key}>
                      <span className={reviewRoleShort(key).toLowerCase()}>
                        {reviewRoleShort(key)}
                      </span>
                      <div>
                        <b>{label}</b>
                        <small>
                          {approvedForRole === eligible.length
                            ? "Queue clear"
                            : `${eligible.length - approvedForRole} waiting`}
                        </small>
                      </div>
                      <strong>
                        {approvedForRole}/{eligible.length}
                      </strong>
                    </div>
                  );
                })}
              </div>
              <div className="neo-qc-client-ready">
                <b>
                  {readyAssets}/{state.outputs.length} client-ready
                </b>
                <span>PM-approved assets unlock in Client review.</span>
              </div>
            </aside>
            <div className="neo-qc-main">
              <section className="neo-qc-role-focus">
                <div
                  className="neo-qc-role-tabs"
                  role="tablist"
                  aria-label="Internal review roles"
                >
                  {REVIEW_ROLES.map(({ key, label, summary }) => {
                    const eligible = state.outputs.filter((output) =>
                      outputIsEligibleForRole(output, key)
                    );
                    const rejected = eligible.filter(
                      (output) => output.approval[key] === "rejected"
                    ).length;
                    const approvedForRole = eligible.filter(
                      (output) => output.approval[key] === "approved"
                    ).length;
                    const waiting = eligible.length - approvedForRole;
                    return (
                      <button
                        className={`neo-qc-role-tab ${key === activeRole ? "active" : ""} ${rejected ? "attention" : approvedForRole === eligible.length ? "complete" : ""}`}
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
                <div className="neo-qc-role-guide">
                  <span
                    className={`neo-qc-role-character ${reviewRoleShort(activeRole).toLowerCase()}`}
                    aria-hidden="true"
                  >
                    {reviewRoleShort(activeRole)}
                  </span>
                  <div className="neo-qc-role-speech">
                    <b>{activeRoleConfig?.label}</b>
                    <p>{reviewRoleGuide(activeRole)}</p>
                  </div>
                  <span className="neo-qc-role-summary">
                    {activeRoleWaiting} to review, {activeRoleApproved} approved
                  </span>
                </div>
              </section>
              <div className="neo-qc-section-head">
                <div>
                  <span className="neo-context-label">Creative review queue</span>
                  <h3>Assets in {reviewRoleShort(activeRole)} review</h3>
                </div>
                <span>{activeRoleOutputs.length} creatives</span>
              </div>
              <div className="neo-qc-focus-grid">
                {activeRoleOutputs.map((output) => (
                  <QcSlide
                    index={state.outputs.indexOf(output)}
                    output={output}
                    direction={state.directions.find(
                      (candidate) => candidate.id === output.directionId
                    )}
                    run={state}
                    role={activeRole}
                    dispatch={dispatch}
                    key={output.id}
                  />
                ))}
              </div>
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
  role,
  dispatch
}: {
  output: CreativeOutput;
  role: ApprovalRole;
  dispatch: Dispatch<WorkflowAction>;
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
    if (mode === "approve") {
      dispatch({
        type: "review-output",
        id: output.id,
        role,
        decision: "approved",
        comment: draft.trim()
      });
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
    dispatch({
      type: "route-output-changes",
      id: output.id,
      requestedBy: role,
      targetRole,
      comment: draft.trim()
    });
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
      <div className="review-decision-actions neo-qc-decision-actions">
        {role === "clientService" ? (
          <button
            className="btn secondary small"
            type="button"
            onClick={() => open("changes", ugc ? "both" : "artwork")}
          >
            {ugc ? "Needs UGC update" : "Request design changes"}
          </button>
        ) : role === "projectManager" ? (
          <button className="btn secondary small" type="button" onClick={() => open("changes")}>
            Request changes
          </button>
        ) : null}
        <button
          className="btn primary small"
          type="button"
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
            className="output-modal neo-qc-decision-modal"
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
            <div className="neo-qc-decision-meta">
              <b>{roleShort} approval</b> · {output.format} · V{output.revisionCount + 1}
            </div>
            {mode === "changes" && !ugc ? (
              <div className="neo-qc-change-type-field">
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
              <div className="neo-qc-route-preview">
                {ugc || changeType === "caption"
                  ? "Fix owner: CS · Update the hook, script, scenes, creator direction, or caption."
                  : changeType === "artwork"
                    ? "Fix owner: GD · Update and replace the artwork in Internal QC."
                    : changeType === "both"
                      ? "Fix route: GD → CS · Artwork first, then copy."
                      : "Choose one and Neo will route the revision to the right owner."}
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
  direction,
  run,
  role,
  dispatch
}: {
  index: number;
  output: CreativeOutput;
  direction: WorkflowState["directions"][number] | undefined;
  run: WorkflowState;
  role: ApprovalRole;
  dispatch: Dispatch<WorkflowAction>;
}) {
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [editingCopy, setEditingCopy] = useState(false);
  const roleConfig =
    REVIEW_ROLES.find(({ key }) => key === role) ?? REVIEW_ROLES[0]!;
  const roleShort = reviewRoleShort(role);
  const decision = output.approval[role];
  const decisionClass = decision ?? "pending";

  const handleReplace = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploading(true);
    setUploadError(null);
    try {
      const replacement = await uploadReplacementAsset({ run, output, file });
      dispatch({
        type: "replace-output-asset",
        id: output.id,
        ...replacement
      });
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
      await downloadOutputAsset(output, index);
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
      className={`neo-qc-focus-card ${decision === "rejected" || output.status === "needs-revision" ? "work-required" : ""}`}
    >
      <div className="neo-qc-focus-asset">
        <div className="neo-qc-focus-visual">
          {isUgcOutput(output) ? (
            <UgcTemplatePreview direction={direction} compact />
          ) : output.assetUrl ? (
            <img
              className="neo-qc-focus-image"
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
        </div>
        {direction?.caption ? (
          <div className="neo-qc-focus-caption">
            <span>{isUgcOutput(output) ? "Caption / script direction" : "Caption"}</span>
            <OutputCaptionText caption={direction.caption} scrollable />
          </div>
        ) : null}
      </div>
      <div className="neo-qc-focus-content">
        <header className="neo-qc-focus-head">
          <div>
            <span className="neo-qc-card-role-mark">
              <i className={roleShort.toLowerCase()}>{roleShort}</i>
              {roleConfig.label}
            </span>
            <span className="neo-qc-card-kicker">Creative {index + 1}</span>
            <span className="neo-qc-content-type-badge">
              <i>{isUgcOutput(output) ? "UG" : output.format.toLowerCase().includes("album") ? "AL" : "ST"}</i>
              {output.format}
            </span>
            <h4>{direction?.hook ?? `Creative ${index + 1}`}</h4>
          </div>
          <span className={`neo-qc-state-badge ${decisionClass}`}>
            {qcDecisionLabel(decision)}
          </span>
        </header>
        <div className="neo-qc-card-meta">
          <span>Content type · {output.format}</span>
          <span>{qcStatusLabel(output.status)}</span>
        </div>
        {isUgcOutput(output) ? (
          <div className="neo-qc-ugc-ownership">
            <i>UG</i>
            UGC skips GD · CS owns script, scenes, and creator direction
          </div>
        ) : null}
        <div className="neo-qc-check-box">
          <b>{roleShort} Checklist</b>
          <ul className="neo-qc-check-list">
            {qcChecklistFor(output, role, roleConfig.checklist).map((check) => (
              <li key={check}>{check}</li>
            ))}
          </ul>
        </div>
        {output.clientStatus === "revision" &&
        output.approvalComments.projectManager ? (
          <div className="neo-qc-work-note client-request">
            <b>Client changes requested</b>
            <p>{output.approvalComments.projectManager}</p>
          </div>
        ) : decision === "rejected" && output.approvalComments[role] ? (
          <div className="neo-qc-work-note">
            <b>Changes requested</b>
            <p>{output.approvalComments[role]}</p>
          </div>
        ) : null}
        <div className="neo-qc-card-actions">
          <div className="neo-qc-card-utilities">
            <div className="neo-qc-asset-actions">
              {role === "graphicDesign" ? <><button
                className="btn secondary small download-action"
                type="button"
                disabled={!output.assetUrl || downloading}
                onClick={() => void handleDownload()}
              >
                {downloading ? "Downloading…" : "Download"}
              </button>
              <label
                className={`btn secondary small upload-inline ${uploading ? "disabled" : ""}`}
              >
                {uploading ? "Uploading…" : "Upload replacement"}
                <input
                  className="file-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={uploading}
                  onChange={handleReplace}
                />
              </label>
              </> : role === "clientService" ? (
                <button className="btn secondary small" type="button" onClick={() => setEditingCopy(true)}>
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
            role={role}
            dispatch={dispatch}
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
  return `neo-creative-${index + 1}.${extension}`;
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

export function ClientStage({ state, dispatch }: StageProps) {
  const sendClientAction: WorkflowAction = { type: "send-client" };
  const sendClientBlocked = workflowActionBlockReason(state, sendClientAction);
  const backAction: WorkflowAction = { type: "set-stage", stage: "approval" };
  const deliverAction: WorkflowAction = { type: "mark-delivered" };
  const deliverBlocked = workflowActionBlockReason(state, deliverAction);
  const approvedCount = state.outputs.filter(
    (output) => output.clientStatus === "approved"
  ).length;
  const allApproved =
    state.outputs.length > 0 && approvedCount === state.outputs.length;
  const [revisionOutputId, setRevisionOutputId] = useState<string | null>(null);
  const [revisionComment, setRevisionComment] = useState("");
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const revisionOutput = state.outputs.find(
    (output) => output.id === revisionOutputId
  );
  const revisionDirection = state.directions.find(
    (direction) => direction.id === revisionOutput?.directionId
  );

  function closeRevisionDialog() {
    setRevisionOutputId(null);
    setRevisionComment("");
    setRevisionError(null);
  }

  function submitRevisionRequest() {
    if (!revisionOutput) return;
    const comment = revisionComment.trim();
    if (!comment) {
      setRevisionError("Add a comment before requesting changes.");
      return;
    }
    dispatch({
      type: "request-client-change",
      id: revisionOutput.id,
      comment
    });
    closeRevisionDialog();
  }

  return (
    <DecisionCard
      eyebrow="Client"
      title="Make feedback easy to act on."
      status={
        allApproved
          ? "Approved"
          : state.clientSent
            ? `${approvedCount}/${state.outputs.length} approved`
            : "Not sent"
      }
      statusClass={allApproved ? "green" : "blue"}
      className="neo-stage-client"
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
            disabled={state.clientSent || Boolean(sendClientBlocked)}
            title={sendClientBlocked ?? undefined}
            onClick={() => dispatch(sendClientAction)}
          >
            Send all
          </button>
          <button
            className="btn secondary"
            type="button"
            onClick={() => dispatch(backAction)}
          >
            Back to Internal QC
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={Boolean(deliverBlocked)}
            title={deliverBlocked ?? undefined}
            onClick={() => dispatch(deliverAction)}
          >
            Mark delivered
          </button>
        </>
      }
    >
      <p className="client-note neo-client-intro">
        Send the approved set, then capture the client decision on each
        creative.
      </p>
      <div className="client-grid neo-client-grid">
        {state.outputs.map((output, index) => {
          const direction = state.directions.find(
            (candidate) => candidate.id === output.directionId
          );
          return (
            <article
              className={`client-card neo-client-card ${output.clientStatus}`}
              key={output.id}
            >
              <div className="preview-area neo-client-preview">
                {output.assetUrl ? (
                  <img
                    className="generated-preview"
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
              </div>
              <div className="client-card-body neo-client-card-body">
                <div className="neo-client-card-copy">
                  <div className="neo-client-card-heading">
                    <span>Creative {index + 1}</span>
                    <span
                      className={`pill ${output.clientStatus === "approved" ? "green" : output.clientStatus === "revision" ? "red" : ""}`}
                    >
                      {output.clientStatus === "revision"
                        ? "Changes requested"
                        : output.clientStatus === "approved"
                          ? "Approved"
                          : output.clientStatus === "sent"
                            ? "In review"
                            : "Pending"}
                    </span>
                  </div>
                  <h3>{direction?.hook ?? `Creative ${index + 1}`}</h3>
                  <p>{direction ? directionSubheadline(direction) : ""}</p>
                </div>
                <div className="neo-client-card-actions">
                  <button
                    className="btn secondary small download-action"
                    type="button"
                    disabled={!output.assetUrl}
                    onClick={() => void downloadOutputAsset(output, index)}
                  >
                    Download
                  </button>
                  <button
                    className="btn secondary small"
                    type="button"
                    disabled={
                      !state.clientSent || output.clientStatus === "approved"
                    }
                    onClick={() => {
                      setRevisionOutputId(output.id);
                      setRevisionComment("");
                      setRevisionError(null);
                    }}
                  >
                    Request change
                  </button>
                  <button
                    className="btn primary small"
                    type="button"
                    disabled={
                      output.clientStatus === "approved" ||
                      Boolean(
                        workflowActionBlockReason(state, {
                          type: "approve-output",
                          id: output.id
                        })
                      )
                    }
                    title={
                      workflowActionBlockReason(state, {
                        type: "approve-output",
                        id: output.id
                      }) ?? undefined
                    }
                    onClick={() => {
                      dispatch({ type: "approve-output", id: output.id });
                    }}
                  >
                    Approve
                  </button>
                </div>
                <div className="neo-client-decision-note">
                  {output.clientStatus === "approved"
                    ? "Approved and ready for delivery."
                    : output.clientStatus === "revision"
                      ? "Feedback recorded and routed back to Internal QC."
                      : "Waiting for the client decision."}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {revisionOutput ? (
        <div className="output-modal-backdrop" onClick={closeRevisionDialog}>
          <div
            className="output-modal neo-client-revision-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-revision-title"
            aria-describedby="client-revision-description"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="output-modal-head">
              <div>
                <p className="eyebrow">Client feedback</p>
                <h3 id="client-revision-title">Request a change</h3>
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
              Feedback stays attached to{" "}
              {revisionDirection?.hook ?? "this creative"} and returns it to
              Internal QC.
            </p>
            <label className="output-modal-prompt-label">
              <span>Required comment</span>
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
                Route to Internal QC
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
      eyebrow="Learn"
      title="Every launch makes the next idea smarter."
      status={state.done ? "Sent" : "Ready"}
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
            Neo reviews this run's approvals and rejections and proposes
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
          Nothing generated yet. Click "Suggest learning" to have Neo
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

export function Overview({
  state,
  workspace,
  workspaceDispatch,
  onOpenStudio
}: StageProps & {
  workspace: WorkspaceState;
  workspaceDispatch: Dispatch<WorkspaceAction>;
  onOpenStudio: () => void;
}) {
  const { brands, loading, error } = useBrands();

  const attentionItems = workspace.runOrder
    .map((id) => workspace.runsById[id])
    .filter((run): run is WorkflowState => Boolean(run))
    .map((run) => computeRunAttention(run))
    .filter((item): item is RunAttention => Boolean(item))
    .sort((a, b) => Number(b.urgent) - Number(a.urgent));

  return (
    <section id="overviewView">
      <div className="ov-head">
        <p className="eyebrow">Live workspace</p>
        <h2>Workboard</h2>
      </div>
      <div className="ov-metrics">
        <div className="ov-metric">
          <b>{loading ? "..." : brands.length}</b>
          <span>Brands</span>
        </div>
        <div className="ov-metric">
          <b>{attentionItems.length}</b>
          <span>Need action</span>
        </div>
      </div>
      <div className="ov-board">
        {error ? (
          <p className="repository-message error">{error.message}</p>
        ) : null}
        {attentionItems.length ? (
          <>
            <div className="ov-group-h">Needs action · {attentionItems.length}</div>
            {attentionItems.map(({ runId, brand, service, stageLabel, note, urgent }) => (
              <div className={`brief-row ${urgent ? "attn" : ""}`} key={runId}>
                <div className="brief-client">
                  <span className="avatar ov-av">{brand.initials}</span>
                  <span>
                    <b>{brand.name}</b>
                    <small>{serviceLabels[service]}</small>
                  </span>
                </div>
                <div className="brief-stage">
                  <span className="stage-chip">{stageLabel}</span>
                </div>
                <div className="brief-ctx">
                  <p>{note}</p>
                </div>
                <div className="brief-actions">
                  <button
                    className="btn small primary"
                    type="button"
                    onClick={() => {
                      workspaceDispatch({ type: "switch-run", id: runId });
                      onOpenStudio();
                    }}
                  >
                    View
                  </button>
                </div>
              </div>
            ))}
          </>
        ) : (
          <div className="empty">
            <b>Nothing needs action right now.</b>
            <p>Runs waiting on internal QC or client review will show up here.</p>
          </div>
        )}
      </div>
      {state.brand ? (
        <p className="overview-active">
          Active studio: <b>{state.brand.name}</b>
        </p>
      ) : null}
    </section>
  );
}
