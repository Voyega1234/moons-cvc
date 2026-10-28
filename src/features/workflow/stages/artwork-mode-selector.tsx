import {
  artworkImageModelLabels,
  artworkImageModels,
  defaultArtworkImageModel,
  type ArtworkImageModel
} from "../../../domain/creative-run";

export function ArtworkModeSelector({
  value = defaultArtworkImageModel,
  onChange,
  className = ""
}: {
  value?: ArtworkImageModel;
  onChange: (model: ArtworkImageModel) => void;
  className?: string;
}) {
  return (
    <div className={`confirm-generation-setting ${className}`.trim()}>
      <span className="confirm-generation-label">Image model</span>
      <div className="confirm-generation-mode-options" role="group" aria-label="Image model">
        {artworkImageModels.map((model) => (
          <button
            className={`confirm-generation-mode ${value === model ? "active" : ""}`}
            type="button"
            aria-pressed={value === model}
            key={model}
            onClick={() => onChange(model)}
          >
            {artworkImageModelLabels[model]}
          </button>
        ))}
      </div>
      <small>Automatically retries failed GPT images with Nano Banana 2.1.</small>
    </div>
  );
}
