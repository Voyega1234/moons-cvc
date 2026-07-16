import { waitUntil } from "@vercel/functions";
import { handleClientIngestionTriggerRequest } from "../src/server/client-ingestion/client-ingestion-trigger-endpoint.js";

export const config = {
  maxDuration: 300
};

type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
};

type VercelResponse = {
  status(statusCode: number): VercelResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
};

export default async function handler(
  request: VercelRequest,
  response: VercelResponse
) {
  const triggerResponse = await handleClientIngestionTriggerRequest({
    request: toFetchRequest(request),
    env: {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      APIFY_TOKEN: process.env.APIFY_TOKEN,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_BRAND_ANALYSIS_MODEL: process.env.OPENAI_BRAND_ANALYSIS_MODEL,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GEMINI_GROUNDING_MODEL: process.env.GEMINI_GROUNDING_MODEL
    },
    scheduleWorker: waitUntil
  });

  response.status(triggerResponse.status);
  response.setHeader("Content-Type", "application/json");
  response.json(await triggerResponse.json());
}

function toFetchRequest(request: VercelRequest): Request {
  return new Request("https://moons.local/api/trigger-client-ingestion", {
    method: request.method ?? "GET",
    headers: toHeaders(request.headers)
  });
}

function toHeaders(
  headers: Record<string, string | string[] | undefined>
): Headers {
  const nextHeaders = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      nextHeaders.set(key, value.join(","));
      continue;
    }

    if (value) nextHeaders.set(key, value);
  }

  return nextHeaders;
}
