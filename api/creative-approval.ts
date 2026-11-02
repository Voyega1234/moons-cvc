import { handleCreativeApprovalRequest } from "../src/server/google-sheets/creative-approval-endpoint.js";

export const config = { maxDuration: 300 };

export default async function handler(
  request: { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown },
  response: { status(code: number): unknown; setHeader(name: string, value: string): void; json(body: unknown): void }
) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
  const result = await handleCreativeApprovalRequest({
    request: new Request("https://moons.local/api/creative-approval", {
      method: request.method ?? "GET", headers,
      ...(request.method === "POST" ? { body: typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {}) } : {})
    }),
    env: {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      OPENROUTER_BRAND_ANALYSIS_MODEL: process.env.OPENROUTER_BRAND_ANALYSIS_MODEL,
      OPENROUTER_TERRA_MODEL: process.env.OPENROUTER_TERRA_MODEL
    }
  });
  response.status(result.status);
  response.setHeader("Cache-Control", "no-store");
  response.json(await result.json());
}
