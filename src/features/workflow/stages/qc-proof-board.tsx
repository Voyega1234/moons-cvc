import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type Dispatch
} from "react";
import { createPortal } from "react-dom";
import type {
  ApprovalRole,
  CreativeOutput
} from "../../../domain/creative-run";
import { directionSubheadline } from "../../../domain/subheadline-highlight";
import { useOptionalWorkspace } from "../../../app/providers/workspace-provider";
import { uploadReplacementAsset } from "../../../services/artwork-generation/replace-output-asset";
import type { WorkflowAction, WorkflowState } from "../model";
import {
  approvalRolesForOutput,
  currentApprovalRole,
  workflowActionBlockReason
} from "../rules";
import {
  isAlbumOutput,
  isUgcOutput,
  qcContentTypeLabel,
  resolvedAlbumFormatForDirection,
  reviewCreativeGroups,
  reviewGroupIsApprovedForRole,
  sortAlbumOutputs
} from "../review/output-groups";
import {
  AlbumPanelPreview,
  UgcTemplatePreview
} from "../review/creative-previews";
import {
  openPmApprovedClientSlidesInGoogleSlides,
  pmApprovedClientSlideItems
} from "../export-client-slides-pptx";
import {
  downloadAlbumArchive,
  downloadOutputAsset
} from "../review/downloads";
import { CaptionEditModal } from "../review/caption-edit-modal";
import { DecisionCard, type StageProps } from "./shared";

type ReviewGroup = readonly CreativeOutput[];
type ReviewFilter = "all" | "fix" | "internal" | "approved";
type ChangeType = "artwork" | "caption" | "both";

const reviewRoles: readonly ApprovalRole[] = [
  "graphicDesign",
  "clientService",
  "projectManager"
];

const roleShort: Record<ApprovalRole, string> = {
  graphicDesign: "GD",
  clientService: "CS",
  projectManager: "PM"
};

const roleTitle: Record<ApprovalRole, string> = {
  graphicDesign: "Graphic Design",
  clientService: "Client Service",
  projectManager: "Project Manager"
};

function groupCurrentRole(outputs: ReviewGroup): ApprovalRole | null {
  return reviewRoles.find((role) =>
    outputs.some((output) => currentApprovalRole(output) === role)
  ) ?? null;
}

function groupIsApproved(outputs: ReviewGroup): boolean {
  const roles = approvalRolesForOutput(outputs[0]!);
  return roles.every((role) => reviewGroupIsApprovedForRole(outputs, role));
}

function groupNeedsFix(outputs: ReviewGroup): boolean {
  return outputs.some(
    (output) =>
      output.status === "needs-revision" ||
      output.clientStatus === "revision" ||
      Object.values(output.approval).includes("rejected")
  );
}

function latestComment(outputs: ReviewGroup): {
  role: ApprovalRole;
  comment: string;
} | null {
  for (const role of [...reviewRoles].reverse()) {
    const comment = outputs
      .map((output) => output.approvalComments[role])
      .find((value) => value.trim());
    if (comment) return { role, comment };
  }
  return null;
}

function reviewState(outputs: ReviewGroup): "fix" | "internal" | "approved" {
  if (groupIsApproved(outputs)) return "approved";
  if (groupNeedsFix(outputs)) return "fix";
  return "internal";
}

function matchesFilter(outputs: ReviewGroup, filter: ReviewFilter): boolean {
  return filter === "all" || reviewState(outputs) === filter;
}

function directionForGroup(state: WorkflowState, outputs: ReviewGroup) {
  return state.directions.find(
    (direction) => direction.id === outputs[0]?.directionId
  );
}

function proofTitle(output: CreativeOutput, typeIndex: number): string {
  const rawType = qcContentTypeLabel(output);
  const type = rawType === "ALBUM" ? "Album" : rawType;
  return `${type} ${String(typeIndex + 1).padStart(2, "0")}`;
}

