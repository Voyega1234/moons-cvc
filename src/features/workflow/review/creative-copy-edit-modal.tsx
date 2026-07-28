import { useState, type Dispatch } from "react";
import type { CreativeOutput } from "../../../domain/creative-run";
import type { WorkflowAction, WorkflowState } from "../model";
import { isUgcOutput } from "./output-groups";

export function CreativeCopyEditModal({
  output,
  direction,
  dispatch,
  onClose,
  resolveQa = false
}: {
  output: CreativeOutput;
  direction: WorkflowState["directions"][number];
  dispatch: Dispatch<WorkflowAction>;
  onClose: () => void;
  resolveQa?: boolean;
}) {
  const ugc = isUgcOutput(output);
  const [hook, setHook] = useState(direction.hook);
  const [caption, setCaption] = useState(direction.caption ?? "");
  const [beats, setBeats] = useState((direction.formatBeats ?? []).join("\n"));

  function save() {
    dispatch({
      type: "edit-output-direction",
      id: output.id,
      hook,
      caption,
      formatBeats: beats.split("\n")
    });
    if (resolveQa) dispatch({ type: "resolve-qa-output", id: output.id });
    onClose();
  }

  return (
    <div className="output-modal-backdrop" onClick={onClose}>
      <div
        className="output-modal compass-copy-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-label={ugc ? "Edit UGC script and flow" : "Edit creative copy"}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="output-modal-head">
          <div>
            <p className="eyebrow">{ugc ? "UGC template" : "Creative copy"}</p>
            <h3>{ugc ? "Edit script & flow" : "Edit copy"}</h3>
          </div>
          <button className="btn ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="output-modal-reference-note">
          {ugc
            ? "Update the text placed in the 9:16 phone template. No image generation is used."
            : "Update the hook and caption without leaving Internal QC."}
        </p>
        <label className="output-modal-prompt-label">
          <span>Hook</span>
          <textarea
            rows={2}
            value={hook}
            onChange={(event) => setHook(event.target.value)}
          />
        </label>
        <label className="output-modal-prompt-label">
          <span>{ugc ? "Script direction" : "Caption"}</span>
          <textarea
            rows={5}
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
          />
        </label>
        {ugc ? (
          <label className="output-modal-prompt-label">
            <span>Scene / creator flow · one beat per line</span>
            <textarea
              rows={4}
              value={beats}
              onChange={(event) => setBeats(event.target.value)}
            />
          </label>
        ) : null}
        <div className="output-modal-actions">
          <button className="btn secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="button" onClick={save}>
            Save {ugc ? "UGC update" : "copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
