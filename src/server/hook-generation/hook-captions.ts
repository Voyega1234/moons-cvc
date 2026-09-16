import { normalizeGeneratedCaptionFormatting } from "../../domain/caption-formatting.js";

export const hookCaptionsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    captions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { id: { type: "string" }, caption: { type: "string" } },
        required: ["id", "caption"]
      }
    }
  },
  required: ["captions"]
};

export function mergeHookCaptions<T extends { id: string; caption: string }>(
  directions: readonly T[],
  payload: unknown
): T[] {
  const entries = (payload as { captions?: unknown } | null)?.captions;
  if (!Array.isArray(entries) || entries.length !== directions.length) {
    throw new Error("Caption response must include exactly one caption per direction.");
  }
  const captions = new Map<string, string>();
  for (const entry of entries) {
    if (!entry || typeof entry.id !== "string" || typeof entry.caption !== "string" ||
        !entry.caption.trim() || captions.has(entry.id) ||
        !directions.some((direction) => direction.id === entry.id)) {
      throw new Error("Caption response contains an invalid, duplicate or unknown direction.");
    }
    captions.set(entry.id, normalizeGeneratedCaptionFormatting(entry.caption));
  }
  return directions.map((direction) => ({ ...direction, caption: captions.get(direction.id)! }));
}