function CreativeVisual({
  state,
  outputs,
  compact = false
}: {
  state: WorkflowState;
  outputs: ReviewGroup;
  compact?: boolean;
}) {
  const output = outputs[0]!;
  const direction = directionForGroup(state, outputs);

  if (isUgcOutput(output)) {
    return (
      <UgcTemplatePreview
        direction={direction}
        brandName={state.brand?.name}
        compact={compact}
        captureId={output.id}
      />
    );
  }

  if (isAlbumOutput(output)) {
    return (
      <AlbumPanelPreview
        outputs={outputs}
        direction={direction}
        format={resolvedAlbumFormatForDirection(state.albumFormat, direction)}
        compact={compact}
      />
    );
  }

  if (output.assetUrl) {
    return (
      <span className="custom-art-frame">
        <img
          className="proof-static-image"
          src={output.assetUrl}
          alt={direction?.hook ?? "Static creative"}
        />
      </span>
    );
  }

  return (
    <div className="static-preview">
      <span className="static-mark" />
      <div className="static-copy">
        <h3>{direction?.hook ?? "Static creative"}</h3>
        {direction && directionSubheadline(direction) ? (
          <p>{directionSubheadline(direction)}</p>
        ) : null}
        <span>Learn more</span>
      </div>
    </div>
  );
}

function GateTrack({
  outputs,
  onOpen
}: {
  outputs: ReviewGroup;
  onOpen: (role: ApprovalRole) => void;
}) {
  const output = outputs[0]!;
  const eligibleRoles = approvalRolesForOutput(output);
  const currentRole = groupCurrentRole(outputs);

  return (
    <div
      className="visual-gate-track"
      aria-label="GD, CS, and PM approval progress"
    >
      {reviewRoles.map((role) => {
        const eligible = eligibleRoles.includes(role);
        const approved =
          eligible && reviewGroupIsApprovedForRole(outputs, role);
        const current = eligible && currentRole === role;
        const gateClass = !eligible
          ? "skip"
          : approved
            ? "done"
            : current
              ? groupNeedsFix(outputs)
                ? "fix"
                : "current"
              : "future";
        const disabled = !approved && !current;
        return (
          <button
            className={`visual-gate-node ${gateClass} ${
              disabled ? "" : "feedbackable"
            }`}
            type="button"
            disabled={disabled}
            aria-label={`${roleShort[role]} feedback`}
            onClick={() => onOpen(role)}
            key={role}
          >
            <i aria-hidden="true">
              {!eligible
                ? "—"
                : approved
                  ? "✓"
                  : current && groupNeedsFix(outputs)
                    ? "!"
                    : ""}
            </i>
            <span>{roleShort[role]}</span>
          </button>
        );
      })}
    </div>
  );
}

function ProofCard({
  state,
  outputs,
  index,
  typeIndex,
  onOpen
}: {
  state: WorkflowState;
  outputs: ReviewGroup;
  index: number;
  typeIndex: number;
  onOpen: (
    outputs: ReviewGroup,
    role?: ApprovalRole,
    typeIndex?: number
  ) => void;
}) {
  const output = outputs[0]!;
  const currentRole = groupCurrentRole(outputs);
  const status = reviewState(outputs);
  const comment = latestComment(outputs);
  const actionLabel =
    status === "approved"
      ? "QC approved"
      : status === "fix"
        ? `${currentRole ? roleShort[currentRole] : "QC"} update`
        : `${currentRole ? roleShort[currentRole] : "QC"} review`;
  const cta = status === "approved" ? "View" : status === "fix" ? "Fix" : "Review";

  return (
    <article className={`review-proof-card ${status}`}>
      <button
        className="review-proof-preview"
        type="button"
        aria-label={`Open creative ${index + 1} review`}
        onClick={() => onOpen(outputs, undefined, typeIndex)}
      >
        <CreativeVisual state={state} outputs={outputs} compact />
        <span className="preview-hover">Social preview</span>
      </button>
      <div className="review-proof-body">
        <div className="review-proof-title">
          <h3>{proofTitle(output, typeIndex)}</h3>
          <span>{qcContentTypeLabel(output)}</span>
        </div>
        <GateTrack
          outputs={outputs}
          onOpen={(role) => onOpen(outputs, role, typeIndex)}
        />
        {comment ? (
          <div className={`proof-comment ${status === "fix" ? "fix" : ""}`}>
            <span className="proof-comment-icon" aria-hidden="true">
              “
            </span>
            <div>
              <b>{roleShort[comment.role]} · Comment</b>
              <p>{comment.comment}</p>
            </div>
          </div>
        ) : null}
      </div>
      <footer className="review-proof-footer">
        <div className={`proof-action-state ${status}`}>
          <span>
            <small>{status === "approved" ? "Internal QC" : "Action required"}</small>
            <b>{actionLabel}</b>
          </span>
        </div>
        <button
          className={`proof-action-btn ${status}`}
          type="button"
          onClick={() => onOpen(outputs, undefined, typeIndex)}
        >
          {cta} <span aria-hidden="true">→</span>
        </button>
      </footer>
    </article>
  );
}

