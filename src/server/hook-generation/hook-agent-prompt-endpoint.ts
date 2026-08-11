import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveConvertCakeAuthorization } from "../shared/convert-cake-auth.js";

export interface HookAgentPromptEndpointEnv {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

export async function handleHookAgentPromptRequest({
  request,
  env,
  fetchImpl = fetch
}: {
  request: Request;
  env: HookAgentPromptEndpointEnv;
  fetchImpl?: typeof fetch;
}): Promise<Response> {
  if (request.method !== "GET") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  const auth = await resolveConvertCakeAuthorization(request, env, fetchImpl);
  if (!auth.authorized) {
    return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
  }

  try {
    const prompt = await readFile(
      join(process.cwd(), "agent_prompt", "agent_hook.md"),
      "utf8"
    );
    return jsonResponse({ ok: true, prompt });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Hook Agent prompt could not be loaded."
      },
      500
    );
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
