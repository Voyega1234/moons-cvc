import {
  resolveConvertCakeAuthorization,
  type ConvertCakeAuthEnv
} from "../shared/convert-cake-auth.js";

const DEFAULT_WEBHOOK_URL =
  "https://n8n.srv934175.hstgr.cloud/webhook-test/n8n-compass-new";

export interface N8nCompassNewEnv extends ConvertCakeAuthEnv {
  N8N_COMPASS_NEW_WEBHOOK_URL?: string;
}

export async function handleN8nCompassNewRequest({
  request,
  env,
  fetchImpl = fetch
}: {
  request: Request;
  env: N8nCompassNewEnv;
  fetchImpl?: typeof fetch;
}): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const auth = await resolveConvertCakeAuthorization(request, env, fetchImpl);
  if (!auth.authorized) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON." }, 400);
  }

  const webhookUrl =
    env.N8N_COMPASS_NEW_WEBHOOK_URL?.trim() || DEFAULT_WEBHOOK_URL;

  try {
    const upstream = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await upstream.text();

    return new Response(body, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") || "application/json"
      }
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse(
      { error: `Could not reach n8n Compass New webhook: ${detail}` },
      502
    );
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
