import { readFile, writeFile } from "node:fs/promises";
import { extname, join, parse } from "node:path";

interface DesignSpec {
  source_file: string;
  client: string;
  campaign: string;
  canvas_ratio: "1:1" | "4:5" | "9:16" | "16:9";
  mode:
    | "luxury"
    | "standard_commercial"
    | "fmcg_energy"
    | "tech_b2b"
    | "social_youth";
  layout_archetype: string;
  layout_zones: Record<string, string | null>;
  text_zone_pct: number;
  hero: { type: string; canvas_area_pct: number };
  secondary_elements: readonly {
    type: string;
    position: string;
    purpose: string;
  }[];
  headline: {
    language: "th" | "en" | "mixed";
    lines: number;
    emphasis_word_count: number;
    emphasis_treatment: string;
    scale_rhythm: string;
    treatment: string;
  };
  container_policy: string;
  color: { scheme: string };
  lighting: { style: string };
  element_budget: {
    hero_count: number;
    supporting_objects: number;
    info_chips: number;
    badges: number;
    total_text_blocks: number;
  };
  notes: string;
}

const root = process.cwd();
const imageDirectory = join(root, "agent_prompt", "Images");
const outputDirectory = join(imageDirectory, "output");
const specs = JSON.parse(
  await readFile(join(outputDirectory, "library_index.json"), "utf8")
) as DesignSpec[];

const catalog = await Promise.all(
  specs.map(async (spec) => {
    const stem = parse(spec.source_file).name;
    const prompt = await readFile(
      join(outputDirectory, `${stem}.prompt.md`),
      "utf8"
    );
    const concept = prompt.match(/^CONCEPT:\s*(.+)$/m)?.[1]?.trim();
    if (!concept) throw new Error(`Missing CONCEPT for ${spec.source_file}`);

    const id = safePathSegment(stem);
    const extension = extname(spec.source_file).toLowerCase();
    const mimeType = extension === ".png" ? "image/png" : "image/jpeg";
    const storageExtension = mimeType === "image/png" ? "png" : "jpg";
    const secondaryText = spec.secondary_elements.flatMap((element) => [
      element.type,
      element.position,
      element.purpose
    ]);

    return {
      id,
      label: `${spec.client} — ${humanize(spec.layout_archetype)} — ${stem}`,
      sourceFile: spec.source_file,
      storagePath: `artworks/${id}.${storageExtension}`,
      mimeType,
      client: spec.client,
      campaign: spec.campaign,
      canvasRatio: spec.canvas_ratio,
      mode: spec.mode,
      layoutArchetype: spec.layout_archetype,
      heroType: spec.hero.type,
      containerPolicy: spec.container_policy,
      typography: {
        language: spec.headline.language,
        treatment: spec.headline.treatment,
        emphasisTreatment: spec.headline.emphasis_treatment,
        lines: spec.headline.lines,
        emphasisWordCount: spec.headline.emphasis_word_count,
        scaleRhythm: spec.headline.scale_rhythm
      },
      colorScheme: spec.color.scheme,
      lightingStyle: spec.lighting.style,
      textZonePct: spec.text_zone_pct,
      heroAreaPct: spec.hero.canvas_area_pct,
      elementBudget: spec.element_budget,
      concept,
      searchText: [
        spec.client,
        spec.campaign,
        stem,
        spec.mode,
        spec.layout_archetype,
        spec.hero.type,
        spec.container_policy,
        spec.headline.treatment,
        spec.headline.scale_rhythm,
        spec.color.scheme,
        spec.lighting.style,
        concept,
        ...Object.values(spec.layout_zones).filter(Boolean),
        ...secondaryText,
        spec.notes
      ].join(" ")
    };
  })
);

const ids = new Set(catalog.map((entry) => entry.id));
const paths = new Set(catalog.map((entry) => entry.storagePath));
if (catalog.length !== 72 || ids.size !== 72 || paths.size !== 72) {
  throw new Error(
    `Expected 72 unique references; received ${catalog.length} entries, ${ids.size} ids, and ${paths.size} paths.`
  );
}

const destination = join(
  root,
  "src",
  "server",
  "artwork-generation",
  "artwork-reference-catalog.generated.ts"
);
await writeFile(
  destination,
  [
    "// Generated from the 72 human-reviewed Design Specs. Do not edit manually.",
    "// Run scripts/build-artwork-reference-catalog.ts after changing the library.",
    `export const artworkReferenceCatalog = ${JSON.stringify(catalog, null, 2)} as const;`,
    ""
  ].join("\n"),
  "utf8"
);
console.log(`Wrote ${catalog.length} references to ${destination}`);

function safePathSegment(value: string): string {
  return (
    value
      .normalize("NFKD")
      .toLowerCase()
      .replaceAll(/[^a-z0-9._-]+/g, "-")
      .replaceAll(/-+/g, "-")
      .replaceAll(/^-|-$/g, "")
      .slice(0, 120) || "artwork-reference"
  );
}

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}
