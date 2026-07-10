import { handleQualityCheckRequest } from "../src/server/quality-check/quality-check-endpoint.js";

export const config = {
  maxDuration: 90
};

type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
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
  const workerResponse = await handleQualityCheckRequest({
    request: toFetchRequest(request),
    env: {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_QUALITY_CHECK_MODEL: process.env.OPENAI_QUALITY_CHECK_MODEL,
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
    }
  });

  const bodyText = await workerResponse.text();

  response.status(workerResponse.status);
  response.setHeader("Content-Type", "application/json");
  response.json(parseJsonBody(bodyText));
}

function toFetchRequest(request: VercelRequest): Request {
  return new Request("https://moons.local/api/quality-check", {
    method: request.method ?? "GET",
    headers: toHeaders(request.headers),
    body:
      request.method === "POST"
        ? typeof request.body === "string"
          ? request.body
          : JSON.stringify(request.body ?? {})
        : undefined
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

    if (value) {
      nextHeaders.set(key, value);
    }
  }

  if (!nextHeaders.has("Content-Type")) {
    nextHeaders.set("Content-Type", "application/json");
  }

  return nextHeaders;
}

function parseJsonBody(text: string): unknown {
  if (!text.trim()) {
    return {
      ok: false,
      error: "Quality check returned an empty response body."
    };
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      ok: false,
      error: "Quality check returned a non-JSON response body."
    };
  }
}
