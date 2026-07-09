import {
  runClientIngestionWorkerOnce,
  type ClientIngestionWorkerEnv
} from "./client-ingestion-worker";

export interface ClientIngestionWorkerEndpointEnv
  extends ClientIngestionWorkerEnv {
  CLIENT_INGESTION_WORKER_TOKEN?: string;
}

export interface ClientIngestionWorkerEndpointOptions {
  request: Request;
  env: ClientIngestionWorkerEndpointEnv;
  fetchImpl?: typeof fetch;
  runWorkerOnce?: typeof runClientIngestionWorkerOnce;
}

export async function handleClientIngestionWorkerRequest({
  request,
  env,
  fetchImpl = fetch,
  runWorkerOnce = runClientIngestionWorkerOnce
}: ClientIngestionWorkerEndpointOptions): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse(
      {
        ok: false,
        error: "Method not allowed."
      },
      405
    );
  }

  if (!isAuthorized(request, env.CLIENT_INGESTION_WORKER_TOKEN)) {
    return jsonResponse(
      {
        ok: false,
        error: "Unauthorized."
      },
      401
    );
  }

  try {
    const result = await runWorkerOnce({ env, fetchImpl });

    return jsonResponse({
      ok: true,
      result
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: readableError(error)
      },
      500
    );
  }
}

function isAuthorized(request: Request, token: string | undefined): boolean {
  const expectedToken = token?.trim();
  if (!expectedToken) return true;

  const authorization = request.headers.get("authorization") ?? "";
  return authorization === `Bearer ${expectedToken}`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown worker error.";
}
