import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import {
  albumFormatPanelCount,
  artworkOutputSizeLabel,
  artworkOutputSizes,
  type ArtworkMode,
  type ArtworkOutputSize,
  type CreativeDirection,
  type ServiceType
} from "../../../domain/creative-run";
import {
  runIdeaPreflight,
  type IdeaPreflightCheckId,
  type IdeaPreflightContext,
  type IdeaPreflightResult
} from "../../../services/quality-check/run-idea-preflight";
import {
  defaultArtworkContextSelection,
  type ArtworkContextSelection
} from "../model";
import { ArtworkModeSelector } from "./artwork-mode-selector";

type CheckId = IdeaPreflightCheckId;

const CHECKS: readonly {
  id: CheckId;
  label: string;
  mode: "out" | "in";
  description: string;
  points?: readonly string[];
}[] = [
  {
    id: "quality",
    label: "Quality",
    mode: "out",
    description:
      "The ideation checklist, run against the hook, caption and confirmed context.",
    points: [
      "Key Message ชัด และตรง Brief / Objective",
      "Visual กับ Caption สื่อสารไปในทิศทางเดียวกัน",
      "ข้อมูล ราคา โปรโมชั่น คำสะกด และรายละเอียดต่าง ๆ ถูกต้อง",
      "งานตรง Client Context หรือ Revision Feedback ถ้าเป็นงานแก้"
    ]
  },
  {
    id: "spelling",
    label: "Spelling",
    mode: "out",
    description:
      "Clear misspellings, broken Thai characters and unintended duplicated words. Formatting and line breaks are ignored."
  },
  {
    id: "policy",
    label: "Policy checker",
    mode: "in",
    description:
      "Ad-platform claim risk — absolute outcomes, guarantees and unproven superlatives."
  }
];

function directionService(
  direction: CreativeDirection,
  fallback: ServiceType
): ServiceType {
  return direction.service ?? fallback;
}

function directionKind(service: ServiceType): "Static" | "Album" | "UGC" {
  if (service === "album-post") return "Album";
  if (service === "ugc-video") return "UGC";
  return "Static";
}

function PreflightSectionTitle({
  number,
  title,
  description
}: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <span className="confirm-section-title">
      <span className="confirm-section-number">{number}</span>
      <span>
        <b>{title}</b>
        <small>{description}</small>
      </span>
    </span>
  );
}

