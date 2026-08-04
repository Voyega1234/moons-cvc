import {
  normalizeUserSelectableArtworkMode,
  userSelectableArtworkModes,
  type ArtworkMode
} from "../../../domain/creative-run";

const artworkModeLabels: Record<
  Exclude<ArtworkMode, "reference-library">,
  string
> = {
  standard: "Standard",
  "design-system": "Design system",
  "design-system-new": "Design system (new)",
  "direct-final-artwork": "Final artwork"
};

export function ArtworkModeSelector({
  value,
  onChange,
  className = ""
}: {
  value: ArtworkMode;
  onChange: (mode: ArtworkMode) => void;
  className?: string;
}) {
  const selectedMode = normalizeUserSelectableArtworkMode(value);

  return (
    <div
      className={`confirm-generation-setting ${className}`.trim()}
    >
      <span className="confirm-generation-label">Artwork mode</span>
      <div
        className="confirm-generation-mode-options"
        role="group"
        aria-label="Artwork mode"
      >
        {userSelectableArtworkModes.map((mode) => (
          <button
            className={`confirm-generation-mode ${
              selectedMode === mode ? "active" : ""
            }`}
            type="button"
            aria-pressed={selectedMode === mode}
            key={mode}
            onClick={() => onChange(mode)}
          >
            {artworkModeLabels[mode]}
          </button>
        ))}
      </div>
    </div>
  );
}
