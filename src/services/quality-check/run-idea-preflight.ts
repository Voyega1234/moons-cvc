import { env } from "../../config/env";
import { getSupabaseClient } from "../../lib/supabase/client";

export type IdeaPreflightCheckId = "quality" | "spelling" | "policy";

export interface IdeaPreflightContext {
  runId: string;
  brief: string;
  brandContext: {
    name: string;
    category: string;
    policies: readonly string[];
    products: readonly string[];
    documents: readonly string[];
    working: readonly string[];
    avoid: readonly string[];
  } | null;
}

export interface IdeaPreflightDirection {
  id: string;
  service: string;
  hook: string;
  subheadline: string;
  concept: string;
  visual: string;
  cta: string;
  caption: string;
  formatBeats: readonly string[];
  revisionFeedback: string;
}

export type IdeaPreflightFixableField =
  | "hook"
  | "subheadline"
  | "concept"
  | "visual"
  | "cta"
  | "caption";

export interface IdeaPreflightFinding {
  check: IdeaPreflightCheckId;
  message: string;
  field: IdeaPreflightFixableField | null;
  suggestion: string | null;
}

export interface IdeaPreflightResult {
  directionId: string;
  findings: readonly IdeaPreflightFinding[];
}

export interface IdeaPreflightRequest extends IdeaPreflightContext {
  checks: readonly IdeaPreflightCheckId[];
  directions: readonly IdeaPreflightDirection[];
}

export async function runIdeaPreflight(
  request: IdeaPreflightRequest
): Promise<readonly IdeaPreflightResult[]> {
  const response = await fetch(env.ideaPreflightEndpoint, {
    method: "POST",
    headers: await buildHeaders(),
    body: JSON.stringify(request)
  });
  const payload = await readJsonResponse<{
    results?: readonly IdeaPreflightResult[];
    error?: string;
  }>(response);

  if (!response.ok) {
    throw new Error(
      payload.error ?? `Idea preflight failed (${response.status}).`
    );
  }
  if (!Array.isArray(payload.results)) {
    throw new Error("Idea preflight returned no results.");
  }

  const returnedIds = new Set(payload.results.map((result) => result.directionId));
  const missing = request.directions.filter(
    (direction) => !returnedIds.has(direction.id)
  );
  if (missing.length) {
    throw new Error(
      `Idea preflight did not return ${missing.length} expected ${missing.length === 1 ? "idea" : "ideas"}.`
    );
  }

  return payload.results;
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

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error("Idea preflight returned an empty response body.");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Idea preflight returned a non-JSON response.");
  }
}
