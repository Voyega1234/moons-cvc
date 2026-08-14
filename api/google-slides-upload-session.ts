import { handleGoogleSlidesUploadSessionRequest } from "../src/server/google-workspace/google-slides-upload-session-endpoint.js";

export const config = { maxDuration: 60 };

type VercelRequest = {
  method?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
};

type VercelResponse = {
  status(statusCode: number): VercelResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const workerResponse = await handleGoogleSlidesUploadSessionRequest({
    request: new Request("https://moons.local/api/google-slides-upload-session", {
      method: request.method ?? "POST",
      headers: toHeaders(request.headers),
      body:
        request.method === "POST"
          ? typeof request.body === "string"
            ? request.body
            : JSON.stringify(request.body ?? {})
          : undefined
    }),
    env: {
      VERCEL_ENV: process.env.VERCEL_ENV,
      GOOGLE_CLOUD_PROJECT_NUMBER: process.env.GOOGLE_CLOUD_PROJECT_NUMBER,
      GOOGLE_WORKLOAD_IDENTITY_POOL: process.env.GOOGLE_WORKLOAD_IDENTITY_POOL,
      GOOGLE_WORKLOAD_IDENTITY_PROVIDER: process.env.GOOGLE_WORKLOAD_IDENTITY_PROVIDER,
      GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      GOOGLE_WORKSPACE_LOCAL_USER: process.env.GOOGLE_WORKSPACE_LOCAL_USER,
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
    },
    oidcToken: headerValue(request.headers["x-vercel-oidc-token"])
  });
  response.status(workerResponse.status);
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  response.json(await workerResponse.json());
}

function toHeaders(values: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(values)) {
    const normalized = headerValue(value);
    if (normalized) headers.set(key, normalized);
  }
  headers.set("Content-Type", "application/json");
  return headers;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(",") : value;
}
