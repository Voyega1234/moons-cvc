import { readFile } from "node:fs/promises";
import { join } from "node:path";

const IMAGE_PROMPT_MAX_CHARACTERS = 32_000;
const IMAGE_PROMPT_TARGET_CHARACTERS = 30_000;
export function compactPromptLibrary(
  items: readonly { id?: string; title: string; description: string }[],
  maxItems: number,
  maxDescriptionCharacters: number
) {
  return items.slice(0, maxItems).map((item) => ({
    ...(item.id ? { id: item.id } : {}),
    title: compactPromptText(item.title, 140),
    description: compactPromptText(
      item.description,
      maxDescriptionCharacters
    )
  }));
}

export function compactPromptList(
  values: readonly string[],
  maxItems: number,
  maxCharacters: number
): readonly string[] {
  return values
    .slice(0, maxItems)
    .map((value) => compactPromptText(value, maxCharacters));
}

export function compactPromptText(value: string, maxCharacters: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxCharacters) return clean;
  return `${clean.slice(0, Math.max(0, maxCharacters - 1)).trimEnd()}…`;
}

export function composeImagePrompt(
  parts: readonly (string | null | undefined)[],
  protectedSuffix?: string
): string {
  const body = parts.filter(Boolean).join("\n\n");
  const suffix = protectedSuffix?.trim();
  const separator = suffix ? "\n\n" : "";
  const fullPrompt = `${body}${separator}${suffix ?? ""}`;
  if (fullPrompt.length <= IMAGE_PROMPT_TARGET_CHARACTERS) {
    return fullPrompt;
  }

  const bodyBudget =
    IMAGE_PROMPT_TARGET_CHARACTERS -
    separator.length -
    (suffix?.length ?? 0);
  if (bodyBudget < 1_000) {
    throw new Error(
      `Required image instructions exceed the provider prompt limit (${fullPrompt.length}/${IMAGE_PROMPT_MAX_CHARACTERS}).`
    );
  }
  return `${truncatePromptPreservingEnds(body, bodyBudget)}${separator}${suffix ?? ""}`;
}

function truncatePromptPreservingEnds(
  prompt: string,
  maxCharacters: number
): string {
  if (prompt.length <= maxCharacters) return prompt;
  const marker =
    "\n\n[Lower-priority reference context was shortened to fit the image provider limit. Preserve the working brief, exact approved copy, official assets, and final requirements.]\n\n";
  const available = Math.max(0, maxCharacters - marker.length);
  const prefixLength = Math.floor(available * 0.64);
  const suffixLength = available - prefixLength;
  return `${prompt.slice(0, prefixLength).trimEnd()}${marker}${prompt
    .slice(prompt.length - suffixLength)
    .trimStart()}`;
}

export function loadDesignSystemV62JudgmentPrompt(): Promise<string> {
  return readFile(
    join(
      process.cwd(),
      "agent_prompt",
      "versions",
      "2026-07-30-design-system-v6.2-judgment",
      "prompts",
      "03-design-system-v6.2-judgment.md"
    ),
    "utf8"
  );
}

export function loadDesignSystem20260723StrategyPrompt(): Promise<string> {
  return readFile(
    join(
      process.cwd(),
      "agent_prompt",
      "artwork_modes",
      "design-system-2026-07-23",
      "01-creative-strategy-enrichment.md"
    ),
    "utf8"
  );
}

export function loadDesignSystem20260723FinalArtworkPrompt(): Promise<string> {
  return readFile(
    join(
      process.cwd(),
      "agent_prompt",
      "artwork_modes",
      "design-system-2026-07-23",
      "02-final-artwork.md"
    ),
    "utf8"
  );
}

export function loadDirectFinalArtworkPrompt(): Promise<string> {
  return readFile(
    join(
      process.cwd(),
      "agent_prompt",
      "versions",
      "2026-07-30-direct-final-artwork-v1",
      "prompts",
      "01-direct-final-artwork-v1.md"
    ),
    "utf8"
  );
}

export function loadDesignSystemV6StrategyPrompt(): Promise<string> {
  return readFile(
    join(
      process.cwd(),
      "agent_prompt",
      "versions",
      "2026-07-28-chol-static-03-v6",
      "prompts",
      "01-strategy-enrichment.exact.md"
    ),
    "utf8"
  );
}

export function renderDesignSystemPromptTemplate(
  source: string,
  replacements: Readonly<Record<string, string>>
): string {
  const template = source.trim();
  if (!template) {
    throw new Error("The active Design System prompt is empty.");
  }

  const missingMarkers = Object.keys(replacements).filter(
    (marker) => !template.includes(marker)
  );
  if (missingMarkers.length) {
    throw new Error(
      `The active Design System prompt is missing required markers: ${missingMarkers.join(", ")}`
    );
  }

  let rendered = template;
  for (const [marker, content] of Object.entries(replacements)) {
    rendered = rendered.replaceAll(marker, content);
  }

  const unresolvedMarker = rendered.match(
    /\{\{[^{}]+\}\}|\{(?:brand|hook)\.[^{}]+\}|\{(?:commercialStyle|sellingMechanism|audienceMoment|reasonToBelieve|canvasRatio|service|additional user requirements)[^{}]*\}/
  )?.[0];
  if (unresolvedMarker) {
    throw new Error(
      `The active Design System prompt contains an unresolved marker: ${unresolvedMarker}`
    );
  }

  return rendered;
}

