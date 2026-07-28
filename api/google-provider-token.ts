import { handleGoogleProviderTokenRequest } from "../src/server/google-workspace/provider-token-cache-endpoint.js";

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
  try {
    const tokenResponse = await handleGoogleProviderTokenRequest({
      request: toWebRequest(request),
      env: {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
        GOOGLE_OAUTH_CLIENT_ID:
          process.env.GOOGLE_OAUTH_CLIENT_ID ??
          process.env.VITE_GOOGLE_OAUTH_CLIENT_ID,
        GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        GOOGLE_TOKEN_ENCRYPTION_KEY:
          process.env.GOOGLE_TOKEN_ENCRYPTION_KEY
      }
    });

    response.status(tokenResponse.status);
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    response.json(await tokenResponse.json());
  } catch {
    response.status(500);
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    response.json({
      ok: false,
      error: "Google access could not be renewed. Continue with Google again."
    });
  }
}

function toWebRequest(request: VercelRequest): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    const normalized = Array.isArray(value) ? value.join(",") : value;
    if (normalized) headers.set(key, normalized);
  }
  if (request.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  return new Request("https://moons.local/api/google-provider-token", {
    method: request.method ?? "GET",
    headers,
    body:
      request.body === undefined
        ? undefined
        : typeof request.body === "string"
          ? request.body
          : JSON.stringify(request.body)
  });
}
