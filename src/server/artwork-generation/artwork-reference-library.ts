import { artworkReferenceCatalog } from "./artwork-reference-catalog.generated.js";
import type { CreativeStrategyEnrichment } from "./creative-strategy-enrichment-agent.js";

export const ARTWORK_PATTERN_REFERENCE_PREFIX =
  "Moons artwork reference —";
export const ARTWORK_REFERENCE_BUCKET = "artwork-reference-library";

type ArtworkMode =
  | "luxury"
  | "standard_commercial"
  | "fmcg_energy"
  | "tech_b2b"
  | "social_youth";
type CanvasRatio = "1:1" | "4:5" | "9:16" | "16:9";

export interface ArtworkReferenceSelectionInput {
  brandName?: string;
  brandCategory?: string;
  service: string;
  canvasRatio?: CanvasRatio;
  brief: string;
  hook: {
    hook: string;
    concept: string;
    visual: string;
  };
  strategy?: Pick<
    CreativeStrategyEnrichment,
    | "commercialStyle"
    | "sellingMechanism"
    | "preferredMode"
    | "preferredLayout"
    | "preferredHeroType"
    | "referenceSearchText"
  >;
}

export interface ArtworkReferencePattern {
  id: string;
  label: string;
  sourceFile: string;
  storagePath: string;
  mimeType: "image/jpeg" | "image/png";
  client: string;
  campaign: string;
  canvasRatio: CanvasRatio;
  mode: ArtworkMode;
  layoutArchetype: string;
  heroType: string;
  containerPolicy: string;
  typography: {
    language: "th" | "en" | "mixed";
    treatment: string;
    emphasisTreatment: string;
    lines: number;
    emphasisWordCount: number;
    scaleRhythm: string;
  };
  colorScheme: string;
  lightingStyle: string;
  textZonePct: number;
  heroAreaPct: number;
  elementBudget: {
    hero_count: number;
    supporting_objects: number;
    info_chips: number;
    badges: number;
    total_text_blocks: number;
  };
  concept: string;
  searchText: string;
}

export const artworkReferencePatterns: readonly ArtworkReferencePattern[] =
  artworkReferenceCatalog;

const stopWords = new Set([
  "about",
  "advertisement",
  "advertising",
  "approved",
  "artwork",
  "brand",
  "campaign",
  "clear",
  "commercial",
  "concept",
  "create",
  "direction",
  "exact",
  "focused",
  "from",
  "headline",
  "image",
  "into",
  "launch",
  "message",
  "production",
  "ready",
  "single",
  "static",
  "that",
  "their",
  "this",
  "visual",
  "with"
]);

const shortSignalTokens = new Set([
  "3d",
  "ai",
  "app",
  "b2b",
  "crm",
  "fmcg",
  "seo",
  "ui"
]);

export function selectArtworkReferencePattern(
  input: ArtworkReferenceSelectionInput
): ArtworkReferencePattern {
  return selectArtworkReferencePatterns(input, 1)[0]!;
}

