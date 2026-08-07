import { useEffect } from "react";
import {
  albumFormatPanelCount,
  type AlbumFormat,
  type CreativeOutput
} from "../../../domain/creative-run";
import { directionSubheadline } from "../../../domain/subheadline-highlight";
import type { WorkflowState } from "../model";
import {
  isAlbumOutput,
  isUgcOutput,
  sortAlbumOutputs
} from "./output-groups";

type CreativeDirection = WorkflowState["directions"][number];

export function UgcTemplatePreview({
  direction,
  compact = false,
  brandName = "Creative Compass"
}: {
  direction: CreativeDirection | undefined;
  compact?: boolean;
  brandName?: string;
}) {
  const creatorHandle = brandName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 18);
  const caption =
    direction?.caption?.trim() ||
    (direction ? directionSubheadline(direction) : "Creator-led script direction");

  return (
    <div
      className={`compass-ugc-template tiktok-draft-shell ${
        compact ? "compact" : ""
      }`}
      aria-label="TikTok native UGC preview"
    >
      <div className="tiktok-draft-phone">
        <div className="tiktok-draft-status" aria-hidden="true">
          <span>9:41</span>
          <span>● ︎⌁</span>
        </div>
        <div className="tiktok-draft-tabs" aria-hidden="true">
          <span>Following</span>
          <b>For You</b>
        </div>
        <strong className="tiktok-draft-hook">
          {direction?.hook ?? "UGC hook"}
        </strong>
        <div className="tiktok-draft-side" aria-hidden="true">
          <span>♡</span>
          <small>1.2K</small>
          <span>◯</span>
          <small>86</small>
          <span>↗</span>
          <small>Share</small>
        </div>
        <div className="tiktok-draft-meta">
          <b>@{creatorHandle || "creativecompass"}creator</b>
          <p>{caption}</p>
          <span>♫ Original sound · {brandName}</span>
        </div>
        <div className="tiktok-draft-nav" aria-hidden="true">
          <span>Home</span>
          <span>Discover</span>
          <i>+</i>
          <span>Inbox</span>
          <span>Profile</span>
        </div>
      </div>
      <div className="tiktok-draft-label">
        <span>TikTok native preview</span>
        <b>9:16 · Draft</b>
      </div>
    </div>
  );
}

export function AlbumPanelPreview({
  outputs,
  direction,
  format,
  compact = false
}: {
  outputs: readonly CreativeOutput[];
  direction: CreativeDirection | undefined;
  format: AlbumFormat;
  compact?: boolean;
}) {
  const panels = sortAlbumOutputs(outputs).slice(
    0,
    albumFormatPanelCount(format)
  );
  const masterAssetUrl = panels.find(
    (output) => output.albumMasterAssetUrl
  )?.albumMasterAssetUrl;

  return (
    <div
      aria-label={`${panels.length}-image album preview`}
      className={`compass-album-panels format-${format} ${compact ? "compact" : ""}`}
    >
      {masterAssetUrl ? (
        <img
          className="compass-album-master-image"
          src={masterAssetUrl}
          alt={`${direction?.hook ?? "Album creative"} master grid`}
          loading="lazy"
          decoding="async"
        />
      ) : (
        panels.map((output, index) =>
          output.assetUrl ? (
            <div className="compass-album-panel" key={output.id}>
              <img
                src={output.assetUrl}
                alt={`${direction?.hook ?? "Album creative"} image ${index + 1}`}
                loading="lazy"
                decoding="async"
              />
            </div>
          ) : (
            <div
              className="compass-album-panel compass-album-panel-empty"
              key={output.id}
            >
              Image unavailable
            </div>
          )
        )
      )}
    </div>
  );
}

export function CreativePreviewModal({
  output,
  outputs,
  direction,
  index,
  albumFormat,
  brandName,
  onClose
}: {
  output: CreativeOutput;
  outputs: readonly CreativeOutput[];
  direction: CreativeDirection | undefined;
  index: number;
  albumFormat: AlbumFormat;
  brandName?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const album = isAlbumOutput(output);
  const title = album
    ? "Album creative preview"
    : `Creative ${index + 1} preview`;

  return (
    <div className="output-modal-backdrop" onClick={onClose}>
      <div
        aria-labelledby="build-image-preview-title"
        aria-modal="true"
        className={`output-modal compass-build-image-modal ${album ? "compass-album-preview-modal" : ""}`}
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="output-modal-head">
          <div>
            <p className="eyebrow">Creative preview</p>
            <h3 id="build-image-preview-title">{title}</h3>
          </div>
          <button className="btn secondary" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="output-modal-image">
          {album ? (
            <AlbumPanelPreview
              outputs={outputs}
              direction={direction}
              format={albumFormat}
            />
          ) : isUgcOutput(output) ? (
            <UgcTemplatePreview
              direction={direction}
              brandName={brandName}
            />
          ) : output.assetUrl ? (
            <img src={output.assetUrl} alt={direction?.hook ?? title} />
          ) : (
            <div className="static-preview">
                <span className="static-mark" />
                <div className="static-copy">
                  <h3>{direction?.hook}</h3>
                  {direction && directionSubheadline(direction) ? (
                    <p>{directionSubheadline(direction)}</p>
                  ) : null}
                  <span>Learn more</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
