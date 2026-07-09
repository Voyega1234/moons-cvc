import { useEffect, useState, type Dispatch, type ReactNode } from "react";
import {
  canSelectBrand,
  canStartBrandIngestion,
  type Brand,
  type LibraryItem,
  type LibrarySection
} from "../../domain/brand";
import {
  brandDocumentTypeLabels,
  brandDocumentTypes,
  type BrandDocument,
  type BrandDocumentType,
  type BrandPastWorkItem,
  type BrandProduct
} from "../../domain/brand-memory";
import type { ServiceType } from "../../domain/creative-run";
import { useBrandMemoryRepository } from "../../app/providers/brand-memory-provider";
import { useBrands } from "../../app/providers/brand-provider";
import { useClientIntakeRepository } from "../../app/providers/client-intake-provider";
import { validateFacebookUrl } from "../../domain/client-ingestion";
import { getFileNames } from "../../shared/utils/files";
import { serviceLabels } from "./config";
import type { WorkflowAction, WorkflowState } from "./model";
import { selectedDirectionCount, workflowActionBlockReason } from "./rules";
import { presentBrandMemoryText } from "./brand-memory-presentation";
import { useCreateSelectedHooks } from "./use-create-selected-hooks";
import { useGenerateHooks } from "./use-generate-hooks";

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
  const [profileOpen, setProfileOpen] = useState(false);
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [setupBrand, setSetupBrand] = useState<Brand | null>(null);
  const [mappingBrand, setMappingBrand] = useState<Brand | null>(null);
  const [pastWorkSelected, setPastWorkSelected] = useState(false);
  const continueAction: WorkflowAction = { type: "set-stage", stage: "brief" };
  const continueBlocked = workflowActionBlockReason(state, continueAction);
  const search = state.brandSearch.trim().toLowerCase();
  const visibleBrands = brands.filter((brand) =>
    `${brand.name} ${brand.category} ${brand.mappingStatus ?? ""} ${brand.serviceStatus ?? ""}`
      .toLowerCase()
      .includes(search)
  );
  const sections: readonly [LibrarySection, string][] = [
    ["brand", "Brand kit"],
    ["products", "Products"],
    ["docs", "Documents"],
    ["refs", "References"]
  ];
  const library = state.brand?.library[state.librarySection] ?? [];

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
            onClick={() => setProfileOpen(true)}
          >
            Open brand profile
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
      <div className="start-grid">
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
          <AddClientPanel
            open={addClientOpen}
            onToggle={() => {
              setAddClientOpen((current) => !current);
              setSetupBrand(null);
              setMappingBrand(null);
            }}
            onCreated={refresh}
          />
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
          ) : (
            <BrandLearning state={state} />
          )}
        </div>
        <div className="library-card">
          <div className="tabs">
            {sections.map(([section, label]) => (
              <button
                key={section}
                type="button"
                className={`tab ${!pastWorkSelected && state.librarySection === section ? "active" : ""}`}
                onClick={() => {
                  setPastWorkSelected(false);
                  dispatch({ type: "set-library-section", section });
                }}
              >
                {label}
              </button>
            ))}
            <button
              className={`tab ${pastWorkSelected ? "active" : ""}`}
              type="button"
              onClick={() => setPastWorkSelected(true)}
            >
              Past work
            </button>
          </div>
          {!state.brand ? (
            <div className="empty">
              <b>No library loaded.</b>
              <p>Choose a brand first.</p>
            </div>
          ) : pastWorkSelected ? (
            <PastWorkPreview state={state} clientId={state.brand.id} />
          ) : library.length ? (
            <div className="library-grid">
              {library.map((entry) => (
                <BrandMemoryCard key={entry.id} entry={entry} />
              ))}
            </div>
          ) : (
            <div className="empty">
              <b>No items yet.</b>
              <p>Upload production assets when the API is connected.</p>
            </div>
          )}
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

