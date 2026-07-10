import type { Brand } from "../../domain/brand";
import type { CreativeDirection } from "../../domain/creative-run";
import type { WorkflowState } from "../../features/workflow/model";

export interface HookGenerationInput {
  brand: Brand | null;
  service: WorkflowState["service"];
  quantity: number;
  brief: string;
  extraInstructions?: string;
  existingHooks?: readonly { hook: string; concept: string }[];
}

export interface HookGenerationRunInput {
  run: WorkflowState;
  extraInstructions?: string;
}

export interface RawDirection {
  id?: unknown;
  hook?: unknown;
  concept?: unknown;
  why?: unknown;
  visual?: unknown;
  cta?: unknown;
  caption?: unknown;
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

  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : `direction-${index + 1}`,
    hook: raw.hook,
    concept: raw.concept,
    why:
      typeof raw.why === "string" && raw.why
        ? raw.why
        : "Works when the audience needs fast clarity.",
    visual: raw.visual,
    cta: typeof raw.cta === "string" && raw.cta ? raw.cta : "Learn more",
    caption:
      typeof raw.caption === "string" && raw.caption
        ? raw.caption
        : `${raw.hook} ${raw.concept}.`,
    selected: false
  };
}
