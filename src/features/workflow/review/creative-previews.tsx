import { useEffect } from "react";
import {
  ArrowUpRight,
  ChatCircle,
  Heart,
  MusicNote
} from "@phosphor-icons/react";
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

export type UgcPreviewImageMap = Readonly<Record<string, string>>;

export async function captureUgcTemplatePreviewImages(
  outputIds: readonly string[]
): Promise<UgcPreviewImageMap> {
  if (typeof document === "undefined") {
    throw new Error("UGC previews can only be captured in the browser.");
  }

  await document.fonts?.ready;
  const { default: html2canvas } = await import("html2canvas");
  const images: Record<string, string> = {};

  for (const outputId of [...new Set(outputIds)]) {
    const preview = Array.from(
      document.querySelectorAll<HTMLElement>("[data-ugc-preview-id]")
    ).find((element) => element.dataset.ugcPreviewId === outputId);
    if (!preview) {
      throw new Error(
        `Could not find the Create UGC preview for ${outputId}. Keep the Create page open and retry.`
      );
    }
    const canvas = await html2canvas(preview, {
      backgroundColor: null,
      logging: false,
      scale: Math.max(2, Math.min(3, window.devicePixelRatio || 1)),
      useCORS: true
    });
    images[outputId] = canvas.toDataURL("image/png");
  }

  return images;
}

export function UgcTemplatePreview({
  direction,
  compact = false,
  brandName = "Creative Compass",
  captureId
}: {
  direction: CreativeDirection | undefined;
  compact?: boolean;
  brandName?: string;
  captureId?: string;
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
      role="img"
      aria-label="TikTok native UGC preview"
      data-ugc-preview-id={captureId}
    >
      <div className="tiktok-draft-phone">
        <div className="tiktok-draft-status" aria-hidden="true">
          <span>9:41</span>
          <span className="tiktok-draft-device-status">
            <i />
            <b>⌁</b>
          </span>
        </div>
        <div className="tiktok-draft-tabs" aria-hidden="true">
          <span>Following</span>
          <b>For You</b>
        </div>
        <strong className="tiktok-draft-hook">
          {direction?.hook ?? "UGC hook"}
        </strong>
        <div className="tiktok-draft-side" aria-hidden="true">
          <div>
            <span>
              <Heart weight="regular" />
            </span>
            <small>1.2K</small>
          </div>
          <div>
            <span>
              <ChatCircle weight="regular" />
            </span>
            <small>86</small>
          </div>
          <div>
            <span>
              <ArrowUpRight weight="bold" />
            </span>
            <small>Share</small>
          </div>
        </div>
        <div className="tiktok-draft-meta">
          <b>@{creatorHandle || "creativecompass"}creator</b>
          <p>{caption}</p>
          <span>
            <MusicNote weight="fill" /> Original sound · {brandName}
          </span>
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
              captureId={output.id}
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
