import { useEffect, useState, type ChangeEvent, type Dispatch } from "react";
import { Sparkle } from "@phosphor-icons/react";
import { type ArtworkMode, type CreativeOutput } from "../../../domain/creative-run";
import { directionSubheadline } from "../../../domain/subheadline-highlight";
import { CREATIVE_STRATEGIST_AGENT_NAME, type CreativeQualityReport } from "../../../domain/quality-check";
import { useOptionalWorkspace } from "../../../app/providers/workspace-provider";
import {
  regenerateOutputImages,
  reviseOutputImage,
  type ArtworkReferenceImage
} from "../../../services/artwork-generation/openai-image-generation";
import { runQualityCheck } from "../../../services/quality-check/run-quality-check";
import { playGenerationSuccessSound } from "../../../shared/utils/notification-sound";
import type { WorkflowAction, WorkflowState } from "../model";
import { isBuildQualityCheckOutput } from "../rules";
import { Spinner } from "../stages/shared";
import { groupOutputsForReview, isAlbumOutput, isUgcOutput, outputFormatSortRank, outputNeedsGuidedImprovement, outputSectionTitle, qcContentTypeLabel, resolvedAlbumFormatForDirection, sortAlbumOutputs } from "./output-groups";
import { AlbumPanelPreview, CreativePreviewModal, UgcTemplatePreview } from "./creative-previews";
import { CreativeCopyEditModal } from "./creative-copy-edit-modal";

function artworkModeLabel(mode: ArtworkMode): string {
  switch (mode) {
    case "standard":
      return "Standard";
    case "design-system":
      return "Design system";
    case "design-system-new":
      return "Design system (new)";
    case "direct-final-artwork":
      return "Final artwork";
    case "reference-library":
      return "Reference library";
  }
}

export function OutputGrid({
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
                <p>
                  {format.includes("UGC")
                    ? "TikTok-native preview and editable script"
                    : format.toLowerCase().includes("album")
                      ? "Production draft using the selected Album format"
                      : "Editable artwork and caption draft"}
                </p>
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
                    <header className="compass-build-card-head output-head">
                      <div>
                        <b>Creative {index + 1}</b>
                        <small>
                          {qcContentTypeLabel(output)} working draft
                        </small>
                      </div>
                      <span className="pill badge">
                        Draft · V{output.revisionCount + 1}
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
                          <UgcTemplatePreview
                            direction={direction}
                            brandName={state.brand?.name}
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
                    <div className="compass-build-hidden-preflight" hidden>
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
                    </div>
                    <footer className="compass-build-output-foot">
                      <button
                        className="btn secondary small"
                        type="button"
                        disabled={!canEdit}
                        onClick={() => setRegenerateOutputId(output.id)}
                      >
                        Regenerate draft
                      </button>
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
          brandName={state.brand?.name}
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
          {saved ? "Saved" : "Save changes"}
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

type OutputReferenceAttachment = {
  name: string;
  data: string;
  mediaType: string;
  previewUrl: string;
};

function readOutputReferenceAttachment(
  file: File
): Promise<OutputReferenceAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read this image."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Could not read this image."));
        return;
      }
      const separatorIndex = reader.result.indexOf(",");
      if (separatorIndex < 0) {
        reject(new Error("This image format is not supported."));
        return;
      }
      resolve({
        name: file.name,
        data: reader.result.slice(separatorIndex + 1),
        mediaType: file.type || "image/png",
        previewUrl: reader.result
      });
    };
    reader.readAsDataURL(file);
  });
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
  const [referenceAttachment, setReferenceAttachment] =
    useState<OutputReferenceAttachment | null>(null);
  const album = isAlbumOutput(output);
  const busy = phase !== "idle";

  const handleReferenceAttachment = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Choose a PNG, JPEG, or WEBP image.");
      return;
    }
    try {
      setError(null);
      setReferenceAttachment(await readOutputReferenceAttachment(file));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not read this image."
      );
    }
  };

  const handleRegenerate = async () => {
    if (!direction) {
      setError("Missing hook details for this creative.");
      return;
    }

    setPhase("regenerating");
    setError(null);
    let imageReplaced = false;
    const additionalReferenceImages: readonly ArtworkReferenceImage[] =
      referenceAttachment
        ? [
            {
              kind: "base64",
              data: referenceAttachment.data,
              mediaType: referenceAttachment.mediaType,
              label: `User revision reference — ${referenceAttachment.name}`
            }
          ]
        : [];
    const revisionInstructions =
      prompt.trim() ||
      "Use the attached visual reference to improve this artwork while preserving its core message and brand identity.";

    try {
      const updatedOutputs = album
        ? await regenerateOutputImages({
            run,
            direction,
            extraInstructions: revisionInstructions,
            additionalReferenceImages
          })
        : [
            await reviseOutputImage({
              run,
              output,
              instructions: revisionInstructions,
              referenceImages: additionalReferenceImages
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
            <UgcTemplatePreview
              direction={direction}
              brandName={run.brand?.name}
            />
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
        <div className="output-modal-reference-upload">
          <div>
            <b>Image reference (optional)</b>
            <p>
              Attach one image to guide the composition, mood, camera angle,
              styling, or finish of this revision.
            </p>
          </div>
          {referenceAttachment ? (
            <div className="output-modal-reference-preview">
              <img
                src={referenceAttachment.previewUrl}
                alt={referenceAttachment.name}
              />
              <span title={referenceAttachment.name}>
                {referenceAttachment.name}
              </span>
              <button
                className="btn ghost small"
                type="button"
                disabled={busy || replacementApplied}
                onClick={() => setReferenceAttachment(null)}
              >
                Remove
              </button>
            </div>
          ) : (
            <label className="btn secondary small output-reference-file-button">
              Attach image
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy || replacementApplied}
                onChange={(event) => void handleReferenceAttachment(event)}
              />
            </label>
          )}
        </div>
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
            disabled={
              busy ||
              replacementApplied ||
              (!album && !prompt.trim() && !referenceAttachment)
            }
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
