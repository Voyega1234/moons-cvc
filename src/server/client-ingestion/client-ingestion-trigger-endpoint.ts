import { resolveConvertCakeAuthorization } from "../shared/convert-cake-auth.js";
import {
  readRequiredClientIngestionWorkerEnv,
  runClientIngestionWorkerOnce,
  type ClientIngestionWorkerEnv
} from "./client-ingestion-worker.js";

export interface ClientIngestionTriggerEnv extends ClientIngestionWorkerEnv {
  SUPABASE_ANON_KEY?: string;
}

export interface ClientIngestionTriggerEndpointOptions {
  request: Request;
  env: ClientIngestionTriggerEnv;
  fetchImpl?: typeof fetch;
  runWorkerOnce?: typeof runClientIngestionWorkerOnce;
  scheduleWorker: (promise: Promise<unknown>) => void;
  onBackgroundError?: (error: unknown) => void;
}

export async function handleClientIngestionTriggerRequest({
  request,
  env,
  fetchImpl = fetch,
  runWorkerOnce = runClientIngestionWorkerOnce,
  scheduleWorker,
  onBackgroundError = (error) =>
    console.error("Client ingestion background task failed.", error)
}: ClientIngestionTriggerEndpointOptions): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_ANON_KEY?.trim()) {
    return jsonResponse(
      { ok: false, error: "Supabase auth configuration is required." },
      500
    );
  }

  const auth = await resolveConvertCakeAuthorization(request, env, fetchImpl);
  if (!auth.authorized) {
    return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
  }

  try {
    readRequiredClientIngestionWorkerEnv(env);
    const task = runWorkerOnce({ env, fetchImpl }).catch((error) => {
      onBackgroundError(error);
    });
    if (isLocalRequest(request)) {
      await task;
    } else {
      scheduleWorker(task);
    }

    return jsonResponse({ ok: true, status: "accepted" }, 202);
  } catch (error) {
    return jsonResponse({ ok: false, error: readableError(error) }, 500);
  }
}

function isLocalRequest(request: Request): boolean {
  const host = request.headers.get("host")?.trim().toLowerCase();
  const hostname = host
    ? host.replace(/^\[|\](?::\d+)?$|:\d+$/g, "")
    : new URL(request.url).hostname.toLowerCase();
  return ["localhost", "127.0.0.1", "::1"].includes(hostname);
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function readableError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unknown client ingestion trigger error.";
}
