import type { ArtworkMode } from "../../../domain/creative-run";

const visibleArtworkModes: readonly {
  mode: Exclude<ArtworkMode, "reference-library">;
  label: string;
}[] = [
  { mode: "standard", label: "Standard" },
  { mode: "design-system", label: "Design system" },
  { mode: "design-system-new", label: "Design system (new)" },
  { mode: "direct-final-artwork", label: "Final artwork" }
];

export function ArtworkModeSelector({
  value,
  onChange,
  className = ""
}: {
  value: ArtworkMode;
  onChange: (mode: ArtworkMode) => void;
  className?: string;
}) {
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
        {visibleArtworkModes.map(({ mode, label }) => (
          <button
            className={`confirm-generation-mode ${
              value === mode ? "active" : ""
            }`}
            type="button"
            aria-pressed={value === mode}
            key={mode}
            onClick={() => onChange(mode)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
