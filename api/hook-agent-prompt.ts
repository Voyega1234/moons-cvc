import { handleHookAgentPromptRequest } from "../src/server/hook-generation/hook-agent-prompt-endpoint.js";

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
  const workerResponse = await handleHookAgentPromptRequest({
    request: new Request("https://moons.local/api/hook-agent-prompt", {
      method: request.method ?? "GET",
      headers: toHeaders(request.headers)
    }),
    env: {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
    }
  });

  response.status(workerResponse.status);
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  response.json(await workerResponse.json());
}

function toHeaders(
  headers: Record<string, string | string[] | undefined>
): Headers {
  const nextHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    const normalized = Array.isArray(value) ? value.join(",") : value;
    if (normalized) nextHeaders.set(key, normalized);
  }
  return nextHeaders;
}
