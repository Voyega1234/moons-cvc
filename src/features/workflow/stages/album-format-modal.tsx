import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  albumFormatLabel,
  albumFormatPanelCount,
  albumFormats,
  type AlbumFormat
} from "../../../domain/creative-run";
import type { WorkflowState } from "../model";

type CreativeDirection = WorkflowState["directions"][number];

export function AlbumFormatThumb({ format }: { format: AlbumFormat }) {
  return (
    <span
      className={`album-layout-thumb layout-${format}`}
      aria-hidden="true"
    >
      {Array.from({ length: albumFormatPanelCount(format) }, (_, index) => (
        <i key={index}>{index + 1}</i>
      ))}
    </span>
  );
}

export function AlbumFormatModal({
  direction,
  onClose,
  onApply
}: {
  direction: CreativeDirection;
  onClose: () => void;
  onApply: (format: AlbumFormat) => void;
}) {
  const initialFormat = direction.albumFormat ?? "three-horizontal";
  const [draft, setDraft] = useState<AlbumFormat>(initialFormat);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="output-modal-backdrop" onClick={onClose}>
      <section
        className="output-modal compass-hook-album-format-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hook-album-format-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="output-modal-head">
          <div>
            <p className="eyebrow">Album format</p>
            <h3 id="hook-album-format-title">Choose the Facebook Album layout</h3>
            <p>
              {direction.hook} · Choose the composition for this selected hook.
            </p>
          </div>
          <button className="btn ghost" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <div
          className="compass-hook-album-format-choices"
          role="group"
          aria-label="Album format choices"
        >
          {albumFormats.map((format) => (
            <button
              className={`album-format-choice ${
                draft === format ? "selected" : ""
              }`}
              type="button"
              aria-pressed={draft === format}
              key={format}
              onClick={() => setDraft(format)}
            >
              <AlbumFormatThumb format={format} />
              <b>{albumFormatLabel(format)}</b>
              <small>{albumFormatPanelCount(format)} photos</small>
            </button>
          ))}
        </div>
        <footer className="output-modal-actions">
          <button className="btn secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            type="button"
            onClick={() => onApply(draft)}
          >
            Use this Album format
          </button>
        </footer>
      </section>
    </div>,
    document.querySelector(".compass-app") ?? document.body
  );
}
