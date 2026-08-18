import type { Brand } from "../../domain/brand";
import type {
  AlbumFormatPreference,
  HookIdeaMode,
  UploadedCreativeMaterial
} from "../../domain/creative-run";
import {
  albumFormats,
  ctaActionTypes,
  normalizeFormatBeatsForService,
  serviceTypes,
  type CreativeDirection,
  type ServiceType,
  type UgcVideoBrief
} from "../../domain/creative-run";
import type { WorkflowState } from "../../features/workflow/model";
import { normalizeGeneratedCaptionFormatting } from "../../domain/caption-formatting";
import { resolveSubheadlineHighlight } from "../../domain/subheadline-highlight";

export interface HookGenerationInput {
  brand: Brand | null;
  hookIdeaMode: HookIdeaMode;
  albumFormat?: AlbumFormatPreference;
  service: WorkflowState["service"];
  quantity: number;
  contentTypeQuotas?: readonly { service: ServiceType; count: number }[];
  brief: string;
  extraInstructions?: string;
  uploadedMaterials?: readonly Pick<
    UploadedCreativeMaterial,
    "id" | "name" | "mediaType" | "role" | "description" | "url"
  >[];
}

export interface HookGenerationRunInput {
  run: WorkflowState;
  extraInstructions?: string;
}

export interface RawDirection {
  id?: unknown;
  service?: unknown;
  hook?: unknown;
  subheadline?: unknown;
  concept?: unknown;
  subheadlineHighlight?: unknown;
  why?: unknown;
  visual?: unknown;
  cta?: unknown;
  supportingPoints?: unknown;
  formatBeats?: unknown;
  albumFormat?: unknown;
  ugcBrief?: unknown;
  ctaActionType?: unknown;
  ctaDestination?: unknown;
  contactLine?: unknown;
  caption?: unknown;
  score?: unknown;
}

export function normalizeCreativeDirections(
  rawDirections: readonly RawDirection[]
): readonly CreativeDirection[] {
  if (!rawDirections.length) {
    throw new Error("Hook generation returned no hooks.");
  }

  return rawDirections.map((raw, index) => toDirection(raw, index));
}

function toDirection(raw: RawDirection, index: number): CreativeDirection {
  if (
    typeof raw.hook !== "string" ||
    typeof raw.concept !== "string" ||
    typeof raw.visual !== "string"
  ) {
    throw new Error("Hook generation returned an unexpected hook shape.");
  }

  const subheadline =
    typeof raw.subheadline === "string"
      ? raw.subheadline.trim()
      : "";
  const service =
    typeof raw.service === "string" &&
    serviceTypes.includes(raw.service as ServiceType)
      ? (raw.service as ServiceType)
      : undefined;
  const formatBeats = normalizeFormatBeatsForService(
    service,
    Array.isArray(raw.formatBeats)
      ? raw.formatBeats.filter(
          (item): item is string => typeof item === "string"
        )
      : []
  );
  const albumFormat =
    typeof raw.albumFormat === "string" &&
    albumFormats.includes(raw.albumFormat as (typeof albumFormats)[number])
      ? (raw.albumFormat as (typeof albumFormats)[number])
      : undefined;
  const why =
    typeof raw.why === "string" && raw.why
      ? raw.why
      : "Works when the audience needs fast clarity.";
  const cta = typeof raw.cta === "string" && raw.cta ? raw.cta : "Learn more";
  const caption = normalizeGeneratedCaptionFormatting(
    typeof raw.caption === "string" && raw.caption
      ? raw.caption
      : `${raw.hook} ${raw.concept}.`
  );
  const ugcBrief =
    service === "ugc-video"
      ? normalizeUgcVideoBrief(raw.ugcBrief, {
          hook: raw.hook,
          concept: raw.concept,
          why,
          visual: raw.visual,
          cta,
          caption,
          formatBeats
        })
      : undefined;

  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : `direction-${index + 1}`,
    service,
    hook: raw.hook,
    subheadline,
    concept: raw.concept,
    subheadlineHighlight: resolveSubheadlineHighlight(
      subheadline,
      typeof raw.subheadlineHighlight === "string"
        ? raw.subheadlineHighlight
        : undefined
    ),
    why,
    visual: raw.visual,
    cta,
    supportingPoints: Array.isArray(raw.supportingPoints)
      ? raw.supportingPoints.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0
        )
      : [],
    formatBeats,
    ...(albumFormat ? { albumFormat } : {}),
    ...(ugcBrief ? { ugcBrief } : {}),
    ...(typeof raw.ctaActionType === "string" &&
    ctaActionTypes.includes(raw.ctaActionType as (typeof ctaActionTypes)[number])
      ? { ctaActionType: raw.ctaActionType as (typeof ctaActionTypes)[number] }
      : {}),
    ...(typeof raw.ctaDestination === "string" && raw.ctaDestination.trim()
      ? { ctaDestination: raw.ctaDestination.trim() }
      : {}),
    ...(typeof raw.contactLine === "string" && raw.contactLine.trim()
      ? { contactLine: raw.contactLine.trim() }
      : {}),
    caption,
    ...(typeof raw.score === "number" && Number.isFinite(raw.score)
      ? { score: raw.score }
      : {}),
    selected: false
  };
}

