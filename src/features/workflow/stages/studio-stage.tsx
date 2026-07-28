import { useState } from "react";
import { useOptionalWorkspace } from "../../../app/providers/workspace-provider";
import type { WorkflowAction } from "../model";
import { workflowActionBlockReason } from "../rules";
import { createStageClientSlideItems, openCreateStageSlidesInGoogleSlides } from "../export-client-slides-pptx";
import { useCreateSelectedHooks } from "../use-create-selected-hooks";
import { useRunQualityCheck } from "../use-run-quality-check";
import { DecisionCard, Spinner, type StageProps } from "./shared";
import { reviewCreativeCount, reviewGuidedImprovementCount } from "../review/output-groups";
import { OutputGrid } from "../review/output-grid";

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
      const preflightComplete = await check();
      if (!preflightComplete) return;
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
      eyebrow="Create · Build"
      title="Shape the working drafts."
      helper="Edit the draft and caption before sending the set to human review. Quality preflight runs automatically at handoff."
      status={
        regeneratingAllArtwork
          ? regenerateAllArtworkProgress?.total
            ? `Generating ${regenerateAllArtworkProgress.completed}/${regenerateAllArtworkProgress.total}…`
            : "Preparing new artwork…"
          : checking
          ? "Running quality preflight…"
          : !state.qaComplete
            ? "Preflight runs on send"
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
                ? `Create ${slideCount} creative set${slideCount === 1 ? "" : "s"} in Google Slides`
                : "Generate artwork before creating Google Slides"
            }
            onClick={() => void handleOpenGoogleSlides()}
          >
            {slidesImporting ? <Spinner /> : null}
            {slidesImporting ? "Importing to Google…" : "Open in Google Slides"}
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={
              !canEdit ||
              regeneratingAllArtwork ||
              checking ||
              sendingToQc ||
              Boolean(approvalBlocked)
            }
            title={approvalBlocked ?? undefined}
            onClick={() => void handleSendToQc()}
          >
            {checking
              ? "Running quality preflight…"
              : sendingToQc
                ? "Saving recovery point…"
                : "Send to Internal QC →"}
          </button>
        </>
      }
    >
      <div className="create-stage-stack compass-build-stage-stack">
        <section className="compass-create-intro compass-build-intro">
          <div>
            <h3>Creative set · {state.brand?.name ?? "Selected brand"}</h3>
            <p>
              UGC appears in its native TikTok context; Static and Album stay as
              editable production drafts.
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
      </div>
    </DecisionCard>
  );
}
