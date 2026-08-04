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
  inferredReferenceImageRole,
  normalizeUserSelectableArtworkMode,
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
import { ArtworkModeSelector } from "./artwork-mode-selector";

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

export function ConfirmationReferenceGrid({
  references,
  selectedReferences,
  onToggle
}: {
  references: readonly ReferenceImageSelection[];
  selectedReferences: readonly ReferenceImageSelection[];
  onToggle: (reference: ReferenceImageSelection) => void;
}) {
  const availableImageReferences = references.filter(
    (reference) => inferredReferenceImageRole(reference) !== "logo"
  );
  const selectedReferenceIds = new Set(
    selectedReferences
      .filter((reference) => inferredReferenceImageRole(reference) !== "logo")
      .map((reference) => reference.id)
  );

  if (!availableImageReferences.length) {
    return (
      <div className="confirm-empty">
        <b>No image references</b>
        <p>
          Add or select references to guide style and composition. References
          are not treated as source objects.
        </p>
      </div>
    );
  }

  return (
    <div className="confirm-reference-grid">
      {availableImageReferences.map((reference) => {
        const selected = selectedReferenceIds.has(reference.id);
        return (
          <button
            className={`confirm-reference ${selected ? "" : "excluded"}`}
            type="button"
            aria-pressed={selected}
            key={reference.id}
            onClick={() => onToggle(reference)}
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
  );
}

export function BriefConfirmationModal({
  open,
  state,
  dispatch,
  references,
  uploadPending,
  uploadError,
  onUploadReference,
  referenceBrowser,
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
  referenceBrowser?: ReactNode;
  materialBrowser: ReactNode;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const onBackRef = useRef(onBack);
  const [assetView, setAssetView] = useState<"reference" | "material">(
    "reference"
  );
  const [managingReferences, setManagingReferences] = useState(false);
  const artworkMode = normalizeUserSelectableArtworkMode(state.artworkMode);
  const products = state.brand?.library.products ?? [];
  const selectedProducts = selectedBrandProducts(state);
  const imageReferences = state.referenceImages.filter(
    (reference) => inferredReferenceImageRole(reference) !== "logo"
  );
  const selectedProductIds = new Set(
    selectedProducts.map((product) => product.id)
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
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !uploadPending) onBackRef.current();
    }

    document.addEventListener("keydown", handleKeyDown);
    const focusTimer = window.setTimeout(() => backButtonRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.clearTimeout(focusTimer);
    };
  }, [open, uploadPending]);

  useEffect(() => {
    if (!open) setManagingReferences(false);
  }, [open]);

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
                  <small>Final generation mode, visual QC, and output size</small>
                </span>
              </div>
              <span className="confirm-section-status">GPT Image 2</span>
            </header>
            <div
              className="confirm-generation-grid"
              role="group"
              aria-label="Artwork settings"
            >
              <ArtworkModeSelector
                value={artworkMode}
                onChange={(mode) =>
                  dispatch({ type: "set-artwork-mode", mode })
                }
              />
              <div className="confirm-generation-setting">
                <span className="confirm-generation-label">
                  Generation route
                </span>
                <span className="confirm-generation-direct-route">
                  agent_image.md + Campaign input → GPT Image 2 → Visual QC
                </span>
              </div>
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
            <label className="confirm-artwork-brief">
              <span className="confirm-artwork-brief-head">
                <span>
                  <b>Artwork brief</b>
                  <small>Optional</small>
                </span>
                <span>{(state.artworkBrief ?? "").trim().length} / 3000</span>
              </span>
              <textarea
                aria-label="Artwork brief"
                maxLength={3000}
                value={state.artworkBrief ?? ""}
                placeholder="Add visual direction, composition, lighting, mood, or restrictions for the final artwork."
                onChange={(event) =>
                  dispatch({
                    type: "set-artwork-brief",
                    brief: event.target.value
                  })
                }
              />
              <small>
                Leave blank to let the agent decide. If added, this becomes a
                mandatory instruction for artwork generation.
              </small>
            </label>
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
                    ? `${imageReferences.length} references selected`
                    : `${selectedMaterials.length} materials selected`}
                </span>
                {assetView === "reference" && referenceBrowser ? (
                  <button
                    className="btn secondary small"
                    type="button"
                    aria-expanded={managingReferences}
                    onClick={() =>
                      setManagingReferences((current) => !current)
                    }
                  >
                    {managingReferences ? "Close library" : "Upload files"}
                  </button>
                ) : assetView === "reference" ? (
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
                <span>{imageReferences.length}</span>
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
            {assetView === "reference" ? (
              <>
                <ConfirmationReferenceGrid
                  references={references}
                  selectedReferences={imageReferences}
                  onToggle={(reference) =>
                    dispatch({
                      type: "toggle-reference-image",
                      item: reference
                    })
                  }
                />
                {managingReferences && referenceBrowser ? (
                  <div className="brief-confirm-material-browser preflight-reference-manager">
                    {referenceBrowser}
                  </div>
                ) : null}
              </>
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
