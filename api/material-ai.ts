import { handleMaterialAi } from "../src/server/material-ai/material-ai-endpoint.js";

export const config = { maxDuration: 180 };
export default async function handler(request: { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown }, response: { status(code: number): unknown; setHeader(name: string, value: string): void; json(body: unknown): void }) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
  const result = await handleMaterialAi({
    request: new Request("https://moons.local/api/material-ai", { method: request.method ?? "GET", headers, body: request.method === "POST" ? typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {}) : undefined }),
    env: { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY, MATERIAL_AI_MODEL: process.env.MATERIAL_AI_MODEL, BRAND_ASSETS_BUCKET: process.env.BRAND_ASSETS_BUCKET || process.env.VITE_BRAND_ASSETS_BUCKET }
  });
  response.status(result.status); response.setHeader("Content-Type", "application/json"); response.json(await result.json());
}