function BrandMemoryCard({ entry }: { entry: LibraryItem }) {
  const presented = presentBrandMemoryText(entry.description);

  return (
    <div className="lib-item">
      <b>{entry.title}</b>
      <p>{presented.text}</p>
      {presented.citationLabel ? (
        <span className="memory-citation" title={presented.citationTitle ?? ""}>
          {presented.citationLabel}
        </span>
      ) : null}
    </div>
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
  | "past";

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
    ["past", "Past work", "Delivered runs and approved learnings"]
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

  return (
    <section className="memory-editor">
      <header>
        <div>
          <h4>Brand kit</h4>
          <p>Store the core rules: voice, CI, claim safety, and do/don’t.</p>
        </div>
        <div className="memory-actions">
          <button
            className="btn secondary"
            type="button"
            disabled
            title="Upload files in Documents with type Brand guideline."
          >
            Upload guideline
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
      {items.length ? (
        <div className="memory-item-list">
          {items.map((item) => (
            <article className="memory-item" key={item.id}>
              <b>{item.title}</b>
              <p>{item.description}</p>
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
          ))}
        </div>
      ) : !loading ? (
        <div className="empty">
          <b>No brand kit yet.</b>
          <p>Add memory here before using it in generation.</p>
        </div>
      ) : null}
    </section>
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
            {loading ? "Generating hooks..." : "Generate hooks"}
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
          <div className="source-checks">
            <h3>Use from library</h3>
            {[
              "Brand guideline",
              "Logo / CI assets",
              "Product materials",
              "Reference board"
            ].map((label) => (
              <label className="checkline" key={label}>
                <input type="checkbox" defaultChecked /> {label}
              </label>
            ))}
          </div>
        </aside>
      </div>
    </DecisionCard>
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
  const {
    generate: regenerate,
    loading: regenerating,
    error: regenerateError
  } = useGenerateHooks(state, dispatch);
  const {
    create: createSelectedHooks,
    loading: creating,
    error: createError
  } = useCreateSelectedHooks(state, dispatch);

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
            {creating ? "Generating artwork..." : "Create selected hooks"}
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
          <button
            className="btn secondary"
            type="button"
            disabled={regenerating}
            onClick={regenerate}
          >
            {regenerating ? "Regenerating..." : "Regenerate all"}
          </button>
        </div>
      </div>
      {regenerateError ? (
        <p className="repository-message error">{regenerateError}</p>
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
  const runQaAction: WorkflowAction = { type: "run-qa" };
  const runQaBlocked = workflowActionBlockReason(state, runQaAction);
  const approvalAction: WorkflowAction = {
    type: "set-stage",
    stage: "approval"
  };
  const approvalBlocked = workflowActionBlockReason(state, approvalAction);

  return (
    <DecisionCard
      eyebrow="Step 4 · Create"
      title="Create & fix."
      status={state.qaComplete ? "Quality passed" : "Quality waiting"}
      statusClass={state.qaComplete ? "green" : ""}
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
            disabled={Boolean(runQaBlocked)}
            title={runQaBlocked ?? undefined}
            onClick={() => dispatch(runQaAction)}
          >
            {state.qaComplete ? "Recheck quality" : "Check quality"}
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
              {state.qaComplete
                ? "All outputs passed the prototype quality check."
                : "Create outputs, then check quality."}
            </p>
          </div>
          <span className={`pill ${state.qaComplete ? "green" : ""}`}>
            {state.qaComplete ? "No blockers" : "No check yet"}
          </span>
        </div>
        <OutputGrid state={state} />
      </div>
    </DecisionCard>
  );
}

function OutputGrid({ state }: { state: WorkflowState }) {
  if (!state.outputs.length) {
    return (
      <div className="empty">
        <b>No outputs yet.</b>
        <p>Select hooks first.</p>
      </div>
    );
  }

  return (
    <div className="output-grid">
      {state.outputs.map((output, index) => {
        const direction = state.directions.find(
          (candidate) => candidate.id === output.directionId
        );
        return (
          <article
            className={`output-card ${output.status === "ready" ? "ready" : ""}`}
            key={output.id}
          >
            <div className="output-title">
              <b>
                Creative {index + 1} · {output.format}
              </b>
              <span className={`pill ${output.status === "ready" ? "green" : ""}`}>
                {output.status === "ready" ? "Ready" : "Draft"}
              </span>
            </div>
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
            <div className="output-caption">
              <span className="cap-label">Caption</span>
              <p>{direction?.caption}</p>
            </div>
          </article>
        );
      })}
    </div>
  );
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
      <div className="review-grid">
        <OutputGrid state={state} />
        <aside className="review-panel">
          <h3>Approval gate</h3>
          <div className="review-list">
            {["Graphic design", "Client service", "Project manager"].map(
              (role) => (
                <div className="review-row" key={role}>
                  <header>
                    <div>
                      <b>{role}</b>
                      <p>Review brand, content, and delivery readiness.</p>
                    </div>
                    <span className={`pill ${state.approved ? "green" : ""}`}>
                      {state.approved ? "Approved" : "Pending"}
                    </span>
                  </header>
                </div>
              )
            )}
          </div>
        </aside>
      </div>
    </DecisionCard>
  );
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
          <button className="btn secondary" type="button">
            Download ▾
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
                <div className="static-preview">
                  <span className="static-mark" />
                  <div className="static-copy">
                    <h3>{direction?.hook}</h3>
                    <p>{direction?.concept}</p>
                    <span>Learn more</span>
                  </div>
                </div>
              </div>
              <div className="client-card-body">
                <b>Creative {index + 1}</b>
                <span
                  className={`pill ${output.clientStatus === "approved" ? "green" : ""}`}
                >
                  {output.clientStatus}
                </span>
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
          <button className="btn secondary" type="button">
            Download ▾
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
        <OutputGrid state={state} />
      </div>
      <div className="summary-panel summary-learning">
        <h3>Learning saved for next run</h3>
        <div className="learning-grid">
          <div className="learning">
            <b>Hook pattern</b>
            <p>Direct benefit hooks were approved for this run.</p>
          </div>
          <div className="learning">
            <b>Visual pattern</b>
            <p>Product-led layouts stayed clear through quality review.</p>
          </div>
          <div className="learning">
            <b>Approval signal</b>
            <p>The client approved the final set without open blockers.</p>
          </div>
        </div>
      </div>
    </DecisionCard>
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

export function Overview({
  state,
  dispatch,
  onOpenStudio
}: StageProps & { onOpenStudio: () => void }) {
  const { brands, loading, error } = useBrands();
  const rows = brands.slice(0, 3);
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
          <b>2</b>
          <span>Need action</span>
        </div>
      </div>
      <div className="ov-board">
        {error ? (
          <p className="repository-message error">{error.message}</p>
        ) : null}
        <div className="ov-group-h">Needs action · 2</div>
        {rows.map((brand, index) => {
          const selectable = canSelectBrand(brand);
          return (
          <div
            className={`brief-row ${index < 2 ? "attn" : ""} ${selectable ? "" : "disabled"}`}
            key={brand.id}
          >
            <div className="brief-client">
              <span className="avatar ov-av">{brand.initials}</span>
              <span>
                <b>{brand.name}</b>
                <small>{selectable ? brand.category : "No Moons data yet"}</small>
              </span>
            </div>
            <div className="brief-stage">
              <span className="stage-chip">
                {index === 0 ? "Create" : index === 1 ? "Internal QC" : "Brief"}
              </span>
            </div>
            <div className="brief-ctx">
              <p>
                {index < 2
                  ? "This brand has a review item that needs attention."
                  : "The current brief is ready to continue."}
              </p>
            </div>
            <div className="brief-actions">
              <button
                className="btn small primary"
                type="button"
                disabled={!selectable}
                title={
                  selectable
                    ? undefined
                    : "This client is in the mapping sheet but has no brand memory in Moons yet."
                }
                onClick={() => {
                  dispatch({ type: "select-brand", brand });
                  onOpenStudio();
                }}
              >
                View
              </button>
              <button className="btn small secondary" type="button">
                Profile
              </button>
            </div>
          </div>
          );
        })}
      </div>
      {state.brand ? (
        <p className="overview-active">
          Active studio: <b>{state.brand.name}</b>
        </p>
      ) : null}
    </section>
  );
}
