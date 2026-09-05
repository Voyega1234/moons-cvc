import { env } from "../../config/env";
import { getSupabaseClient } from "../../lib/supabase/client";
import type {
  IdeaPreflightCheckId,
  IdeaPreflightFixableField
} from "./run-idea-preflight";

export interface ApplyIdeaPreflightFixInput {
  field: IdeaPreflightFixableField;
  check: IdeaPreflightCheckId;
  message: string;
  suggestion: string | null;
  instructions?: string;
  direction: {
    hook: string;
    subheadline: string;
    concept: string;
    visual: string;
    cta: string;
    caption: string;
  };
  brandPolicies?: readonly string[];
  brandAvoid?: readonly string[];
}

export async function applyIdeaPreflightFix(
  input: ApplyIdeaPreflightFixInput
): Promise<string> {
  const response = await fetch(env.ideaPreflightFixEndpoint, {
    method: "POST",
    headers: await buildHeaders(),
    body: JSON.stringify({
      ...input,
      instructions: input.instructions ?? "",
      brandPolicies: input.brandPolicies ?? [],
      brandAvoid: input.brandAvoid ?? []
    })
  });
  const payload = await readJsonResponse<{
    revisedText?: string;
    error?: string;
  }>(response);

  if (!response.ok) {
    throw new Error(
      payload.error ?? `Idea preflight fix failed (${response.status}).`
    );
  }
  if (!payload.revisedText?.trim()) {
    throw new Error("Idea preflight fix returned no revised text.");
  }

  return payload.revisedText;
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
    throw new Error("Idea preflight fix returned an empty response body.");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Idea preflight fix returned a non-JSON response.");
  }
}
