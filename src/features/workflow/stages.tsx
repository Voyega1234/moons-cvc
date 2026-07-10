import {
  useEffect,
  useRef,
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
import type { ApprovalRole, CreativeOutput, ServiceType } from "../../domain/creative-run";
import { useBrandMemoryRepository } from "../../app/providers/brand-memory-provider";
import { useBrands } from "../../app/providers/brand-provider";
import { useClientIntakeRepository } from "../../app/providers/client-intake-provider";
import { validateFacebookUrl } from "../../domain/client-ingestion";
import { regenerateOutputImage } from "../../services/artwork-generation/openai-image-generation";
import { uploadReplacementAsset } from "../../services/artwork-generation/replace-output-asset";
import {
  suggestBrandLearning,
  type LearningSuggestion
} from "../../services/brand-learning/suggest-brand-learning";
import { getFileNames } from "../../shared/utils/files";
import { pluralize } from "../../shared/utils/text";
import { serviceLabels } from "./config";
import type {
  WorkflowAction,
  WorkflowState,
  WorkspaceAction,
  WorkspaceState
} from "./model";
import { selectedDirectionCount, workflowActionBlockReason } from "./rules";
import { presentBrandMemoryText } from "./brand-memory-presentation";
import { useCreateSelectedHooks } from "./use-create-selected-hooks";
import { useGenerateHooks, useGenerateMoreHooks } from "./use-generate-hooks";
import { useRunQualityCheck } from "./use-run-quality-check";

interface StageProps {
  state: WorkflowState;
  dispatch: Dispatch<WorkflowAction>;
}

function DecisionCard({
  eyebrow,
  title,
  status,
  statusClass = "",
  children,
  actions
}: {
  eyebrow: string;
  title: string;
  status: string;
  statusClass?: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <section className="stage active">
      <div className="decision-card">
        <div className="decision-head">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
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
  const [profileOpen, setProfileOpen] = useState(true);
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
      eyebrow="Step 1 · Start"
      title="Choose brand."
      status={state.brand ? "Memory loaded" : "Memory waiting"}
      statusClass={state.brand ? "green" : "blue"}
      actions={
        <>
          <button
            className="btn secondary"
            type="button"
            disabled={!state.brand}
            onClick={() => setProfileOpen((current) => !current)}
          >
            {profileOpen ? "Hide brand profile" : "Open brand profile"}
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={Boolean(continueBlocked)}
            title={continueBlocked ?? undefined}
            onClick={() => dispatch(continueAction)}
          >
            Continue to brief
          </button>
        </>
      }
    >
      <div className="start-single">
        <div>
          <div className="dropdown">
            <button
              className="select-btn"
              type="button"
              aria-haspopup="listbox"
              aria-expanded={state.brandMenuOpen}
              onClick={() => dispatch({ type: "toggle-brand-menu" })}
            >
              <span className="select-left">
                <span className="avatar">
                  {state.brand?.initials ?? "MO"}
                </span>
                <span>
                  <b>{state.brand?.name ?? "Select client"}</b>
                  <small>
                    {state.brand
                      ? clientSubtitle(state.brand)
                      : "Search brands or category"}
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
                          {canAddMapping ? "Add to Moons" : "Set up brand"}
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
            <div className="empty start-hint">
              <b>Start here.</b>
              <p>Load memory once. Use it everywhere.</p>
            </div>
          ) : null}
        </div>
      </div>
      {state.brand && profileOpen ? (
        <BrandProfilePanel
          state={state}
          onClose={() => setProfileOpen(false)}
        />
      ) : null}
    </DecisionCard>
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
          : "Could not add this client to Moons."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="client-intake-card">
      <div className="client-intake-heading">
        <span>Add {brand.name} to Moons</span>
        <small>
          This client exists in the mapping sheet but has no Moons data yet.
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
    return "This client is in the mapping sheet but has no brand memory in Moons yet.";
  }

  if (!canSelectBrand(brand)) {
    return "This client is still being ingested. Wait until Brand Memory is ready.";
  }

  return null;
}

