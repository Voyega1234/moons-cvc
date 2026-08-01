import type { AlbumFormat } from "../../domain/creative-run.js";
import type { ArtworkGenerationRequest } from "../../services/artwork-generation/openai-image-generation.js";
import type { CreativeStrategyEnrichment } from "./creative-strategy-enrichment-agent.js";
import type { ReferenceImageInput } from "./openai-images-client.js";
import { compactPromptText } from "./prompt-runtime.js";

type SelectedHook = ArtworkGenerationRequest["selectedHooks"][number];
export function strategyOptionalCopyCandidates(
  strategy: CreativeStrategyEnrichment | undefined
): readonly {
  role: "proof" | "differentiator" | "offer";
  text: string;
}[] {
  if (!strategy) return [];

  const candidates = [
    ...strategy.proof.map((claim) => ({
      role: "proof" as const,
      text: claim.text
    })),
    {
      role: "differentiator" as const,
      text: strategy.differentiator.text
    },
    { role: "offer" as const, text: strategy.offer.text }
  ];
  const seen = new Set<string>();

  return candidates
    .map((candidate) => ({ ...candidate, text: candidate.text.trim() }))
    .filter((candidate) => {
      const key = candidate.text.toLocaleLowerCase();
      if (!candidate.text || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function buildActiveHumanPresenceRules(
  mode: CreativeStrategyEnrichment["humanPresence"] | undefined
): string {
  switch (mode) {
    case "avoid":
      return "Do not use people, faces, bodies, portraits, or hands. Build the concept through products, objects, typography, materials, architecture, environments, or graphic systems.";
    case "supporting":
      return "People may provide context, scale, interaction, or emotion, but they must remain clearly subordinate to the dominant message and hero system.";
    case "essential":
      return "Human presence is essential to the campaign. A person may become the hero when the message depends on human emotion, care, treatment, hospitality, teaching, physical experience, lifestyle, or interpersonal service.";
    default:
      return "Infer whether human presence materially improves the campaign message. Do not add people merely as decoration, but do not prohibit people by default.";
  }
}

export function buildActiveInformationDensityRules(
  density: "low" | "medium" | "high" | undefined
): string {
  const shared = [
    "Information density is a ceiling, never a target. Do not fill available space simply because more verified facts exist.",
    "Maintain one obvious first read, one dominant hero, and at least one genuine quiet zone.",
    "Never repeat the same claim, price, compatibility statement, benefit, or CTA."
  ];

  switch (density) {
    case "low":
      return [
        "Low information-density rules:",
        ...shared,
        "Show the mandatory headline, brand identification, and supplied CTA. Add at most one short supporting point only when it materially improves comprehension.",
        "Do not add feature grids, icon rows, compatibility lists, service bars, or multiple badges."
      ].join("\n");
    case "high":
      return [
        "High information-density rules:",
        ...shared,
        "Use no more than two compact supporting modules and no more than three distinct supporting facts across the entire artwork.",
        "High density permits required information; it does not require every verified fact to appear. Group mandatory utility copy quietly and keep the CTA secondary."
      ].join("\n");
    case "medium":
    default:
      return [
        "Medium information-density rules:",
        ...shared,
        "Use at most one compact supporting group containing no more than two distinct supporting points.",
        "Prefer omission over shrinking text, adding another badge, or building a bottom utility strip."
      ].join("\n");
  }
}

export function buildActiveOutputModeRules(
  service: ArtworkGenerationRequest["service"],
  hook: SelectedHook,
  albumFormat: AlbumFormat
): string {
  if (service !== "album-post") {
    return [
      "Static artwork rules:",
      "- Create one complete artwork in the requested canvas.",
      "- Make the message clear at mobile-feed size.",
      "- Use one dominant visual idea and a deliberate reading order.",
      "- Deliver one finished composition without alternate layouts or multiple design options."
    ].join("\n");
  }

  const panelCount = albumFormat.startsWith("three-") ? 3 : 4;
  const formatBeats = hook.formatBeats?.length
    ? compactPromptText(hook.formatBeats.join(" | "), 1_000)
    : "Not supplied.";
  return [
    "Album master rules:",
    "- Create one master artwork at 2048 × 2048.",
    `- Use the selected ${albumFormat} structure with ${panelCount} clearly separated panels.`,
    "- Treat every panel as part of one consistent campaign world.",
    "- Place the primary headline on the cover panel.",
    "- Use the CTA once, on the closing panel.",
    "- Keep important text, faces, logos, products, and focal objects away from panel seams.",
    "- Make every panel independently readable while preserving visual continuity across the master.",
    "- Keep typography, color logic, lighting, materials, and image treatment consistent.",
    "- Do not add page numbers, step numbers, or decorative sequence labels.",
    `- Distribute these story beats across the panels: ${formatBeats}`
  ].join("\n");
}

export interface CampaignArtifactRole {
  image: number;
  kind: "official-logo" | "official-product" | "style-reference" | "reference";
  role: string;
  instruction: string;
}

export function buildCampaignArtifactRole(
  reference: ReferenceImageInput,
  index: number
): CampaignArtifactRole {
  const role = compactPromptText(reference.label ?? "Reference image", 180);
  const normalized = role.toLowerCase();
  if (/logo|โลโก้/.test(normalized)) {
    return {
      image: index + 1,
      kind: "official-logo",
      role,
      instruction:
        "This is an official logo asset only. Preserve its identity. Do not use it as a style, composition, lighting, spatial-density, or visual-treatment reference."
    };
  }
  if (/product|packshot|สินค้า/.test(normalized)) {
    return {
      image: index + 1,
      kind: "official-product",
      role,
      instruction:
        "This is an official product asset. Preserve its visible identity and use it only for the product role stated in the label."
    };
  }
  if (/· style ·|style reference|past work style/.test(normalized)) {
    return {
      image: index + 1,
      kind: "style-reference",
      role,
      instruction:
        "Use this image only for its stated style-reference role. Do not copy its campaign content."
    };
  }
  return {
    image: index + 1,
    kind: "reference",
    role,
    instruction:
      "Use this image only for the role stated in its label. Do not infer unrelated style or campaign facts."
  };
}

export function selectRelevantProductOrServiceTruth({
  input,
  hook,
  references
}: {
  input: ArtworkGenerationRequest;
  hook: SelectedHook;
  references: readonly ReferenceImageInput[];
}): readonly ArtworkGenerationRequest["brandLibrary"]["products"][number][] {
  const products = input.brandLibrary.products;
  if (input.selectedProductIds !== undefined) {
    const selectedIds = new Set(input.selectedProductIds);
    return products.filter(
      (product) => product.id && selectedIds.has(product.id)
    );
  }
  if (products.length <= 1) return products;

  const productArtifactText = references
    .filter((reference) =>
      /product|packshot|สินค้า/i.test(reference.label ?? "")
    )
    .map((reference) => reference.label ?? "")
    .join(" ");
  const campaignTokens = meaningfulCampaignTokens(
    [
      input.brief,
      hook.hook,
      hook.concept,
      hook.cta,
      ...(hook.supportingPoints ?? []),
      productArtifactText
    ].join(" ")
  );
  const ranked = products
    .map((product, index) => ({
      product,
      index,
      score:
        overlapScore(meaningfulCampaignTokens(product.title), campaignTokens, 4) +
        overlapScore(
          meaningfulCampaignTokens(product.description),
          campaignTokens,
          1
        )
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const best = ranked[0];
  if (!best || best.score < 4) return [];
  if (ranked[1]?.score === best.score) return [];
  return [best.product];
}

const CAMPAIGN_RELEVANCE_STOP_WORDS = new Set([
  "about",
  "actual",
  "advertising",
  "agency",
  "brand",
  "campaign",
  "client",
  "create",
  "from",
  "into",
  "marketing",
  "offer",
  "product",
  "service",
  "that",
  "their",
  "this",
  "through",
  "with",
  "และ",
  "การ",
  "ของ",
  "ให้",
  "ที่",
  "ใน"
]);

function meaningfulCampaignTokens(value: string): ReadonlySet<string> {
  const tokens = value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(
    tokens
      .map(normalizeCampaignToken)
      .filter(
        (token) =>
          token.length >= 3 && !CAMPAIGN_RELEVANCE_STOP_WORDS.has(token)
      )
  );
}

function normalizeCampaignToken(token: string): string {
  if (!/^[a-z]+$/.test(token) || token.length < 5) return token;
  if (token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

function overlapScore(
  candidates: ReadonlySet<string>,
  campaignTokens: ReadonlySet<string>,
  weight: number
): number {
  let score = 0;
  for (const token of candidates) {
    if (campaignTokens.has(token)) score += weight;
  }
  return score;
}

export function compileNeutralWorkingBrief({
  brief,
  references,
  relevantProductOrService
}: {
  brief: string;
  references: readonly ReferenceImageInput[];
  relevantProductOrService: readonly ArtworkGenerationRequest["brandLibrary"]["products"][number][];
}): string {
  const hasPhysicalProductArtifact = references.some((reference) =>
    /product|packshot|สินค้า/i.test(reference.label ?? "")
  );
  const hasServiceTruth = relevantProductOrService.some((item) =>
    /agency|consult|service|workshop|บริการ|เอเจนซี่/i.test(
      `${item.title} ${item.description}`
    )
  );
  if (hasPhysicalProductArtifact || (!hasServiceTruth && relevantProductOrService.length)) {
    return compactPromptText(brief, 1_200);
  }

  return compactPromptText(
    brief
      .replace(
        /\bshow the product in the first visual beat\b/gi,
        "make the core offer or value proposition visually clear in the first visual beat"
      )
      .replace(
        /\bshow the product early\b/gi,
        "make the core offer or value proposition visually clear early"
      )
      .replace(
        /\bprove the product difference\b/gi,
        "make the core offer or value proposition credible"
      ),
    1_200
  );
}

export function isBrandGuidelineItem(item: { title: string }): boolean {
  return item.title.toLowerCase().replace(/[^a-z0-9]+/g, "") ===
    "brandciguideline";
}

export function isEditableBrandGuidelineItem(item: { title: string }): boolean {
  return item.title.toLowerCase().replace(/[^a-z0-9]+/g, "") ===
    "brandguideline";
}

export function isRepeatedCampaignDirectionItem(item: { title: string }): boolean {
  const title = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return [
    "campaignbrief",
    "caption",
    "rationale",
    "idearationale",
    "visualdirection"
  ].includes(title);
}

export function buildDesignSystemCopyPriority(): string {
  return [
    "Render mandatory on-artwork copy once.",
    "Treat optional content as source material and include only what materially improves understanding, persuasion, or required execution.",
    "Let the visual earn first attention; use copy to confirm and sharpen the message.",
    "Choose the information architecture freely for the campaign's actual communication job.",
    "Rank and group information so the intended reading order is clear.",
    "Every visible element must earn its place. Never invent unsupported facts, claims, statistics, offers, certifications, partners, or product functions."
  ].join("\n");
}


