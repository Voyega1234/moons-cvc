import type { CreativeDirection } from "../../domain/creative-run";
import { env } from "../../config/env";
import { getSupabaseClient } from "../../lib/supabase/client";
import {
  normalizeCreativeDirections,
  type HookGenerationInput,
  type RawDirection
} from "./hook-generation-types";
import { buildOnboardingQuestionnaireHookContext } from "./onboarding-questionnaire-hook-context";

export async function generateDirectionsFromWebhook(
  input: HookGenerationInput
): Promise<readonly CreativeDirection[]> {
  return requestDirectionsFromWebhook(input, env.hookGenerationWebhookUrl);
}

export async function generateDirectionsFromNewCompassWebhook(
  input: HookGenerationInput
): Promise<readonly CreativeDirection[]> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  try {
    const { data } = await getSupabaseClient().auth.getSession();
    if (data.session?.access_token) {
      headers.Authorization = `Bearer ${data.session.access_token}`;
    }
  } catch {
    // The proxy will return Unauthorized when auth is required.
  }

  return requestDirectionsFromWebhook(
    input,
    env.hookGenerationNewEndpoint,
    headers
  );
}

async function requestDirectionsFromWebhook(
  input: HookGenerationInput,
  endpoint: string,
  headers: Record<string, string> = { "Content-Type": "application/json" }
): Promise<readonly CreativeDirection[]> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      brand: input.brand
        ? {
            id: input.brand.id,
            name: input.brand.name,
            category: input.brand.category
          }
        : null,
      brief: {
        hookIdeaMode: input.hookIdeaMode,
        albumFormat: input.albumFormat,
        service: input.service,
        quantity: input.quantity,
        contentTypeQuotas: input.contentTypeQuotas ?? [
          { service: input.service, count: input.quantity }
        ],
        text: input.brief,
        onboardingQuestionnaire: buildOnboardingQuestionnaireHookContext(
          input.brand?.onboardingQuestionnaire
        ),
        extraInstructions: input.extraInstructions?.trim() ?? ""
      },
      uploadedMaterials: input.uploadedMaterials ?? []
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