function clientStatusLabel(brand: NonNullable<WorkflowState["brand"]>): string {
  if (brand.existsInSystem === false) return "No Moons data yet";

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

function BrandProfilePanel({
  state,
  onClose
}: {
  state: WorkflowState;
  onClose: () => void;
}) {
  const [section, setSection] = useState<BrandProfileSection>("brand");
  const brand = state.brand;
  if (!brand) return null;

  const sections: readonly [BrandProfileSection, string, string][] = [
    ["brand", "Brand kit", "Rules, voice, CI, claim guardrails"],
    ["products", "Products", "Offers, benefits, audience, claim notes"],
    ["docs", "Documents", "Guidelines, briefs, factsheets, extracted text"],
    ["refs", "References", "Visual inspiration, avoid, competitors"],
    ["past", "Past work", "Delivered runs and approved learnings"],
    ["learning", "Brand learning", "What's working and what to avoid"]
  ];

  return (
    <aside className="brand-profile" aria-label="Brand profile">
      <div className="brand-profile-head">
        <div>
          <p className="eyebrow">Brand profile</p>
          <h3>{brand.name}</h3>
          <p>
            Manage the memory Moons can use later for hooks, artwork, captions,
            QA, and learning.
          </p>
        </div>
        <button className="btn ghost" type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="brand-profile-grid">
        <nav className="brand-profile-tabs" aria-label="Brand memory sections">
          {sections.map(([id, label, description]) => (
            <button
              key={id}
              className={section === id ? "active" : ""}
              type="button"
              onClick={() => setSection(id)}
            >
              <b>{label}</b>
              <span>{description}</span>
            </button>
          ))}
        </nav>
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
      </div>
    </aside>
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
            Moons. Review and edit before generation.
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
    setDescription(item.description);
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
    const existingColors = rule
      ? rule.description
          .split(/[,\n]/)
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
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
    const tags = splitBrandKitTags(item.description);
    return (
      <article className="memory-item" key={item.id}>
        <b>{item.title}</b>
        {tags ? (
          <div className="memory-tags">
            {tags.map((tag) => (
              <BrandKitTag key={tag} value={tag} />
            ))}
          </div>
        ) : (
          <p className="memory-item-desc">{item.description}</p>
        )}
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
            title="Upload a PDF or image guideline. Moons will extract tone, style, and brand colors automatically."
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
              placeholder="Paste brand guideline text — voice, tone, positioning, color names or hex codes..."
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

  const colors = colorsItem
    ? colorsItem.description
        .split(/[,\n]/)
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

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
  const [adsLibraryWork, setAdsLibraryWork] = useState<
    readonly BrandPastWorkItem[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const delivered = state.done && state.outputs.length > 0;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    void repository
      .listAdsLibraryPastWork(clientId)
      .then((items) => {
        if (!active) return;
        setAdsLibraryWork(items);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setError(
          error instanceof Error
            ? error.message
            : "Could not load Ads Library references."
        );
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [clientId, repository]);

  return (
    <section className="memory-editor">
      <header>
        <div>
          <h4>Past work</h4>
          <p>
            Ads Library references appear by default. Delivered Moons work is
            shown separately when available.
          </p>
        </div>
        <span className="pill">Reference only</span>
      </header>
      {error ? <p className="memory-error">{error}</p> : null}
      {loading ? (
        <p className="repository-message">Loading Ads Library...</p>
      ) : null}
      {adsLibraryWork.length ? (
        <>
          <span className="memory-subhead">Ads Library references</span>
          <div className="past-work-grid">
            {adsLibraryWork.map((item) => (
              <article className="past-work-card" key={item.id}>
                <img src={item.imageUrl} alt={item.title} />
                <div>
                  <b>{item.title}</b>
                  {item.description ? <p>{item.description}</p> : null}
                  {item.sourceUrl ? (
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View in Ads Library
                    </a>
                  ) : (
                    <span>Ads Library reference</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}
      {delivered ? (
        <>
          <span className="memory-subhead">Delivered by Moons</span>
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
      {!loading && !adsLibraryWork.length && !delivered ? (
        <div className="empty">
          <b>No past work yet.</b>
          <p>Ads Library references or delivered runs will appear here.</p>
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

export function BriefStage({ state, dispatch }: StageProps) {
  const backAction: WorkflowAction = { type: "set-stage", stage: "start" };
  const generateBlocked = workflowActionBlockReason(state, {
    type: "generate-directions",
    directions: []
  });
  const { generate, loading, error } = useGenerateHooks(state, dispatch);

  return (
    <DecisionCard
      eyebrow="Step 2 · Brief"
      title="Brief + sources."
      status={`${state.brand?.name ?? "Brand"} memory active`}
      statusClass="green"
      actions={
        <>
          <button
            className="btn secondary"
            type="button"
            onClick={() => dispatch(backAction)}
          >
            Back
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={Boolean(generateBlocked) || loading}
            title={generateBlocked ?? undefined}
            onClick={generate}
          >
            {loading ? <Spinner /> : null}
            {loading ? "Generating hooks…" : "Generate hooks"}
          </button>
        </>
      }
    >
      {error ? <p className="repository-message error">{error}</p> : null}
      <div className="brief-grid">
        <div className="brief-box">
          <div className="brief-toolbar">
            <div className="control">
              <label htmlFor="service">Service</label>
              <select
                id="service"
                value={state.service}
                onChange={(event) =>
                  dispatch({
                    type: "set-service",
                    service: event.target.value as ServiceType
                  })
                }
              >
                {Object.entries(serviceLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="qty">
              <button
                type="button"
                aria-label="Decrease quantity"
                onClick={() =>
                  dispatch({
                    type: "set-quantity",
                    quantity: state.quantity - 1
                  })
                }
              >
                −
              </button>
              <input
                aria-label="Quantity"
                type="number"
                min={1}
                max={6}
                value={state.quantity}
                onChange={(event) =>
                  dispatch({
                    type: "set-quantity",
                    quantity: Number(event.target.value)
                  })
                }
              />
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={() =>
                  dispatch({
                    type: "set-quantity",
                    quantity: state.quantity + 1
                  })
                }
              >
                +
              </button>
            </div>
          </div>
          <div className="textarea-wrap">
            <label htmlFor="brief">
              Creative brief <span>{state.brief.length} chars</span>
            </label>
            <textarea
              id="brief"
              value={state.brief}
              onChange={(event) =>
                dispatch({ type: "set-brief", brief: event.target.value })
              }
            />
          </div>
        </div>
        <aside className="attach-panel">
          <label className="upload">
            <b>Attach documents</b>
            <p>PDF, product sheet, promo, references.</p>
            <span className="btn secondary">Choose files</span>
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
          <div className="chips">
            {state.attachments.length ? (
              state.attachments.map((name) => (
                <span className="chip" key={name}>
                  {name}
                </span>
              ))
            ) : (
              <span className="chip">No files attached yet</span>
            )}
          </div>
          <ReferenceLibraryPicker state={state} dispatch={dispatch} />
        </aside>
      </div>
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
  const [expanded, setExpanded] = useState<
    Record<ReferenceLibraryCategory, boolean>
  >({ guideline: true, logo: true, product: true, reference: true });
  const clientId = state.brand?.id;
  const brand = state.brand;

  function toggleExpanded(key: ReferenceLibraryCategory) {
    setExpanded((current) => ({ ...current, [key]: !current[key] }));
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
      repository.listAdsLibraryPastWork(clientId)
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
        .filter((item) => item.imageUrl)
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
            <label className="reference-accordion-toggle">
              <input
                type="checkbox"
                checked={expanded[key]}
                onChange={() => toggleExpanded(key)}
              />
              <b>{label}</b>
            </label>
            {expanded[key] ? renderCategoryBody(key) : null}
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
  const {
    generateMore,
    loading: generatingMore,
    error: generateMoreError
  } = useGenerateMoreHooks(state, dispatch);
  const {
    create: createSelectedHooks,
    loading: creating,
    error: createError
  } = useCreateSelectedHooks(state, dispatch);

  function handleGenerateMore() {
    generateMore(moreInstructions);
    setMoreInstructions("");
  }

  return (
    <DecisionCard
      eyebrow="Step 3 · Hook"
      title="Pick hooks."
      status={`${selected}/${state.quantity} selected`}
      statusClass="blue"
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
            {creating ? "Generating artwork…" : "Create selected hooks"}
          </button>
        </>
      }
    >
      <div className="direction-tools">
        <div>
          <h3>Shortlist hooks.</h3>
          <p>
            Select {state.quantity} hooks, or let Moons pick the strongest set.
          </p>
        </div>
        <div className="dir-tool-btns">
          <button
            className="btn secondary"
            type="button"
            onClick={() => dispatch(autoSelectAction)}
          >
            Let Moons pick
          </button>
        </div>
      </div>
      <div className="direction-generate-more">
        <input
          value={moreInstructions}
          disabled={generatingMore}
          placeholder="Add more direction for this round (optional)"
          onChange={(event) => setMoreInstructions(event.target.value)}
        />
        <button
          className="btn secondary"
          type="button"
          disabled={generatingMore}
          onClick={handleGenerateMore}
        >
          {generatingMore ? <Spinner /> : null}
          {generatingMore ? "Generating more…" : "Generate more"}
        </button>
      </div>
      {generateMoreError ? (
        <p className="repository-message error">{generateMoreError}</p>
      ) : null}
      {createError ? (
        <p className="repository-message error">{createError}</p>
      ) : null}
      <div className="direction-grid">
        {state.directions.map((direction, index) => (
          <button
            className={`direction-card ${direction.selected ? "selected" : ""}`}
            type="button"
            key={direction.id}
            onClick={() =>
              dispatch({ type: "toggle-direction", id: direction.id })
            }
          >
            <div className="direction-top">
              <span className="pill">Hook {index + 1}</span>
              <span className="check-dot">✓</span>
            </div>
            <div>
              <p className="hook-label">Hook</p>
              <h3 className="hook">{direction.hook}</h3>
              <p className="concept">Concept: {direction.concept}</p>
            </div>
            <div className="info-list">
              <dl>
                <dt>Why it might work</dt>
                <dd>{direction.why}</dd>
              </dl>
              <dl>
                <dt>Visual direction</dt>
                <dd>{direction.visual}</dd>
              </dl>
              <dl>
                <dt>CTA</dt>
                <dd>{direction.cta}</dd>
              </dl>
            </div>
          </button>
        ))}
      </div>
    </DecisionCard>
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
      eyebrow="Step 4 · Create"
      title="Create & fix."
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
      actions={
        <>
          <button
            className="btn secondary"
            type="button"
            onClick={() => dispatch(backAction)}
          >
            Back to Hook
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
      <div className="studio-stack">
        <div className="studio-toolbar">
          <div>
            <h3>Creative set</h3>
            <p>
              {!state.qaComplete
                ? "Create outputs, then check quality."
                : failedCount
                  ? "Moons flagged issues on some creatives — check the notes below."
                  : "All outputs passed the AI quality review."}
            </p>
          </div>
          <span
            className={`pill ${state.qaComplete && !failedCount ? "green" : failedCount ? "red" : ""}`}
          >
            {!state.qaComplete
              ? "No check yet"
              : failedCount
                ? `${failedCount} flagged`
                : "No blockers"}
          </span>
        </div>
        {qaError ? <p className="repository-message error">{qaError}</p> : null}
        <OutputGrid state={state} dispatch={dispatch} />
      </div>
    </DecisionCard>
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
  const previewOutput =
    state.outputs.find((output) => output.id === previewOutputId) ?? null;
  const previewDirection = previewOutput
    ? state.directions.find(
        (candidate) => candidate.id === previewOutput.directionId
      )
    : undefined;

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
      <div className="output-grid">
        {state.outputs.map((output, index) => {
          const direction = state.directions.find(
            (candidate) => candidate.id === output.directionId
          );
          return (
            <article
              className={`output-card ${output.status === "ready" || output.status === "fixed" ? "ready" : ""} ${output.status === "needs-revision" ? "attn" : ""}`}
              key={output.id}
            >
              <div className="output-title">
                <b>
                  Creative {index + 1} · {output.format}
                </b>
                <span
                  className={`pill ${output.status === "ready" || output.status === "fixed" ? "green" : output.status === "needs-revision" ? "red" : ""}`}
                >
                  {output.status === "needs-revision"
                    ? "Needs revision"
                    : output.status === "ready" || output.status === "fixed"
                      ? "Ready"
                      : "Draft"}
                </span>
              </div>
              <button
                className="preview-area"
                type="button"
                onClick={() => setPreviewOutputId(output.id)}
              >
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
                      <p>{direction?.concept}</p>
                      <span>Learn more</span>
                    </div>
                  </div>
                )}
              </button>
              {output.status === "needs-revision" && output.qaNote ? (
                <p className="output-qa-note">{output.qaNote}</p>
              ) : null}
              <div className="output-caption">
                <span className="cap-label">Caption</span>
                <OutputCaptionText caption={direction?.caption} />
              </div>
            </article>
          );
        })}
      </div>
      {previewOutput ? (
        <OutputRegenerateModal
          run={state}
          output={previewOutput}
          direction={previewDirection}
          dispatch={dispatch}
          onClose={() => setPreviewOutputId(null)}
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
  onClose
}: {
  run: WorkflowState;
  output: CreativeOutput;
  direction: WorkflowState["directions"][number] | undefined;
  dispatch: Dispatch<WorkflowAction>;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState("");
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
          {output.assetUrl ? (
            <img src={output.assetUrl} alt={direction?.hook ?? "Creative preview"} />
          ) : (
            <div className="static-preview">
              <span className="static-mark" />
              <div className="static-copy">
                <h3>{direction?.hook}</h3>
                <p>{direction?.concept}</p>
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
          {run.referenceImages.length
            ? `Using ${run.referenceImages.length} reference ${
                run.referenceImages.length === 1 ? "image" : "images"
              } from Brief · Use from library: ${run.referenceImages
                .map((item) => item.label)
                .join(", ")}`
            : "No reference images selected. Pick logo or past work in Brief · Use from library."}
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
            {regenerating ? "Regenerating…" : "Regenerate image"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OutputCaptionText({ caption }: { caption: string | undefined }) {
  const [expanded, setExpanded] = useState(false);
  if (!caption) return null;

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

const CAPTION_CLAMP_THRESHOLD = 220;

const REVIEW_ROLES: readonly {
  key: ApprovalRole;
  label: string;
  description: string;
}[] = [
  {
    key: "graphicDesign",
    label: "GD Review",
    description: "Visual craft, layout, hierarchy, safe margins"
  },
  {
    key: "clientService",
    label: "CS Review",
    description: "Hook strength, message clarity, performance angle"
  },
  {
    key: "projectManager",
    label: "PM Review",
    description: "Client fit, brief match, final readiness"
  }
];

export function ApprovalStage({ state, dispatch }: StageProps) {
  const backAction: WorkflowAction = { type: "set-stage", stage: "studio" };
  const approveAllAction: WorkflowAction = { type: "approve-all" };
  const approveAllBlocked = workflowActionBlockReason(
    state,
    approveAllAction
  );
  const clientAction: WorkflowAction = { type: "set-stage", stage: "client" };
  const clientBlocked = workflowActionBlockReason(state, clientAction);
  const carouselRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const scrollToIndex = (index: number) => {
    const el = carouselRef.current;
    if (!el) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: "smooth" });
  };

  const handleScroll = () => {
    const el = carouselRef.current;
    if (!el || !el.clientWidth) return;
    setActiveIndex(Math.round(el.scrollLeft / el.clientWidth));
  };

  return (
    <DecisionCard
      eyebrow="Step 5 · Internal QC"
      title="Internal QC."
      status={state.approved ? "Approved" : "Pending"}
      statusClass={state.approved ? "green" : "blue"}
      actions={
        <>
          <button
            className="btn secondary"
            type="button"
            onClick={() => dispatch(backAction)}
          >
            Back to Create
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
        <>
          <div className="qc-carousel" ref={carouselRef} onScroll={handleScroll}>
            {state.outputs.map((output, index) => (
              <div className="qc-slide" key={output.id}>
                <QcSlide
                  index={index}
                  output={output}
                  direction={state.directions.find(
                    (candidate) => candidate.id === output.directionId
                  )}
                  brand={state.brand}
                  run={state}
                  dispatch={dispatch}
                />
              </div>
            ))}
          </div>
          {state.outputs.length > 1 ? (
            <div className="qc-dots">
              {state.outputs.map((output, index) => (
                <button
                  key={output.id}
                  type="button"
                  className={`qc-dot ${index === activeIndex ? "active" : ""}`}
                  onClick={() => scrollToIndex(index)}
                  aria-label={`Show creative ${index + 1}`}
                >
                  {index + 1}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="empty">
          <b>No creatives yet.</b>
          <p>Create outputs first.</p>
        </div>
      )}
    </DecisionCard>
  );
}

function ApprovalCommentField({
  value,
  onSave
}: {
  value: string;
  onSave: (comment: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <div className="review-comment">
      <textarea
        value={draft}
        placeholder="Leave a comment for the other reviewers..."
        rows={2}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button
        type="button"
        className="btn secondary small"
        disabled={draft === value}
        onClick={() => onSave(draft)}
      >
        Save comment
      </button>
    </div>
  );
}

function QcSlide({
  index,
  output,
  direction,
  brand,
  run,
  dispatch
}: {
  index: number;
  output: CreativeOutput;
  direction: WorkflowState["directions"][number] | undefined;
  brand: WorkflowState["brand"];
  run: WorkflowState;
  dispatch: Dispatch<WorkflowAction>;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [captionExpanded, setCaptionExpanded] = useState(false);

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

  return (
    <>
      <div className="fb-mockup">
        <div className="fb-header">
          <span className="fb-avatar">{brand?.initials ?? "MO"}</span>
          <div className="fb-meta">
            <div className="fb-name-row">
              <b>{brand?.name ?? "Brand"}</b>
              <VerifiedBadge />
              <span className="fb-follow">· Follow</span>
            </div>
            <div className="fb-timestamp">
              <span>Just now</span>
              <GlobeIcon />
            </div>
          </div>
          <span className="fb-more">···</span>
        </div>
        {direction?.caption ? (
          <div>
            <p
              className={`fb-caption ${captionExpanded ? "expanded" : ""}`}
            >
              {direction.caption}
            </p>
            {direction.caption.length > CAPTION_CLAMP_THRESHOLD ? (
              <button
                className="fb-see-more"
                type="button"
                onClick={() => setCaptionExpanded((value) => !value)}
              >
                {captionExpanded ? "See less" : "See more"}
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="fb-image">
          {output.assetUrl ? (
            <img
              src={output.assetUrl}
              alt={direction?.hook ?? `Creative ${index + 1}`}
            />
          ) : (
            <div className="static-preview">
              <span className="static-mark" />
              <div className="static-copy">
                <h3>{direction?.hook}</h3>
                <p>{direction?.concept}</p>
                <span>Learn more</span>
              </div>
            </div>
          )}
        </div>
        <div className="fb-actions">
          <span>Like</span>
          <span>Comment</span>
          <span>Share</span>
        </div>
        <div className="qc-creative-actions">
          <a
            className={`btn secondary small ${output.assetUrl ? "" : "disabled"}`}
            href={output.assetUrl}
            download
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              if (!output.assetUrl) event.preventDefault();
            }}
          >
            Download
          </a>
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
        </div>
        {uploadError ? (
          <p className="repository-message error">{uploadError}</p>
        ) : null}
      </div>

      <div
        className={`qc-gate-panel ${output.status === "needs-revision" ? "attn" : ""}`}
      >
        <div className="output-title">
          <b>
            Creative {index + 1} · {output.format}
          </b>
          <span className={`pill ${qcStatusPillClass(output.status)}`}>
            {qcStatusLabel(output.status)}
          </span>
        </div>
        <div className="review-list qc-review-list">
          <h3>Approval gate</h3>
          {REVIEW_ROLES.map(({ key, label, description }) => {
            const decision = output.approval[key];
            return (
              <div className="review-row" key={key}>
                <header>
                  <div>
                    <b>{label}</b>
                    <p>{description}</p>
                  </div>
                  <span className={`pill ${qcDecisionPillClass(decision)}`}>
                    {qcDecisionLabel(decision)}
                  </span>
                </header>
                <div className="review-row-actions">
                  <button
                    className="btn primary small"
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: "review-output",
                        id: output.id,
                        role: key,
                        decision: "approved"
                      })
                    }
                  >
                    Approve
                  </button>
                  <button
                    className="btn danger small"
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: "review-output",
                        id: output.id,
                        role: key,
                        decision: "rejected"
                      })
                    }
                  >
                    Reject
                  </button>
                </div>
                <ApprovalCommentField
                  value={output.approvalComments[key]}
                  onSave={(comment) =>
                    dispatch({
                      type: "comment-output",
                      id: output.id,
                      role: key,
                      comment
                    })
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function VerifiedBadge() {
  return (
    <svg className="fb-badge" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="#1877f2"
        d="M12 2l2.2 1.3 2.5-.7 1.5 2.1 2.5 1-.1 2.6 1.7 2-1.7 2 .1 2.6-2.5 1-1.5 2.1-2.5-.7L12 22l-2.2-1.3-2.5.7-1.5-2.1-2.5-1 .1-2.6-1.7-2 1.7-2-.1-2.6 2.5-1 1.5-2.1 2.5.7z"
      />
      <path
        fill="#fff"
        d="M10 13.4l-1.7-1.7-1.2 1.2 2.9 2.9 5.3-5.3-1.2-1.2z"
      />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg
      className="fb-globe"
      viewBox="0 0 16 16"
      width="11"
      height="11"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 0a8 8 0 100 16A8 8 0 008 0zm5.6 4.8h-2.2a10.6 10.6 0 00-.9-2.6 6.6 6.6 0 013.1 2.6zM8 1.4c.6.8 1.1 1.8 1.4 3H6.6c.3-1.2.8-2.2 1.4-3zM1.5 9.4a6.5 6.5 0 010-2.8h2.4a10.9 10.9 0 000 2.8H1.5zm.9 1.4h2.2c.2.9.5 1.8.9 2.6a6.6 6.6 0 01-3.1-2.6zm2.2-5.6H2.4a6.6 6.6 0 013.1-2.6c-.4.8-.7 1.7-.9 2.6zM8 14.6c-.6-.8-1.1-1.8-1.4-3h2.8c-.3 1.2-.8 2.2-1.4 3zm1.8-4.4H6.2a9.4 9.4 0 010-2.8h3.6a9.4 9.4 0 010 2.8zm.2 3.8c.4-.8.7-1.7.9-2.6h2.2a6.6 6.6 0 01-3.1 2.6zm1.1-4h2.4a6.5 6.5 0 010 2.8h-2.4a10.9 10.9 0 000-2.8z" />
    </svg>
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

function qcStatusPillClass(status: CreativeOutput["status"]): string {
  if (status === "ready" || status === "fixed") return "green";
  if (status === "needs-revision") return "red";
  return "";
}

function qcDecisionLabel(decision: CreativeOutput["approval"][ApprovalRole]): string {
  if (decision === "approved") return "Approved";
  if (decision === "rejected") return "Rejected";
  return "Pending";
}

function qcDecisionPillClass(
  decision: CreativeOutput["approval"][ApprovalRole]
): string {
  if (decision === "approved") return "green";
  if (decision === "rejected") return "red";
  return "";
}

function downloadAllOutputs(outputs: WorkflowState["outputs"]) {
  for (const output of outputs) {
    if (!output.assetUrl) continue;
    const link = document.createElement("a");
    link.href = output.assetUrl;
    link.download = "";
    link.target = "_blank";
    link.rel = "noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

export function ClientStage({ state, dispatch }: StageProps) {
  const sendClientAction: WorkflowAction = { type: "send-client" };
  const sendClientBlocked = workflowActionBlockReason(state, sendClientAction);
  const backAction: WorkflowAction = { type: "set-stage", stage: "studio" };
  const deliverAction: WorkflowAction = { type: "mark-delivered" };
  const deliverBlocked = workflowActionBlockReason(state, deliverAction);
  const approvedCount = state.outputs.filter(
    (output) => output.clientStatus === "approved"
  ).length;
  const allApproved =
    state.outputs.length > 0 && approvedCount === state.outputs.length;

  return (
    <DecisionCard
      eyebrow="Step 6 · Client review"
      title="Client review."
      status={
        allApproved
          ? "Approved"
          : state.clientSent
            ? `${approvedCount}/${state.outputs.length} approved`
            : "Not sent"
      }
      statusClass={allApproved ? "green" : "blue"}
      actions={
        <>
          <button
            className="btn secondary"
            type="button"
            disabled={!state.outputs.some((output) => output.assetUrl)}
            onClick={() => downloadAllOutputs(state.outputs)}
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
            Back to Create
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
      <p className="client-note">
        Send the approved set, then capture the client decision on each
        creative.
      </p>
      <div className="client-grid">
        {state.outputs.map((output, index) => {
          const direction = state.directions.find(
            (candidate) => candidate.id === output.directionId
          );
          return (
            <article className="client-card" key={output.id}>
              <div className="preview-area">
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
                      <p>{direction?.concept}</p>
                      <span>Learn more</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="client-card-body">
                <b>Creative {index + 1}</b>
                <span
                  className={`pill ${output.clientStatus === "approved" ? "green" : ""}`}
                >
                  {output.clientStatus}
                </span>
                <a
                  className={`btn secondary small ${output.assetUrl ? "" : "disabled"}`}
                  href={output.assetUrl}
                  download
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => {
                    if (!output.assetUrl) event.preventDefault();
                  }}
                >
                  Download
                </a>
                <button
                  className="btn primary"
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
            </article>
          );
        })}
      </div>
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
      eyebrow="Step 7 · Delivered"
      title="Delivered."
      status={state.done ? "Sent" : "Ready"}
      statusClass="green"
      actions={
        <>
          <button
            className="btn secondary"
            type="button"
            disabled={!state.outputs.some((output) => output.assetUrl)}
            onClick={() => downloadAllOutputs(state.outputs)}
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
        <Metric value={state.brand?.name ?? "—"} label="Client" />
        <Metric value={serviceLabels[state.service]} label="Service" />
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
            Moons reviews this run's approvals and rejections and proposes
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
          Nothing generated yet. Click "Suggest learning" to have Moons
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
        note: "Approved internally — ready to send to the client.",
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
      note: "Final set ready — mark sent to close this run.",
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
        <p className="eyebrow">Daily brief</p>
        <h2>Brief</h2>
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
