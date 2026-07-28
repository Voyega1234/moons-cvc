import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  albumFormatPanelCount,
  type CreativeDirection,
  type ServiceType
} from "../../../domain/creative-run";

type CheckId = "quality" | "spelling" | "policy";

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
      "Typos, doubled words, spacing and the two Thai input errors that survive proofreading."
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
    const beats =
      direction.formatBeats?.length === 3
        ? direction.formatBeats
        : ["Opening tension", "Demonstration / proof", "Brand-fit close"];

    return (
      <div className="preflight-ugc-art">
        <div className="preflight-phone">
          <span>Following</span>
          <b>{direction.hook}</b>
          <small>@brandcreator</small>
        </div>
        <div className="preflight-ugc-flow">
          <span>UGC IDEA · 3-BEAT FLOW</span>
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
      <p>{direction.subheadline || direction.concept}</p>
    </div>
  );
}

function findingsFor(
  direction: CreativeDirection,
  enabledChecks: Record<CheckId, boolean>
): readonly string[] {
  const findings: string[] = [];

  if (enabledChecks.quality) {
    if (!direction.hook.trim()) findings.push("Hook is missing.");
    if (!direction.concept.trim()) findings.push("Creative concept is missing.");
    if (!direction.caption.trim()) findings.push("Caption is missing.");
    if (!direction.cta.trim()) findings.push("CTA is missing.");
  }

  if (enabledChecks.spelling) {
    const copy = `${direction.hook} ${direction.subheadline ?? ""} ${direction.caption}`;
    if (/\b(\w{3,})\s+\1\b/i.test(copy)) {
      findings.push("A doubled word may need proofreading.");
    }
    if (/ {2,}/.test(copy)) findings.push("Repeated spacing may need cleanup.");
  }

  if (
    enabledChecks.policy &&
    /\b(guaranteed?|always|never|best|number\s*one|#1)\b/i.test(
      `${direction.hook} ${direction.caption}`
    )
  ) {
    findings.push("An absolute or unproven claim may need verification.");
  }

  return findings;
}

export function PreflightModal({
  directions,
  fallbackService,
  onContinue
}: {
  directions: readonly CreativeDirection[];
  fallbackService: ServiceType;
  onContinue: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(directions.map((direction) => direction.id))
  );
  const [checks, setChecks] = useState<Record<CheckId, boolean>>({
    quality: true,
    spelling: true,
    policy: false
  });
  const [showResults, setShowResults] = useState(false);

  const selectedDirections = useMemo(
    () => directions.filter((direction) => selectedIds.has(direction.id)),
    [directions, selectedIds]
  );
  const results = useMemo(
    () =>
      selectedDirections.map((direction) => ({
        direction,
        findings: findingsFor(direction, checks)
      })),
    [selectedDirections, checks]
  );
  const totalFindings = results.reduce(
    (total, result) => total + result.findings.length,
    0
  );
  const anyCheck = Object.values(checks).some(Boolean);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onContinue();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onContinue]);

  if (typeof document === "undefined") return null;

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

  return createPortal(
    <div className="preflight-backdrop" onClick={onContinue}>
      <section
        className="preflight-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preflight-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="preflight-head">
          <div>
            <p className="eyebrow">Before you build</p>
            <h3 id="preflight-title">
              Check this creative set before you build
            </h3>
            <p>
              Pick the artwork you want checked and which checks to run. Nothing
              is blocked — findings are advisory.
            </p>
          </div>
          <button
            ref={closeRef}
            className="preflight-close"
            type="button"
            aria-label="Close"
            onClick={onContinue}
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
                  still open Create
                </small>
              </div>
            </div>
            {results.map(({ direction, findings }, index) => {
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
            <section className="preflight-section">
              <header className="preflight-section-head">
                <span>
                  <b>1 · Ideas to check</b>
                  <small>
                    {selectedIds.size} of {directions.length} selected
                  </small>
                </span>
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

            <section className="preflight-section">
              <header className="preflight-section-head">
                <span>
                  <b>2 · Checks to run</b>
                  <small>Quality and Spelling are on by default</small>
                </span>
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
                !showResults && (selectedIds.size === 0 || !anyCheck)
              }
              onClick={() => {
                if (showResults) onContinue();
                else setShowResults(true);
              }}
            >
              {showResults
                ? "Open Create →"
                : selectedIds.size
                  ? `Run checks on ${selectedIds.size}`
                  : "Choose artwork first"}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body
  );
}
