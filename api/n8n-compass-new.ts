import { handleN8nCompassNewRequest } from "../src/server/hook-generation/n8n-compass-new-endpoint.js";

export const config = {
  maxDuration: 900
};

type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type VercelResponse = {
  status(statusCode: number): VercelResponse;
  setHeader(name: string, value: string): void;
  send(body: string): void;
};

export default async function handler(
  request: VercelRequest,
  response: VercelResponse
) {
  const proxyResponse = await handleN8nCompassNewRequest({
    request: toFetchRequest(request),
    env: {
      N8N_COMPASS_NEW_WEBHOOK_URL:
        process.env.N8N_COMPASS_NEW_WEBHOOK_URL,
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
    }
  });
  const body = await proxyResponse.text();

  response.status(proxyResponse.status);
  response.setHeader(
    "Content-Type",
    proxyResponse.headers.get("content-type") || "application/json"
  );
  response.send(body);
}

function toFetchRequest(request: VercelRequest): Request {
  return new Request("https://moons.local/api/n8n-compass-new", {
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
    } else if (value) {
      nextHeaders.set(key, value);
    }
  }

  if (!nextHeaders.has("Content-Type")) {
    nextHeaders.set("Content-Type", "application/json");
  }
  return nextHeaders;
}
