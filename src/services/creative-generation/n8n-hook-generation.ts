import type { CreativeDirection } from "../../domain/creative-run";
import { env } from "../../config/env";
import {
  normalizeCreativeDirections,
  type HookGenerationInput,
  type RawDirection
} from "./hook-generation-types";

export async function generateDirectionsFromWebhook(
  input: HookGenerationInput
): Promise<readonly CreativeDirection[]> {
  const response = await fetch(env.hookGenerationWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      brand: input.brand
        ? {
            id: input.brand.id,
            name: input.brand.name,
            category: input.brand.category
          }
        : null,
      brief: {
        service: input.service,
        quantity: input.quantity,
        text: input.brief
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Hook generation failed (${response.status}).`);
  }

  const payload: unknown = await response.json();
  const rawDirections = extractRawDirections(payload);

  return normalizeCreativeDirections(rawDirections);
}

function extractRawDirections(payload: unknown): readonly RawDirection[] {
  if (Array.isArray(payload)) return payload as RawDirection[];
  if (
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { directions?: unknown }).directions)
  ) {
    return (payload as { directions: RawDirection[] }).directions;
  }
  return [];
}