function normalizeUgcVideoBrief(
  value: unknown,
  fallback: {
    hook: string;
    concept: string;
    why: string;
    visual: string;
    cta: string;
    caption: string;
    formatBeats: readonly string[];
  }
): UgcVideoBrief {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const text = (field: string, fallbackValue: string) =>
    typeof record[field] === "string" && record[field].trim()
      ? record[field].trim()
      : fallbackValue;
  const legacyScripts = [
    text("openingScript", fallback.formatBeats[0] ?? fallback.hook),
    text(
      "showcaseScript",
      fallback.formatBeats.slice(1, -1).join(" / ") || fallback.concept
    ),
    text(
      "closingScript",
      fallback.formatBeats.at(-1) ?? `${fallback.cta} ${fallback.caption}`
    )
  ];
  const fallbackScenes = [
    {
      title: "HOOK",
      duration: "0–5 วินาที",
      scriptLines: [legacyScripts[0]!],
      visual: fallback.visual,
      textOverlay: fallback.hook
    },
    {
      title: "DEVELOPMENT",
      duration: "5–15 วินาที",
      scriptLines: [legacyScripts[1]!],
      visual: fallback.visual,
      textOverlay: fallback.concept
    },
    {
      title: "PROOF / BENEFIT",
      duration: "15–25 วินาที",
      scriptLines: [fallback.why],
      visual: fallback.visual,
      textOverlay: fallback.why
    },
    {
      title: "CTA",
      duration: "25–30 วินาที",
      scriptLines: [legacyScripts[2]!],
      visual: fallback.visual,
      textOverlay: fallback.cta
    }
  ];
  const scenes = Array.isArray(record.scenes)
    ? record.scenes.flatMap((scene, index) => {
        if (!scene || typeof scene !== "object" || Array.isArray(scene)) return [];
        const item = scene as Record<string, unknown>;
        const scriptLines = Array.isArray(item.scriptLines)
          ? item.scriptLines.filter(
              (line): line is string =>
                typeof line === "string" && line.trim().length > 0
            )
          : [];
        if (!scriptLines.length) return [];
        const fallbackScene = fallbackScenes[index] ?? fallbackScenes[3]!;
        return [
          {
            title:
              typeof item.title === "string" && item.title.trim()
                ? item.title.trim()
                : fallbackScene.title,
            duration:
              typeof item.duration === "string" && item.duration.trim()
                ? item.duration.trim()
                : fallbackScene.duration,
            scriptLines,
            visual:
              typeof item.visual === "string" && item.visual.trim()
                ? item.visual.trim()
                : fallbackScene.visual,
            textOverlay:
              typeof item.textOverlay === "string"
                ? item.textOverlay.trim()
                : fallbackScene.textOverlay
          }
        ];
      })
    : [];

  return {
    product: text("product", "สินค้า/บริการตาม Brief"),
    duration: text("duration", "15–30 วินาที"),
    objective: text("objective", fallback.why),
    moodAndTone: text("moodAndTone", fallback.visual),
    productionStyle: text(
      "productionStyle",
      "Creator-led vertical video ที่เป็นธรรมชาติและตัดต่อกระชับ"
    ),
    referenceDirection: text("referenceDirection", fallback.visual),
    scenes: scenes.length === 4 ? scenes : fallbackScenes
  };
}
