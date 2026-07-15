import type { Brand } from "../../domain/brand";
import type { UploadedCreativeMaterial } from "../../domain/creative-run";
import {
  ctaActionTypes,
  serviceTypes,
  type CreativeDirection,
  type ServiceType
} from "../../domain/creative-run";
import type { WorkflowState } from "../../features/workflow/model";
import { resolveSubheadlineHighlight } from "../../domain/subheadline-highlight";

export interface HookGenerationInput {
  brand: Brand | null;
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

  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : `direction-${index + 1}`,
    service:
      typeof raw.service === "string" &&
      serviceTypes.includes(raw.service as ServiceType)
        ? (raw.service as ServiceType)
        : undefined,
    hook: raw.hook,
    subheadline,
    concept: raw.concept,
    subheadlineHighlight: resolveSubheadlineHighlight(
      subheadline,
      typeof raw.subheadlineHighlight === "string"
        ? raw.subheadlineHighlight
        : undefined
    ),
    why:
      typeof raw.why === "string" && raw.why
        ? raw.why
        : "Works when the audience needs fast clarity.",
    visual: raw.visual,
    cta: typeof raw.cta === "string" && raw.cta ? raw.cta : "Learn more",
    supportingPoints: Array.isArray(raw.supportingPoints)
      ? raw.supportingPoints.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0
        )
      : [],
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
    caption:
      typeof raw.caption === "string" && raw.caption
        ? raw.caption
        : `${raw.hook} ${raw.concept}.`,
    ...(typeof raw.score === "number" && Number.isFinite(raw.score)
      ? { score: raw.score }
      : {}),
    selected: false
  };
}
