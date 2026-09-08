import { env } from "../../config/env";
import { getSupabaseClient } from "../../lib/supabase/client";

export interface ExtractedArtworkCopy {
  outputId: string;
  headline: string;
  keyMessage: readonly string[];
  cta: string;
  footer: string;
}

export async function extractArtworkCopy(
  outputs: readonly { id: string; assetUrl: string }[]
): Promise<readonly ExtractedArtworkCopy[]> {
  if (!outputs.length) return [];

  const response = await fetch(env.extractArtworkCopyEndpoint, {
    method: "POST",
    headers: await buildHeaders(),
    body: JSON.stringify({ outputs })
  });

  const payload = await readJsonResponse<{
    results?: readonly ExtractedArtworkCopy[];
    error?: string;
  }>(response, "Artwork copy extraction");

  if (!response.ok) {
    throw new Error(payload.error ?? `Artwork copy extraction failed (${response.status}).`);
  }

  if (!Array.isArray(payload.results)) {
    throw new Error("Artwork copy extraction returned no results.");
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