function reviewInstruction(output: CreativeOutput, role: ApprovalRole): string {
  if (role === "graphicDesign" && isAlbumOutput(output)) {
    return "Check the hero image, supporting frames, visual consistency, and final-file readiness.";
  }
  if (role === "graphicDesign") {
    return "Check artwork quality, layout, hierarchy, and final-file readiness.";
  }
  if (role === "clientService" && isUgcOutput(output)) {
    return "Check the hook, script, scene flow, creator direction, and brand fit.";
  }
  if (role === "clientService") {
    return "Check concept, design communication, hook, caption, and brand fit.";
  }
  return isUgcOutput(output)
    ? "Confirm brief accuracy, script accuracy, offer details, and production readiness."
    : "Confirm brief accuracy, offer details, scope, and client readiness.";
}

function ReviewModal({
  state,
  outputs,
  typeIndex,
  focusRole,
  dispatch,
  canEdit,
  onClose
}: {
  state: WorkflowState;
  outputs: ReviewGroup;
  typeIndex: number;
  focusRole?: ApprovalRole;
  dispatch: Dispatch<WorkflowAction>;
  canEdit: boolean;
  onClose: () => void;
}) {
  const createCheckpoint = useOptionalWorkspace()?.createCheckpoint;
  const output = outputs[0]!;
  const direction = directionForGroup(state, outputs);
  const currentRole = groupCurrentRole(outputs);
  const displayRole = currentRole ?? focusRole;
  const [platform, setPlatform] = useState<"instagram" | "facebook">(
    isAlbumOutput(output) ? "facebook" : "instagram"
  );
  const [comment, setComment] = useState("");
  const [changeType, setChangeType] = useState<ChangeType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assetBusy, setAssetBusy] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [captionEditorOpen, setCaptionEditorOpen] = useState(false);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (captionEditorOpen) {
        setCaptionEditorOpen(false);
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [captionEditorOpen, onClose]);

  const comments = reviewRoles.flatMap((role) => {
    const value = outputs
      .map((candidate) => candidate.approvalComments[role])
      .find((candidate) => candidate.trim());
    return value ? [{ role, value }] : [];
  });
  const canDecide = Boolean(canEdit && currentRole);
  const nextRole = currentRole
    ? approvalRolesForOutput(output)[
        approvalRolesForOutput(output).indexOf(currentRole) + 1
      ]
    : null;
  const title = proofTitle(output, typeIndex);
  const brandName = state.brand?.name ?? "Brand";
  const handle =
    brandName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 24) || "brand";
  const initials =
    brandName
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "BR";

  function approve() {
    if (!currentRole || !canDecide) return;
    outputs
      .filter((candidate) => currentApprovalRole(candidate) === currentRole)
      .forEach((candidate) =>
        dispatch({
          type: "review-output",
          id: candidate.id,
          role: currentRole,
          decision: "approved",
          comment: comment.trim()
        })
      );
    onClose();
  }

  function requestChanges() {
    if (!currentRole || !canDecide) return;
    if (!comment.trim() || !changeType) {
      setError("Add a comment and choose what needs to change.");
      return;
    }
    const targetRole: ApprovalRole = isUgcOutput(output)
      ? "clientService"
      : changeType === "caption"
        ? "clientService"
        : "graphicDesign";
    outputs.forEach((candidate) =>
      dispatch({
        type: "route-output-changes",
        id: candidate.id,
        requestedBy: currentRole,
        targetRole,
        comment: comment.trim()
      })
    );
    onClose();
  }

  async function downloadCreative() {
    setAssetBusy(true);
    setAssetError(null);
    try {
      if (isAlbumOutput(output)) {
        await downloadAlbumArchive(sortAlbumOutputs(outputs), typeIndex);
      } else {
        await downloadOutputAsset(output, state.outputs.indexOf(output));
      }
    } catch (caught) {
      setAssetError(
        caught instanceof Error ? caught.message : "Could not download artwork."
      );
    } finally {
      setAssetBusy(false);
    }
  }

  async function replaceCreative(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).sort((left, right) =>
      left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base"
      })
    );
    event.target.value = "";
    if (!files.length || !canEdit) return;
    const orderedOutputs = isAlbumOutput(output)
      ? sortAlbumOutputs(outputs)
      : [output];
    if (files.length !== orderedOutputs.length) {
      setAssetError(
        `Choose exactly ${orderedOutputs.length} artwork file${
          orderedOutputs.length === 1 ? "" : "s"
        }.`
      );
      return;
    }
    setAssetBusy(true);
    setAssetError(null);
    try {
      const replacements = [];
      for (const [index, candidate] of orderedOutputs.entries()) {
        const file = files[index];
        if (!file) continue;
        replacements.push({
          candidate,
          replacement: await uploadReplacementAsset({
            run: state,
            output: candidate,
            file
          })
        });
      }
      await createCheckpoint?.("replace-image", state.id);
      replacements.forEach(({ candidate, replacement }) =>
        dispatch({
          type: "replace-output-asset",
          id: candidate.id,
          ...replacement
        })
      );
    } catch (caught) {
      setAssetError(
        caught instanceof Error ? caught.message : "Could not replace artwork."
      );
    } finally {
      setAssetBusy(false);
    }
  }

  const modal = (
    <>
      <div className="output-modal-backdrop" onClick={onClose}>
      <section
        className="output-modal social-preview-modal qc-social-review-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qc-social-review-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="social-preview-head">
          <div>
            <h3 id="qc-social-review-title">{title} · Social preview</h3>
            <p>
              {qcContentTypeLabel(output)} ·{" "}
              {isUgcOutput(output)
                ? "TikTok native preview"
                : `${platform === "facebook" ? "Facebook" : "Instagram"} feed`}
            </p>
          </div>
          <div className="social-preview-head-actions">
            {!isUgcOutput(output) ? (
              <div
                className="social-platform-toggle"
                role="group"
                aria-label="Preview platform"
              >
                <button
                  className={platform === "instagram" ? "active" : ""}
                  type="button"
                  aria-pressed={platform === "instagram"}
                  onClick={() => setPlatform("instagram")}
                >
                  Instagram
                </button>
                <button
                  className={platform === "facebook" ? "active" : ""}
                  type="button"
                  aria-pressed={platform === "facebook"}
                  onClick={() => setPlatform("facebook")}
                >
                  Facebook
                </button>
              </div>
            ) : null}
            <button
              className="social-preview-close"
              type="button"
              aria-label="Close preview"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>
        <div
          className={`social-preview-shell ${
            isUgcOutput(output) ? "ugc-mode" : isAlbumOutput(output) ? "album-mode" : ""
          }`}
        >
          <div className="social-preview-stage">
            <article
              className={`social-post ${
                isUgcOutput(output) ? "tiktok-review" : platform
              }`}
            >
              {!isUgcOutput(output) ? (
                <header className="social-post-head">
                  <span className="social-post-avatar">{initials}</span>
                  <span className="social-post-account">
                    <b>{brandName}</b>
                    <span>
                      {platform === "facebook"
                        ? "Sponsored · Public"
                        : `@${handle} · Sponsored`}
                    </span>
                  </span>
                  <span className="social-post-more" aria-hidden="true">
                    •••
                  </span>
                </header>
              ) : null}
              <div className="social-post-media">
                <CreativeVisual state={state} outputs={outputs} />
              </div>
              {!isUgcOutput(output) ? (
                <>
                  <div className="social-post-actions" aria-hidden="true">
                    <span>♡</span>
                    <span>○</span>
                    <span>⌁</span>
                    <span>▱</span>
                  </div>
                  <div className="social-post-copy">
                    <b>
                      {platform === "facebook" ? brandName : `@${handle}`}
                    </b>
                    <p>{direction?.caption ?? ""}</p>
                    <small>Feed preview · CTA: Learn more</small>
                  </div>
                </>
              ) : null}
            </article>
          </div>
          <aside className="social-preview-info">
            <div className="social-preview-role">
              <i>{displayRole ? roleShort[displayRole] : "✓"}</i>
              <span>
                Current action
                <b>
                  {currentRole
                    ? `${roleShort[currentRole]} review`
                    : "Internal QC complete"}
                </b>
              </span>
            </div>
            {displayRole ? (
              <>
                <p className="eyebrow">What to check</p>
                <p className="social-preview-brief">
                  {reviewInstruction(output, displayRole)}
                </p>
              </>
            ) : null}
            <div className="social-preview-comments">
              <p className="eyebrow">Comments</p>
              {comments.length ? (
                <ul className="social-comment-list">
                  {comments.map(({ role, value }) => (
                    <li key={role}>
                      <b>{roleShort[role]} · Comment</b>
                      <p>{value}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="social-comment-empty">
                  No comments on this creative yet.
                </p>
              )}
            </div>
            {currentRole ? (
              <div className="social-review-form">
                <label className="eyebrow" htmlFor="qc-social-comment">
                  Your comment
                </label>
                <textarea
                  id="qc-social-comment"
                  rows={3}
                  value={comment}
                  disabled={!canDecide}
                  placeholder="What should change? One clear instruction."
                  onChange={(event) => {
                    setComment(event.target.value);
                    setError(null);
                  }}
                />
                <div
                  className="social-change-type"
                  role="group"
                  aria-label="What needs to change"
                >
                  <span>Needs a change to</span>
                  {([
                    ["artwork", isUgcOutput(output) ? "Visual direction" : "Artwork"],
                    ["caption", isUgcOutput(output) ? "Script" : "Caption"],
                    ["both", "Both"]
                  ] as const).map(([value, label]) => (
                    <button
                      className={`social-type-chip ${
                        changeType === value ? "on" : ""
                      }`}
                      type="button"
                      disabled={!canDecide}
                      aria-pressed={changeType === value}
                      onClick={() => {
                        setChangeType(value);
                        setError(null);
                      }}
                      key={value}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {error ? (
                  <p className="social-review-error" role="alert">
                    {error}
                  </p>
                ) : null}
                <div className="social-review-decisions">
                  <button
                    className="btn secondary"
                    type="button"
                    disabled={!canDecide}
                    onClick={requestChanges}
                  >
                    Request changes
                  </button>
                  <button
                    className="btn primary approval"
                    type="button"
                    data-social-approve
                    disabled={!canDecide}
                    onClick={approve}
                  >
                    Approve → {nextRole ? roleShort[nextRole] : "Client"}
                  </button>
                </div>
                <p className="social-review-who">
                  {canDecide
                    ? `Reviewing as ${roleShort[currentRole]} · ${roleTitle[currentRole]}`
                    : `Read-only · Current action belongs to ${roleShort[currentRole]} · ${roleTitle[currentRole]}`}
                </p>
              </div>
            ) : displayRole ? (
              <p className="qc-gate-readonly-note">
                This gate is complete. Open the current gate to take the next action.
              </p>
            ) : null}
            {!isUgcOutput(output) ? (
              <div className="social-preview-info-actions">
                <button
                  className="btn secondary"
                  type="button"
                  disabled={!output.assetUrl || assetBusy}
                  onClick={() => void downloadCreative()}
                >
                  {assetBusy ? "Working…" : "Download"}
                </button>
                {currentRole === "clientService" && direction ? (
                  <button
                    className="btn secondary"
                    type="button"
                    disabled={!canEdit}
                    onClick={() => setCaptionEditorOpen(true)}
                  >
                    Edit caption
                  </button>
                ) : null}
                <label
                  className={`btn secondary upload-inline ${
                    assetBusy || !canEdit ? "disabled" : ""
                  }`}
                >
                  Replace artwork
                  <input
                    className="file-input"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple={isAlbumOutput(output)}
                    disabled={assetBusy || !canEdit}
                    onChange={(event) => void replaceCreative(event)}
                  />
                </label>
              </div>
            ) : null}
            {assetError ? (
              <p className="repository-message error" role="alert">
                {assetError}
              </p>
            ) : null}
          </aside>
        </div>
      </section>
      </div>
      {captionEditorOpen && direction ? (
        <CaptionEditModal
          outputs={outputs}
          direction={direction}
          dispatch={dispatch}
          onClose={() => setCaptionEditorOpen(false)}
        />
      ) : null}
    </>
  );

  return typeof document === "undefined"
    ? null
    : createPortal(modal, document.querySelector(".compass-app") ?? document.body);
}

export function QcProofBoard({
  state,
  dispatch,
  canEdit = true
}: StageProps & { canEdit?: boolean }) {
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [selected, setSelected] = useState<{
    outputs: ReviewGroup;
    typeIndex: number;
    role?: ApprovalRole;
  } | null>(null);
  const [slidesImporting, setSlidesImporting] = useState(false);
  const [slidesError, setSlidesError] = useState<string | null>(null);
  const groups = useMemo(() => reviewCreativeGroups(state.outputs), [state.outputs]);
  const filteredGroups = groups.filter((outputs) => matchesFilter(outputs, filter));
  const counts = {
    internal: groups.filter((outputs) => reviewState(outputs) === "internal").length,
    fix: groups.filter((outputs) => reviewState(outputs) === "fix").length,
    approved: groups.filter((outputs) => reviewState(outputs) === "approved").length
  };
  const readyAssets = pmApprovedClientSlideItems(state).length;
  const bulkRole = reviewRoles.find((role) =>
    groups.some((outputs) => groupCurrentRole(outputs) === role)
  ) ?? null;
  const bulkGroups = bulkRole
    ? groups.filter((outputs) => groupCurrentRole(outputs) === bulkRole)
    : [];
  const clientAction: WorkflowAction = { type: "set-stage", stage: "client" };
  const clientBlocked = workflowActionBlockReason(state, clientAction);

  function approveAllCurrent() {
    if (!bulkRole || !canEdit) return;
    bulkGroups.forEach((outputs) =>
      outputs
        .filter((output) => currentApprovalRole(output) === bulkRole)
        .forEach((output) =>
          dispatch({
            type: "review-output",
            id: output.id,
            role: bulkRole,
            decision: "approved",
            comment: ""
          })
        )
    );
  }

  async function openClientSlides() {
    setSlidesImporting(true);
    setSlidesError(null);
    try {
      const result = await openPmApprovedClientSlidesInGoogleSlides(state);
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setSlidesError(
        error instanceof Error
          ? error.message
          : "Could not import the client deck to Google Slides."
      );
    } finally {
      setSlidesImporting(false);
    }
  }

  return (
    <DecisionCard
      eyebrow="Approval board"
      title="See every creative at a glance."
      helper="Artwork, status, and latest comment—open a card only when you need to act."
      status={state.approved ? "Approved" : "Waiting"}
      statusClass={state.approved ? "green" : "blue"}
      className="compass-stage-qc compass-stage-qc-v51"
      actions={
        <>
          <button
            className="btn secondary"
            type="button"
            onClick={() => dispatch({ type: "set-stage", stage: "studio" })}
          >
            ← Back to Build
          </button>
          {bulkRole ? (
            <button
              className="btn primary"
              type="button"
              disabled={!canEdit}
              onClick={approveAllCurrent}
            >
              Approve all →{" "}
              {bulkRole === "graphicDesign"
                ? "CS"
                : bulkRole === "clientService"
                  ? "PM"
                  : "Client Review"}
            </button>
          ) : (
            <button
              className="btn primary"
              type="button"
              disabled={Boolean(clientBlocked)}
              title={clientBlocked ?? undefined}
              onClick={() => dispatch(clientAction)}
            >
              Open Client Review
            </button>
          )}
        </>
      }
    >
      {groups.length ? (
        <div className="review-board">
          <section className="review-quickbar">
            <div className="review-quickbar-copy">
              <span aria-hidden="true">✓</span>
              <div>
                <b>
                  {groups.length} creative{groups.length === 1 ? "" : "s"} ·{" "}
                  {counts.internal} in review · {counts.fix} fix ·{" "}
                  {counts.approved} QC approved
                </b>
                <small>
                  Each card shows the current internal owner and next action.
                </small>
              </div>
            </div>
            <button
              className="btn small review-board-download"
              type="button"
              disabled={!readyAssets || slidesImporting}
              onClick={() => void openClientSlides()}
            >
              {slidesImporting
                ? "Importing to Google…"
                : `PM-approved slides · ${readyAssets}`}
            </button>
          </section>
          {slidesError ? (
            <p className="repository-message error" role="alert">
              {slidesError}
            </p>
          ) : null}
          <header className="review-board-top">
            <div
              className="review-board-filters"
              role="group"
              aria-label="QC filters"
            >
              {([
                ["all", "All", groups.length],
                ["fix", "Needs fix", counts.fix],
                ["internal", "In review", counts.internal],
                ["approved", "QC approved", counts.approved]
              ] as const).map(([value, label, count]) => (
                <button
                  className={`review-board-filter ${
                    filter === value ? "active" : ""
                  }`}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                  key={value}
                >
                  {label} <strong>{count}</strong>
                </button>
              ))}
            </div>
          </header>
          {filteredGroups.length ? (
            <div className="review-proof-grid">
              {filteredGroups.map((outputs) => {
                const index = groups.indexOf(outputs);
                const type = qcContentTypeLabel(outputs[0]!);
                const typeIndex = groups
                  .slice(0, index)
                  .filter(
                    (candidate) => qcContentTypeLabel(candidate[0]!) === type
                  ).length;
                return (
                  <ProofCard
                    state={state}
                    outputs={outputs}
                    index={index}
                    typeIndex={typeIndex}
                    onOpen={(selectedOutputs, role, selectedTypeIndex) =>
                      setSelected({
                        outputs: selectedOutputs,
                        role,
                        typeIndex: selectedTypeIndex ?? typeIndex
                      })
                    }
                    key={outputs[0]!.id}
                  />
                );
              })}
            </div>
          ) : (
            <div className="empty">
              <b>No creatives in this view.</b>
              <p>Choose another filter to see the rest of the approval board.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="empty">
          <b>No creatives yet.</b>
          <p>Create outputs first.</p>
        </div>
      )}
      {selected ? (
        <ReviewModal
          state={state}
          outputs={selected.outputs}
          typeIndex={selected.typeIndex}
          focusRole={selected.role}
          dispatch={dispatch}
          canEdit={canEdit}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </DecisionCard>
  );
}
