import { env } from "../../config/env";
import type { WorkflowState } from "../../features/workflow/model";
import { getSupabaseClient } from "../../lib/supabase/client";

export interface LearningSuggestion {
  polarity: "working" | "avoid";
  note: string;
}

export async function suggestBrandLearning(
  run: WorkflowState
): Promise<readonly LearningSuggestion[]> {
  if (!run.brand) {
    throw new Error("Select a brand before requesting learning suggestions.");
  }

  const request = {
    runId: run.id,
    brand: {
      id: run.brand.id,
      name: run.brand.name,
      category: run.brand.category
    },
    service: run.service,
    brief: run.brief,
    creatives: run.outputs.map((output) => {
      const direction = run.directions.find(
        (candidate) => candidate.id === output.directionId
      );
      return {
        hook: direction?.hook ?? "",
        concept: direction?.concept ?? "",
        visual: direction?.visual ?? "",
        cta: direction?.cta ?? "",
        caption: direction?.caption ?? "",
        graphicDesign: output.approval.graphicDesign,
        clientService: output.approval.clientService,
        projectManager: output.approval.projectManager,
        clientStatus: output.clientStatus
      };
    })
  };

  const response = await fetch(env.brandLearningSuggestionEndpoint, {
    method: "POST",
    headers: await buildHeaders(),
    body: JSON.stringify(request)
  });

  const payload = await readJsonResponse<{
    suggestions?: readonly LearningSuggestion[];
    error?: string;
  }>(response, "Brand learning suggestion");

  if (!response.ok) {
    throw new Error(
      payload.error ?? `Brand learning suggestion failed (${response.status}).`
    );
  }

  if (!Array.isArray(payload.suggestions)) {
    throw new Error("Brand learning suggestion returned no suggestions.");
  }

  return payload.suggestions;
}

async function readJsonResponse<T>(
  response: Response,
  label: string
): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(`${label} returned an empty response body.`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label} returned a non-JSON response.`);
  }
}

async function buildHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  try {
    const { data } = await getSupabaseClient().auth.getSession();
    if (data.session?.access_token) {
      headers.Authorization = `Bearer ${data.session.access_token}`;
    }
  } catch {
    return headers;
  }

  return headers;
}