function DirectionArtwork({
  direction,
  fallbackService
}: {
  direction: CreativeDirection;
  fallbackService: ServiceType;
}) {
  const service = directionService(direction, fallbackService);

  if (service === "album-post") {
    const format = direction.albumFormat ?? "three-horizontal";
    const panelCopy = [
      direction.hook,
      ...(direction.formatBeats ?? [])
    ].slice(0, albumFormatPanelCount(format));

    return (
      <div className="preflight-album-art">
        <header>
          <span>ALBUM IDEA</span>
          <span>{albumFormatPanelCount(format)} SLIDES</span>
        </header>
        <div className={`preflight-album-board layout-${format}`}>
          {Array.from(
            { length: albumFormatPanelCount(format) },
            (_, index) => (
              <div key={index}>
                <small>{String(index + 1).padStart(2, "0")}</small>
                <b>{panelCopy[index] || `Supporting idea ${index}`}</b>
              </div>
            )
          )}
        </div>
      </div>
    );
  }

  if (service === "ugc-video") {
    const beats = direction.formatBeats?.length
      ? direction.formatBeats
      : [direction.hook, direction.visual, direction.cta].filter(Boolean);

    return (
      <div className="preflight-ugc-art">
        <div className="preflight-phone">
          <span>Following</span>
          <b>{direction.hook}</b>
          <small>@brandcreator</small>
        </div>
        <div className="preflight-ugc-flow">
          <span>UGC CONTENT FLOW</span>
          <ol>
            {beats.map((beat) => (
              <li key={beat}>{beat}</li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="preflight-static-art">
      <header>
        <span>SINGLE-POST DIRECTION</span>
        <span>1:1 · 1200 × 1200</span>
      </header>
      <div className="preflight-static-visual">PRODUCT / KEY VISUAL</div>
      <small>ON-ART COPY</small>
      <b>{direction.hook}</b>
      {(direction.subheadline === undefined
        ? direction.concept
        : direction.subheadline
      ).trim() ? (
        <p>
          {direction.subheadline === undefined
            ? direction.concept
            : direction.subheadline}
        </p>
      ) : null}
    </div>
  );
}

export function PreflightModal({
  directions,
  fallbackService,
  context,
  revisionFeedbackByDirectionId = {},
  visualInputs,
  artworkBrief,
  onArtworkBriefChange,
  contextSelection = defaultArtworkContextSelection,
  onContextSelectionChange = () => undefined,
  contextAvailability,
  artworkMode,
  onArtworkModeChange,
  outputSize,
  onOutputSizeChange,
  onCancel,
  onContinue,
  runChecks = runIdeaPreflight
}: {
  directions: readonly CreativeDirection[];
  fallbackService: ServiceType;
  context: IdeaPreflightContext;
  revisionFeedbackByDirectionId?: Readonly<Record<string, string>>;
  visualInputs?: {
    referenceCount: number;
    materialCount: number;
    referencePreview?: ReactNode;
    referenceEditor: ReactNode;
    materialEditor: ReactNode;
  };
  artworkBrief?: string;
  onArtworkBriefChange?: (brief: string) => void;
  contextSelection?: ArtworkContextSelection;
  onContextSelectionChange?: (selection: ArtworkContextSelection) => void;
  contextAvailability?: {
    brandCiCount: number;
    brandColorCount: number;
  };
  artworkMode: ArtworkMode;
  onArtworkModeChange: (mode: ArtworkMode) => void;
  outputSize: ArtworkOutputSize;
  onOutputSizeChange: (size: ArtworkOutputSize) => void;
  onCancel: () => void;
  onContinue: () => void;
  runChecks?: typeof runIdeaPreflight;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(directions.map((direction) => direction.id))
  );
  const [checks, setChecks] = useState<Record<CheckId, boolean>>({
    quality: true,
    spelling: true,
    policy: false
  });
  const [showResults, setShowResults] = useState(false);
  const [results, setResults] = useState<readonly IdeaPreflightResult[]>([]);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [visualInputView, setVisualInputView] = useState<
    "reference" | "material"
  >("reference");
  const [managingReferences, setManagingReferences] = useState(false);

  const selectedDirections = useMemo(
    () => directions.filter((direction) => selectedIds.has(direction.id)),
    [directions, selectedIds]
  );
  const presentedResults = useMemo(
    () =>
      selectedDirections.map((direction) => ({
        direction,
        findings:
          results
            .find((result) => result.directionId === direction.id)
            ?.findings.map((finding) => finding.message) ?? []
      })),
    [results, selectedDirections]
  );
  const totalFindings = presentedResults.reduce(
    (total, result) => total + result.findings.length,
    0
  );
  const anyCheck = Object.values(checks).some(Boolean);
  const artworkBriefText = artworkBrief ?? "";

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancelRef.current();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  if (typeof document === "undefined") return null;
  const portalRoot = document.querySelector(".compass-app") ?? document.body;

  function toggleDirection(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((current) =>
      current.size === directions.length
        ? new Set()
        : new Set(directions.map((direction) => direction.id))
    );
  }

  function toggleContext(key: keyof ArtworkContextSelection) {
    onContextSelectionChange({
      ...contextSelection,
      [key]: !contextSelection[key]
    });
  }

  async function handleRunChecks() {
    const enabledChecks = CHECKS.filter((check) => checks[check.id]).map(
      (check) => check.id
    );
    setRunning(true);
    setRunError(null);
    try {
      const nextResults = await runChecks({
        ...context,
        checks: enabledChecks,
        directions: selectedDirections.map((direction) => ({
          id: direction.id,
          service: directionService(direction, fallbackService),
          hook: direction.hook,
          subheadline: direction.subheadline ?? "",
          concept: direction.concept,
          visual: direction.visual,
          cta: direction.cta,
          caption: direction.caption,
          formatBeats: direction.formatBeats ?? [],
          revisionFeedback: revisionFeedbackByDirectionId[direction.id] ?? ""
        }))
      });
      setResults(nextResults);
      setShowResults(true);
    } catch (caught) {
      setRunError(
        caught instanceof Error
          ? caught.message
          : "GPT Luna could not check these ideas."
      );
    } finally {
      setRunning(false);
    }
  }

  return createPortal(
    <div className="preflight-backdrop" onClick={onCancel}>
      <section
        className={`preflight-modal ${visualInputs ? "has-visual-inputs" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="preflight-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="preflight-head">
          <div>
            <p className="eyebrow">Before you build</p>
            <h3 id="preflight-title">
              Check these ideas before you build
            </h3>
            <p>
              Pick the ideas and checks to run with GPT Luna. Nothing is
              blocked — findings are advisory.
            </p>
          </div>
          <button
            ref={closeRef}
            className="preflight-close"
            type="button"
            aria-label="Close"
            onClick={onCancel}
          >
            ×
          </button>
        </header>

        {showResults ? (
          <div className="preflight-results">
            <div className="preflight-results-head">
              <div>
                <b>
                  {totalFindings
                    ? `${totalFindings} finding${totalFindings === 1 ? "" : "s"}`
                    : "Nothing flagged"}
                </b>
                <small>
                  {selectedDirections.length} draft
                  {selectedDirections.length === 1 ? "" : "s"} checked · you can
                  still open Create · GPT Luna
                </small>
              </div>
            </div>
            {presentedResults.map(({ direction, findings }, index) => {
              const service = directionService(direction, fallbackService);
              const kind = directionKind(service);
              return (
                <article
                  className={`preflight-result ${findings.length ? "" : "clean"}`}
                  key={direction.id}
                >
                  <header>
                    <b>
                      {kind} {String(index + 1).padStart(2, "0")}
                    </b>
                    <span
                      className={`preflight-result-badge ${findings.length ? "warn" : "clean"}`}
                    >
                      {findings.length
                        ? `${findings.length} to look at`
                        : "Clear"}
                    </span>
                  </header>
                  {findings.length ? (
                    <ul className="preflight-findings">
                      {findings.map((finding) => (
                        <li key={finding}>{finding}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="preflight-clean">Nothing flagged.</p>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="preflight-body">
            <section className="preflight-section confirm-section full">
              <header className="preflight-section-head confirm-section-head">
                <PreflightSectionTitle
                  number={1}
                  title="Ideas to check"
                  description={`${selectedIds.size} of ${directions.length} selected`}
                />
                <button
                  className="btn secondary"
                  type="button"
                  onClick={toggleAll}
                >
                  {selectedIds.size === directions.length
                    ? "Clear all"
                    : "Select all"}
                </button>
              </header>
              <div className="preflight-assets">
                {directions.map((direction, index) => {
                  const active = selectedIds.has(direction.id);
                  const service = directionService(direction, fallbackService);
                  const kind = directionKind(service);
                  return (
                    <button
                      className={`preflight-asset ${active ? "on" : ""}`}
                      type="button"
                      role="checkbox"
                      aria-checked={active}
                      key={direction.id}
                      onClick={() => toggleDirection(direction.id)}
                    >
                      <span className="preflight-asset-art">
                        <DirectionArtwork
                          direction={direction}
                          fallbackService={fallbackService}
                        />
                      </span>
                      <span className="preflight-asset-meta">
                        <b>
                          {kind} {String(index + 1).padStart(2, "0")}
                        </b>
                        <small>
                          {kind} · draft {index + 1}
                        </small>
                      </span>
                      <span className="preflight-tick" aria-hidden="true">
                        ✓
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {visualInputs ? (
              <section className="preflight-section confirm-section full preflight-visual-inputs">
                <header className="preflight-section-head confirm-section-head">
                  <PreflightSectionTitle
                    number={2}
                    title="Image references"
                    description="Image Reference guides style; Image Materials are source objects used in the artwork"
                  />
                  <div className="confirm-reference-actions">
                    <span className="confirm-section-status">
                      {visualInputView === "reference"
                        ? `${visualInputs.referenceCount} references selected`
                        : `${visualInputs.materialCount} materials selected`}
                    </span>
                    {visualInputView === "reference" ? (
                      <button
                        className="btn secondary small"
                        type="button"
                        onClick={() =>
                          setManagingReferences((current) => !current)
                        }
                      >
                        {managingReferences ? "Close library" : "Upload files"}
                      </button>
                    ) : null}
                  </div>
                </header>
                <div
                  className="confirm-input-tabs"
                  role="tablist"
                  aria-label="Creative input type"
                >
                  <button
                    className={
                      visualInputView === "reference" ? "active" : ""
                    }
                    type="button"
                    role="tab"
                    aria-selected={visualInputView === "reference"}
                    onClick={() => setVisualInputView("reference")}
                  >
                    Image Reference
                    <span>{visualInputs.referenceCount}</span>
                  </button>
                  <button
                    className={visualInputView === "material" ? "active" : ""}
                    type="button"
                    role="tab"
                    aria-selected={visualInputView === "material"}
                    onClick={() => setVisualInputView("material")}
                  >
                    Image Materials
                    <span>{visualInputs.materialCount}</span>
                  </button>
                </div>
                {visualInputView === "reference" ? (
                  <>
                    {visualInputs.referencePreview ??
                      visualInputs.referenceEditor}
                    {managingReferences ? (
                      <div className="brief-confirm-material-browser preflight-reference-manager">
                        {visualInputs.referenceEditor}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="brief-confirm-material-browser preflight-visual-input-editor">
                    {visualInputs.materialEditor}
                  </div>
                )}
                <label className="confirm-artwork-brief preflight-artwork-brief">
                  <span className="confirm-artwork-brief-head">
                    <span>
                      <b>Artwork brief</b>
                      <small>Optional</small>
                    </span>
                    <span>{artworkBriefText.trim().length} / 3000</span>
                  </span>
                  <textarea
                    aria-label="Artwork brief"
                    maxLength={3000}
                    value={artworkBriefText}
                    placeholder="Add visual direction, composition, lighting, mood, or restrictions for the final artwork."
                    onChange={(event) =>
                      onArtworkBriefChange?.(event.target.value)
                    }
                  />
                  <small>
                    Leave blank to let the agent decide. If added, this becomes
                    a mandatory instruction for artwork generation.
                  </small>
                </label>
              </section>
            ) : null}

            <section className="preflight-section confirm-section">
              <header className="preflight-section-head confirm-section-head">
                <PreflightSectionTitle
                  number={visualInputs ? 3 : 2}
                  title="Context to send"
                  description="Only enabled inputs will be included in the GPT Image 2 request."
                />
              </header>
              <div className="preflight-context-grid">
                {[
                  {
                    id: "artworkBrief" as const,
                    label: "Artwork brief",
                    detail: artworkBriefText.trim()
                      ? `${artworkBriefText.trim().length} characters ready`
                      : "No brief added"
                  },
                  {
                    id: "brandCi" as const,
                    label: "Brand CI / guideline",
                    detail: `${contextAvailability?.brandCiCount ?? 0} sources`
                  },
                  {
                    id: "brandColors" as const,
                    label: "Brand colors",
                    detail: `${contextAvailability?.brandColorCount ?? 0} HEX colors`
                  },
                  {
                    id: "imageReferences" as const,
                    label: "Image Reference",
                    detail: `${visualInputs?.referenceCount ?? 0} selected`
                  },
                  {
                    id: "imageMaterials" as const,
                    label: "Image Materials",
                    detail: `${visualInputs?.materialCount ?? 0} selected`
                  }
                ].map((option) => {
                  const active = contextSelection[option.id];
                  return (
                    <button
                      className={`preflight-context-option ${active ? "on" : ""}`}
                      type="button"
                      role="checkbox"
                      aria-checked={active}
                      key={option.id}
                      onClick={() => toggleContext(option.id)}
                    >
                      <span
                        className="preflight-context-check"
                        aria-hidden="true"
                      >
                        ✓
                      </span>
                      <span>
                        <b>{option.label}</b>
                        <small>{option.detail}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="preflight-section confirm-section">
              <header className="preflight-section-head confirm-section-head">
                <PreflightSectionTitle
                  number={visualInputs ? 4 : 3}
                  title="Artwork settings"
                  description="Inherited from Review & continue. Change mode or size here for this build if needed."
                />
              </header>
              <div className="preflight-artwork-settings-grid">
                <ArtworkModeSelector
                  className="preflight-artwork-mode-setting"
                  value={artworkMode}
                  onChange={onArtworkModeChange}
                />
                <label className="confirm-generation-setting preflight-output-size-setting">
                  <span className="confirm-generation-label">
                    Output size
                  </span>
                  <select
                    aria-label="Output size"
                    value={outputSize}
                    onChange={(event) =>
                      onOutputSizeChange(
                        event.target.value as ArtworkOutputSize
                      )
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

            <section className="preflight-section confirm-section full">
              <header className="preflight-section-head confirm-section-head">
                <PreflightSectionTitle
                  number={visualInputs ? 5 : 4}
                  title="Checks to run"
                  description="Quality and Spelling are on by default"
                />
              </header>
              <div className="preflight-checks">
                {CHECKS.map((check) => {
                  const active = checks[check.id];
                  return (
                    <div
                      className={`preflight-check ${active ? "on" : ""}`}
                      key={check.id}
                    >
                      <button
                        className="preflight-check-toggle"
                        type="button"
                        role="switch"
                        aria-checked={active}
                        onClick={() =>
                          setChecks((current) => ({
                            ...current,
                            [check.id]: !current[check.id]
                          }))
                        }
                      >
                        <span className="preflight-switch" aria-hidden="true">
                          <i />
                        </span>
                        <span className="preflight-check-copy">
                          <b>
                            {check.label}
                            <em
                              className={`preflight-mode ${check.mode === "in" ? "in" : ""}`}
                            >
                              {check.mode === "out" ? "Opt-out" : "Opt-in"}
                            </em>
                          </b>
                          <small>{check.description}</small>
                        </span>
                      </button>
                      {check.points ? (
                        <ol className="preflight-points">
                          {check.points.map((point) => (
                            <li key={point}>{point}</li>
                          ))}
                        </ol>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
            {runError ? (
              <p className="preflight-run-error" role="alert">
                {runError}
              </p>
            ) : null}
          </div>
        )}

        <footer className="preflight-actions">
          {showResults ? (
            <span />
          ) : (
            <button className="btn ghost" type="button" onClick={onContinue}>
              Skip and open Create
            </button>
          )}
          <div className="preflight-actions-right">
            {showResults ? (
              <button
                className="btn secondary"
                type="button"
                onClick={() => setShowResults(false)}
              >
                Back to options
              </button>
            ) : null}
            <button
              className="btn primary"
              type="button"
              disabled={
                running ||
                (!showResults && (selectedIds.size === 0 || !anyCheck))
              }
              onClick={() => {
                if (showResults) onContinue();
                else void handleRunChecks();
              }}
            >
              {running
                ? "Checking with GPT Luna…"
                : showResults
                ? "Open Create →"
                : selectedIds.size
                  ? `Run checks on ${selectedIds.size}`
                  : "Choose artwork first"}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    portalRoot
  );
}
