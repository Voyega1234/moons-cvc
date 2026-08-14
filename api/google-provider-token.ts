import { handleGoogleWorkspaceAccessTokenRequest } from "../src/server/google-workspace/workspace-access-token-endpoint.js";

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
    const tokenResponse = await handleGoogleWorkspaceAccessTokenRequest({
      request: toWebRequest(request),
      env: {
        VERCEL_ENV: process.env.VERCEL_ENV,
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
        GOOGLE_CLOUD_PROJECT_NUMBER: process.env.GOOGLE_CLOUD_PROJECT_NUMBER,
        GOOGLE_WORKLOAD_IDENTITY_POOL: process.env.GOOGLE_WORKLOAD_IDENTITY_POOL,
        GOOGLE_WORKLOAD_IDENTITY_PROVIDER: process.env.GOOGLE_WORKLOAD_IDENTITY_PROVIDER,
        GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        GOOGLE_WORKSPACE_LOCAL_USER: process.env.GOOGLE_WORKSPACE_LOCAL_USER
      },
      oidcToken: headerValue(request.headers["x-vercel-oidc-token"])
    });

    response.status(tokenResponse.status);
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    response.json(await tokenResponse.json());
  } catch (caught) {
    console.error(
      "Google provider token endpoint failed.",
      caught instanceof Error ? caught.message : "Unknown error"
    );
    response.status(500);
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    response.json({
      ok: false,
      error: "Google Workspace access could not be authorized."
    });
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(",") : value;
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
