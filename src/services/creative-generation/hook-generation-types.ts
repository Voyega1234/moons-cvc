import type { Brand } from "../../domain/brand";
import type {
  HookIdeaMode,
  UploadedCreativeMaterial
} from "../../domain/creative-run";
import {
  ctaActionTypes,
  normalizeFormatBeatsForService,
  serviceTypes,
  type CreativeDirection,
  type ServiceType,
  type UgcVideoBrief
} from "../../domain/creative-run";
import type { WorkflowState } from "../../features/workflow/model";
import { resolveSubheadlineHighlight } from "../../domain/subheadline-highlight";

export interface HookGenerationInput {
  brand: Brand | null;
  hookIdeaMode: HookIdeaMode;
  service: WorkflowState["service"];
  quantity: number;
  contentTypeQuotas?: readonly { service: ServiceType; count: number }[];
  brief: string;
  extraInstructions?: string;
  existingHooks?: readonly { hook: string; concept: string }[];
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
    typeof raw.subheadline === "string" && raw.subheadline.trim()
      ? raw.subheadline
      : raw.concept;
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
  const why =
    typeof raw.why === "string" && raw.why
      ? raw.why
      : "Works when the audience needs fast clarity.";
  const cta = typeof raw.cta === "string" && raw.cta ? raw.cta : "Learn more";
  const caption =
    typeof raw.caption === "string" && raw.caption
      ? raw.caption
      : `${raw.hook} ${raw.concept}.`;
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
    openingScript: text(
      "openingScript",
      fallback.formatBeats[0] ?? fallback.hook
    ),
    showcaseScript: text(
      "showcaseScript",
      fallback.formatBeats[1] ?? fallback.concept
    ),
    closingScript: text(
      "closingScript",
      fallback.formatBeats[2] ?? `${fallback.cta} — ${fallback.caption}`
    )
  };
}
