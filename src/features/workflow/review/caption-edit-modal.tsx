import { useState, type Dispatch } from "react";
import type { CreativeOutput } from "../../../domain/creative-run";
import type { WorkflowAction, WorkflowState } from "../model";

export function CaptionEditModal({
  outputs,
  direction,
  dispatch,
  onClose
}: {
  outputs: readonly CreativeOutput[];
  direction: WorkflowState["directions"][number];
  dispatch: Dispatch<WorkflowAction>;
  onClose: () => void;
}) {
  const [caption, setCaption] = useState(direction.caption ?? "");
  const nextCaption = caption.trim();
  const unchanged = nextCaption === (direction.caption ?? "").trim();

  function save() {
    if (!nextCaption || unchanged) return;
    outputs.forEach((output) =>
      dispatch({
        type: "edit-output-direction",
        id: output.id,
        hook: direction.hook,
        caption: nextCaption,
        formatBeats: direction.formatBeats ?? []
      })
    );
    onClose();
  }

  return (
    <div className="output-modal-backdrop" onClick={onClose}>
      <section
        className="output-modal compass-caption-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="caption-edit-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="output-modal-head">
          <div>
            <p className="eyebrow">Creative caption</p>
            <h3 id="caption-edit-title">Edit caption</h3>
          </div>
          <button className="btn ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="output-modal-reference-note">
          Update the caption for this creative without leaving Internal QC.
        </p>
        <label className="output-modal-prompt-label">
          <span>Caption</span>
          <textarea
            aria-label="Caption"
            rows={10}
            autoFocus
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
          />
        </label>
        <div className="output-modal-actions">
          <button className="btn secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={!nextCaption || unchanged}
            onClick={save}
          >
            Save caption
          </button>
        </div>
      </section>
    </div>
  );
}
