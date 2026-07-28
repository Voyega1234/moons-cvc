import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import type { LibraryItem } from "../../../domain/brand";
import {
  artworkOutputSizeLabel,
  artworkOutputSizes,
  type ReferenceImageSelection,
  type ServiceType
} from "../../../domain/creative-run";
import type { WorkflowAction, WorkflowState } from "../model";
import {
  creativeMixItems,
  selectedBrandProducts,
  selectedUploadedMaterials,
  totalCreativeMixQuantity
} from "../model";

const confirmationServiceLabels: Partial<Record<ServiceType, string>> = {
  "single-static": "Single",
  "album-post": "Album",
  "ugc-video": "UGC"
};

const confirmationServiceIcons: Partial<Record<ServiceType, string>> = {
  "single-static": "ST",
  "album-post": "AL",
  "ugc-video": "UG"
};

function productInitials(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export function BriefConfirmationModal({
  open,
  state,
  dispatch,
  references,
  uploadPending,
  uploadError,
  onUploadReference,
  materialBrowser,
  onBack,
  onConfirm
}: {
  open: boolean;
  state: WorkflowState;
  dispatch: Dispatch<WorkflowAction>;
  references: readonly ReferenceImageSelection[];
  uploadPending: boolean;
  uploadError: string | null;
  onUploadReference: (event: ChangeEvent<HTMLInputElement>) => void;
  materialBrowser: ReactNode;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const [assetView, setAssetView] = useState<"reference" | "material">(
    "reference"
  );
  const products = state.brand?.library.products ?? [];
  const selectedProducts = selectedBrandProducts(state);
  const selectedProductIds = new Set(
    selectedProducts.map((product) => product.id)
  );
  const selectedReferenceIds = new Set(
    state.referenceImages.map((reference) => reference.id)
  );
  const selectedMaterials = selectedUploadedMaterials(state);
  const activeMix = creativeMixItems(state).filter(
    (item) =>
      item.quantity > 0 &&
      (item.service === "single-static" ||
        item.service === "album-post" ||
        item.service === "ugc-video")
  );
  const productSelectionValid =
    products.length === 0 || selectedProducts.length > 0;

  useEffect(() => {
    if (!open) return;
    if (state.artworkMode === "reference-library") {
      dispatch({ type: "set-artwork-mode", mode: "design-system" });
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !uploadPending) onBack();
    }

    document.addEventListener("keydown", handleKeyDown);
    const focusTimer = window.setTimeout(() => backButtonRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.clearTimeout(focusTimer);
    };
  }, [dispatch, onBack, open, state.artworkMode, uploadPending]);

  if (!open || typeof document === "undefined") return null;
  const portalRoot = document.querySelector(".compass-app") ?? document.body;

  return createPortal(
    <div
      className="output-modal-backdrop brief-confirm-backdrop"
      onClick={() => {
        if (!uploadPending) onBack();
      }}
    >
      <section
        className="output-modal brief-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="brief-confirm-head">
          <div>
            <p className="eyebrow">Final check before Hook</p>
            <h3 id={titleId}>Confirm what Creative Compass should use</h3>
            <p>
              Check the amount, brief, products, generation settings, and
              visual references. Opt out anything that should not shape this run.
            </p>
          </div>
          <span className="brief-confirm-ready">Ready to confirm</span>
        </header>

        <div className="brief-confirm-body">
          <section className="confirm-section">
            <header className="confirm-section-head">
              <div className="confirm-section-title">
                <span className="confirm-section-number">1</span>
                <span>
                  <b>Item &amp; amount</b>
                  <small>Final deliverable mix</small>
                </span>
              </div>
              <span className="confirm-section-status">
                {totalCreativeMixQuantity(state)} items
              </span>
            </header>
            <div className="confirm-mix-row">
              {activeMix.map((item) => (
                <span className="confirm-mix-chip" key={item.id}>
                  <i>{confirmationServiceIcons[item.service]}</i>
                  <b>
                    {confirmationServiceLabels[item.service] ?? item.service}
                  </b>
                  <span>× {item.quantity}</span>
                </span>
              ))}
            </div>
          </section>

          <section className="confirm-section">
            <header className="confirm-section-head">
              <div className="confirm-section-title">
                <span className="confirm-section-number">2</span>
                <span>
                  <b>Brief</b>
                  <small>Exact direction sent into Hook</small>
                </span>
              </div>
              <span className="confirm-section-status">
                {state.brief.trim().length} chars
              </span>
            </header>
            <div className="confirm-brief-copy">{state.brief.trim()}</div>
          </section>

          <section className="confirm-section full">
            <header className="confirm-section-head">
              <div className="confirm-section-title">
                <span className="confirm-section-number">3</span>
                <span>
                  <b>Selected product info</b>
                  <small>Click a product to opt it out of this run</small>
                </span>
              </div>
              <span
                className={`confirm-section-status ${
                  productSelectionValid ? "" : "warning"
                }`}
              >
                {selectedProducts.length} / {products.length} used
              </span>
            </header>
            {products.length ? (
              <div className="confirm-product-grid">
                {products.map((product: LibraryItem) => {
                  const selected = selectedProductIds.has(product.id);
                  return (
                    <button
                      className={`confirm-product ${
                        selected ? "" : "excluded"
                      }`}
                      type="button"
                      aria-pressed={selected}
                      key={product.id}
                      onClick={() =>
                        dispatch({
                          type: "toggle-product-context",
                          id: product.id
                        })
                      }
                    >
                      <span className="confirm-product-art">
                        {product.assetUrl ? (
                          <img src={product.assetUrl} alt="" />
                        ) : (
                          productInitials(product.title)
                        )}
                      </span>
                      <span className="confirm-product-copy">
                        <b>{product.title}</b>
                        <small>
                          {selected
                            ? "Included in this run"
                            : "Excluded from this run"}
                        </small>
                      </span>
                      <i className="confirm-product-toggle" />
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="confirm-empty">
                <b>No product folders yet</b>
                <p>
                  You can continue without one, or go back and add product
                  context.
                </p>
              </div>
            )}
            {!productSelectionValid ? (
              <p className="confirm-selection-error" role="alert">
                Keep at least one product in this run.
              </p>
            ) : null}
          </section>

          <section className="confirm-section full">
            <header className="confirm-section-head">
              <div className="confirm-section-title">
                <span className="confirm-section-number">4</span>
                <span>
                  <b>Artwork generation</b>
                  <small>Final generation mode, concept model, and output size</small>
                </span>
              </div>
              <span className="confirm-section-status">GPT Image 2</span>
            </header>
            <div
              className="confirm-generation-grid"
              role="group"
              aria-label="Artwork settings"
            >
              <div className="confirm-generation-setting">
                <span className="confirm-generation-label">Artwork mode</span>
                <div
                  className="confirm-generation-mode-options"
                  role="group"
                  aria-label="Artwork mode"
                >
                  <button
                    className={`confirm-generation-mode ${
                      state.artworkMode === "standard" ? "active" : ""
                    }`}
                    type="button"
                    aria-pressed={state.artworkMode === "standard"}
                    onClick={() =>
                      dispatch({
                        type: "set-artwork-mode",
                        mode: "standard"
                      })
                    }
                  >
                    Standard
                  </button>
                  <button
                    className={`confirm-generation-mode ${
                      state.artworkMode === "design-system" ? "active" : ""
                    }`}
                    type="button"
                    aria-pressed={state.artworkMode === "design-system"}
                    onClick={() =>
                      dispatch({
                        type: "set-artwork-mode",
                        mode: "design-system"
                      })
                    }
                  >
                    Design system
                  </button>
                  <button
                    className={`confirm-generation-mode ${
                      state.artworkMode === "design-system-new" ? "active" : ""
                    }`}
                    type="button"
                    aria-pressed={state.artworkMode === "design-system-new"}
                    onClick={() =>
                      dispatch({
                        type: "set-artwork-mode",
                        mode: "design-system-new"
                      })
                    }
                  >
                    Design system (new)
                  </button>
                </div>
              </div>
              <label className="confirm-generation-setting">
                <span className="confirm-generation-label">
                  Creative concept model
                </span>
                <select
                  aria-label="Creative concept model"
                  value={state.imagePromptModel}
                  onChange={(event) =>
                    dispatch({
                      type: "set-image-prompt-model",
                      model: event.target
                        .value as WorkflowState["imagePromptModel"]
                    })
                  }
                >
                  <option value="gpt-5.6-terra">
                    GPT · OpenAI → GPT Image 2
                  </option>
                  <option value="anthropic/claude-sonnet-4.6">
                    Claude · OpenRouter → GPT Image 2
                  </option>
                </select>
              </label>
              <label className="confirm-generation-setting">
                <span className="confirm-generation-label">Output size</span>
                <select
                  aria-label="Output size"
                  value={state.outputSize}
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
            </div>
          </section>

          <section className="confirm-section full">
            <header className="confirm-section-head">
              <div className="confirm-section-title">
                <span className="confirm-section-number">5</span>
                <span>
                  <b>Image references</b>
                  <small>
                    Image Reference guides style; Image Materials are source
                    objects used in the artwork
                  </small>
                </span>
              </div>
              <div className="confirm-reference-actions">
                <span className="confirm-section-status">
                  {assetView === "reference"
                    ? `${state.referenceImages.length} references selected`
                    : `${selectedMaterials.length} materials selected`}
                </span>
                {assetView === "reference" ? (
                  <label
                    className={`btn secondary small ${
                      uploadPending ? "disabled" : ""
                    }`}
                  >
                    {uploadPending ? "Uploading…" : "Upload files"}
                    <input
                      className="file-input"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      aria-label="Upload reference in confirmation"
                      disabled={uploadPending}
                      onChange={onUploadReference}
                    />
                  </label>
                ) : null}
              </div>
            </header>
            <div
              className="confirm-input-tabs"
              role="tablist"
              aria-label="Creative input type"
            >
              <button
                className={assetView === "reference" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={assetView === "reference"}
                onClick={() => setAssetView("reference")}
              >
                Image Reference
                <span>{state.referenceImages.length}</span>
              </button>
              <button
                className={assetView === "material" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={assetView === "material"}
                onClick={() => setAssetView("material")}
              >
                Image Materials
                <span>{selectedMaterials.length}</span>
              </button>
            </div>
            {uploadError ? (
              <p className="confirm-selection-error" role="alert">
                {uploadError}
              </p>
            ) : null}
            {assetView === "reference" && references.length ? (
              <div className="confirm-reference-grid">
                {references.map((reference) => {
                  const selected = selectedReferenceIds.has(reference.id);
                  return (
                    <button
                      className={`confirm-reference ${
                        selected ? "" : "excluded"
                      }`}
                      type="button"
                      aria-pressed={selected}
                      key={reference.id}
                      onClick={() =>
                        dispatch({
                          type: "toggle-reference-image",
                          item: reference
                        })
                      }
                    >
                      <span className="confirm-reference-preview">
                        <img src={reference.url} alt="" />
                      </span>
                      <b>{reference.label}</b>
                      <small>{selected ? "Selected" : "Not used"}</small>
                      <i className="confirm-reference-check">
                        {selected ? "✓" : "−"}
                      </i>
                    </button>
                  );
                })}
              </div>
            ) : assetView === "reference" ? (
              <div className="confirm-empty">
                <b>No image references</b>
                <p>
                  Upload files or browse the library and Google Drive. References
                  should guide style or composition—not become source objects.
                </p>
              </div>
            ) : (
              <div className="brief-confirm-material-browser">
                {materialBrowser}
              </div>
            )}
          </section>
        </div>

        <footer className="brief-confirm-actions">
          <span>Nothing is generated until you confirm.</span>
          <div>
            <button
              className="btn secondary"
              type="button"
              disabled={uploadPending}
              ref={backButtonRef}
              onClick={onBack}
            >
              Back
            </button>
            <button
              className="btn orange"
              type="button"
              disabled={!productSelectionValid || uploadPending}
              title={
                productSelectionValid
                  ? undefined
                  : "Keep at least one product in this run"
              }
              onClick={onConfirm}
            >
              Confirm &amp; generate hooks →
            </button>
          </div>
        </footer>
      </section>
    </div>,
    portalRoot
  );
}
