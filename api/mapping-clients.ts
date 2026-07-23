import { handleMappingClientsRequest } from "../src/server/google-sheets/mapping-clients-endpoint.js";

export const config = {
  maxDuration: 30
};

type VercelRequest = {
  method?: string;
  url?: string;
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
  const workerResponse = await handleMappingClientsRequest({
    request: toWebRequest(request),
    env: {
      VERCEL_ENV: process.env.VERCEL_ENV,
      GOOGLE_CLOUD_PROJECT_NUMBER: process.env.GOOGLE_CLOUD_PROJECT_NUMBER,
      GOOGLE_WORKLOAD_IDENTITY_POOL:
        process.env.GOOGLE_WORKLOAD_IDENTITY_POOL,
      GOOGLE_WORKLOAD_IDENTITY_PROVIDER:
        process.env.GOOGLE_WORKLOAD_IDENTITY_PROVIDER,
      GOOGLE_SERVICE_ACCOUNT_EMAIL:
        process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      GOOGLE_APPLICATION_CREDENTIALS:
        process.env.GOOGLE_APPLICATION_CREDENTIALS,
      GOOGLE_WORKSPACE_LOCAL_USER:
        process.env.GOOGLE_WORKSPACE_LOCAL_USER,
      MAPPING_CLIENTS_GOOGLE_SHEET_URL:
        process.env.MAPPING_CLIENTS_GOOGLE_SHEET_URL,
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
    },
    oidcToken: headerValue(request.headers["x-vercel-oidc-token"])
  });
  const bodyText = await workerResponse.text();

  response.status(workerResponse.status);
  response.setHeader("Content-Type", "application/json");
  response.json(parseJsonBody(bodyText));
}

export function toWebRequest(request: VercelRequest): Request {
  const url = new URL(
    request.url ?? "/api/mapping-clients",
    "https://moons.local"
  );
  return new Request(url, {
    method: request.method ?? "GET",
    headers: toHeaders(request.headers)
  });
}

function toHeaders(
  headers: Record<string, string | string[] | undefined>
): Headers {
  const nextHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    const normalized = headerValue(value);
    if (normalized) nextHeaders.set(key, normalized);
  }
  return nextHeaders;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(",") : value;
}

function parseJsonBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      ok: false,
      error: "Google Sheet mapping returned a non-JSON response body."
    };
  }
}
