import { env } from "../../config/env";
import type { WorkflowState } from "../../features/workflow/model";
import { getSupabaseClient } from "../../lib/supabase/client";

export interface QualityCheckResult {
  outputId: string;
  passed: boolean;
  reason: string;
}

export async function runQualityCheck(
  run: WorkflowState
): Promise<readonly QualityCheckResult[]> {
  const checkable = run.outputs.filter((output) => output.assetUrl);
  if (!checkable.length) return [];

  const request = {
    runId: run.id,
    brief: run.brief,
    outputs: checkable.map((output) => {
      const direction = run.directions.find(
        (candidate) => candidate.id === output.directionId
      );
      return {
        id: output.id,
        hook: direction?.hook ?? "",
        concept: direction?.concept ?? "",
        visual: direction?.visual ?? "",
        assetUrl: output.assetUrl as string
      };
    })
  };

  const response = await fetch(env.qualityCheckEndpoint, {
    method: "POST",
    headers: await buildHeaders(),
    body: JSON.stringify(request)
  });

  const payload = await readJsonResponse<{
    results?: readonly QualityCheckResult[];
    error?: string;
  }>(response, "Quality check");

  if (!response.ok) {
    throw new Error(payload.error ?? `Quality check failed (${response.status}).`);
  }

  if (!Array.isArray(payload.results)) {
    throw new Error("Quality check returned no results.");
  }

  return payload.results;
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
