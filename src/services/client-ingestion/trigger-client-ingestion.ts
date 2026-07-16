import { env } from "../../config/env";

export async function triggerClientIngestion({
  accessToken,
  fetchImpl = fetch,
  endpoint = env.clientIngestionTriggerEndpoint
}: {
  accessToken?: string;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers
    });
  } catch (error) {
    const detail = error instanceof Error && error.message
      ? ` (${error.message})`
      : "";
    throw new Error(
      `Could not reach the client ingestion API${detail}. For local development, start Neo with npm run dev:full.`
    );
  }
  const text = await response.text();
  const payload = parseResponse(text);

  if (!response.ok || payload.ok !== true) {
    throw new Error(
      payload.error ?? `Client ingestion could not start (${response.status}).`
    );
  }
}

function parseResponse(text: string): { ok?: boolean; error?: string } {
  if (!text.trim()) {
    return { error: "Client ingestion trigger returned an empty response." };
  }

  try {
    return JSON.parse(text) as { ok?: boolean; error?: string };
  } catch {
    return { error: "Client ingestion trigger returned a non-JSON response." };
  }
}