export function selectArtworkReferencePatterns(
  input: ArtworkReferenceSelectionInput,
  count = 2
): readonly ArtworkReferencePattern[] {
  const context = [
    input.brandName,
    input.brandCategory,
    input.service,
    input.brief,
    input.hook.hook,
    input.hook.concept,
    input.hook.visual,
    input.strategy?.commercialStyle,
    input.strategy?.sellingMechanism,
    input.strategy?.preferredMode,
    input.strategy?.preferredLayout,
    input.strategy?.preferredHeroType,
    input.strategy?.referenceSearchText
  ]
    .filter(Boolean)
    .join(" ");
  const contextTokens = tokenize(context);
  const intendedMode = inferMode(context);
  const intendedLayouts = inferLayouts(context, input.service);
  const preferredTypography = inferTypography(intendedMode, context);
  const thaiCopy = /[\u0E00-\u0E7F]/u.test(context);

  const ranked = artworkReferencePatterns.map((pattern) => {
    const patternTokens = tokenize(pattern.searchText);
    let score = sharedTokenScore(contextTokens, patternTokens);

    if (input.canvasRatio === pattern.canvasRatio) score += 6;
    if (pattern.mode === intendedMode) score += 8;
    if (intendedLayouts.has(pattern.layoutArchetype)) score += 6;
    if (pattern.mode === input.strategy?.preferredMode) score += 10;
    if (pattern.layoutArchetype === input.strategy?.preferredLayout) score += 18;
    if (pattern.heroType === input.strategy?.preferredHeroType) score += 8;
    if (preferredTypography.has(pattern.typography.treatment)) score += 3;
    if (
      thaiCopy &&
      (pattern.typography.language === "th" ||
        pattern.typography.language === "mixed")
    ) {
      score += 2;
    }
    if (sameBrandFamily(input.brandName, pattern.client)) score += 14;

    if (input.service === "album-post") {
      if (/\balbum\b/iu.test(pattern.searchText)) score += 9;
      if (pattern.layoutArchetype === "marketplace_promo") score += 3;
    }
    if (
      matchesAny(context, ["minimal", "minimalist", "restrained", "clean"]) &&
      pattern.elementBudget.total_text_blocks <= 8
    ) {
      score += 2;
    }
    if (
      matchesAny(context, ["comparison", "dense", "multiple", "หลาย", "เปรียบเทียบ"]) &&
      pattern.elementBudget.total_text_blocks >= 10
    ) {
      score += 2;
    }

    return { pattern, score };
  });

  ranked.sort(
    (left, right) =>
      right.score - left.score || left.pattern.id.localeCompare(right.pattern.id)
  );
  const primary = ranked[0]!.pattern;
  const compatibleRanked = ranked
    .filter(({ pattern }) => pattern.id !== primary.id)
    .map(({ pattern, score }) => ({
      pattern,
      score:
        score +
        (pattern.canvasRatio === primary.canvasRatio ? 4 : 0) +
        (pattern.mode === primary.mode ? 6 : 0) +
        (pattern.typography.treatment === primary.typography.treatment ? 2 : 0)
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.pattern.id.localeCompare(right.pattern.id)
    );

  return [primary, ...compatibleRanked.map(({ pattern }) => pattern)].slice(
    0,
    Math.max(1, count)
  );
}

export function buildArtworkReferenceLabel(
  _pattern: ArtworkReferencePattern,
  role: "primary" | "secondary" = "primary"
): string {
  return `${ARTWORK_PATTERN_REFERENCE_PREFIX} ${role}`;
}

export function isArtworkPatternReference(
  reference: { label?: string }
): boolean {
  return reference.label?.startsWith(ARTWORK_PATTERN_REFERENCE_PREFIX) ?? false;
}

function tokenize(value: string): ReadonlySet<string> {
  const tokens = value
    .normalize("NFKC")
    .toLowerCase()
    .match(/[a-z0-9]+|[\u0E00-\u0E7F]+/gu);
  return new Set(
    (tokens ?? []).filter(
      (token) =>
        !stopWords.has(token) &&
        (token.length >= 4 || shortSignalTokens.has(token))
    )
  );
}

function sharedTokenScore(
  contextTokens: ReadonlySet<string>,
  patternTokens: ReadonlySet<string>
): number {
  let score = 0;
  for (const token of contextTokens) {
    if (patternTokens.has(token)) score += token.length >= 8 ? 3 : 2;
  }
  return score;
}

function inferMode(context: string): ArtworkMode {
  if (
    matchesAny(context, [
      "luxury",
      "premium",
      "craftsmanship",
      "hospitality",
      "real estate",
      "หรู",
      "พรีเมียม"
    ])
  ) {
    return "luxury";
  }
  if (
    matchesAny(context, [
      "anime",
      "fandom",
      "gen z",
      "halloween",
      "social youth",
      "วัยรุ่น"
    ])
  ) {
    return "social_youth";
  }
  if (
    matchesAny(context, [
      "children",
      "fmcg",
      "food",
      "household",
      "insect",
      "kids",
      "lazada",
      "marketplace",
      "shopee",
      "supplement",
      "vitamin",
      "เด็ก",
      "วิตามิน",
      "อาหารเสริม"
    ])
  ) {
    return "fmcg_energy";
  }
  if (
    matchesAny(context, [
      "ai",
      "automation",
      "b2b",
      "crm",
      "dashboard",
      "marketing",
      "saas",
      "software",
      "technology",
      "แพลตฟอร์ม",
      "ระบบ"
    ])
  ) {
    return "tech_b2b";
  }
  return "standard_commercial";
}

function inferLayouts(context: string, service: string): ReadonlySet<string> {
  const layouts = new Set<string>();
  if (
    matchesAny(context, [
      "lazada",
      "marketplace",
      "price",
      "promotion",
      "sale",
      "shopee",
      "โปร",
      "ราคา"
    ])
  ) {
    layouts.add("marketplace_promo");
  }
  if (matchesAny(context, ["dashboard", "interface", "saas", "software", "ui"])) {
    layouts.add("ui_dashboard_glass");
  }
  if (matchesAny(context, ["cinematic", "dramatic", "problem", "story", "เล่าเรื่อง"])) {
    layouts.add("cinematic_problem_solution");
  }
  if (matchesAny(context, ["beauty", "clinic", "family", "lifestyle", "person", "wellness"])) {
    layouts.add("lifestyle_commercial");
  }
  if (matchesAny(context, ["luxury", "premium", "product", "craftsmanship"])) {
    layouts.add("product_stage_plinth");
    layouts.add("editorial_premium");
    layouts.add("architectural_plane_split");
  }
  if (service === "album-post") {
    layouts.add("marketplace_promo");
    layouts.add("architectural_plane_split");
  }
  return layouts;
}

function inferTypography(
  mode: ArtworkMode,
  context: string
): ReadonlySet<string> {
  if (mode === "luxury") return new Set(["clean_sans", "metallic_serif"]);
  if (mode === "tech_b2b") return new Set(["clean_sans"]);
  if (mode === "social_youth") {
    return new Set(["bold_rounded_thai", "display_dimensional"]);
  }
  if (mode === "fmcg_energy") {
    return new Set(["bold_rounded_thai", "display_dimensional"]);
  }
  if (matchesAny(context, ["beauty", "clinic", "friendly", "wellness"])) {
    return new Set(["bold_rounded_thai", "clean_sans"]);
  }
  return new Set(["clean_sans"]);
}

function sameBrandFamily(brandName: string | undefined, client: string): boolean {
  if (!brandName) return false;
  return matchesAny(brandName, [client]);
}

function matchesAny(value: string, terms: readonly string[]): boolean {
  const normalized = ` ${value
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll(/[^a-z0-9\u0E00-\u0E7F]+/gu, " ")} `;
  return terms.some((term) => {
    const normalizedTerm = term.normalize("NFKC").toLowerCase();
    return /[\u0E00-\u0E7F]/u.test(normalizedTerm)
      ? normalized.includes(normalizedTerm)
      : normalized.includes(` ${normalizedTerm} `);
  });
}
