import { env } from "../../config/env";
import { getSupabaseClient, isSupabaseConfigured } from "../../lib/supabase/client";

const POWERPOINT_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const GOOGLE_SLIDES_ENDPOINT = `${env.apiBaseUrl}/google-slides`;

export interface GoogleSlidesImportResult {
  id: string;
  name: string;
  url: string;
}

interface UploadPptxOptions {
  blob: Blob;
  name: string;
  fetchImpl?: typeof fetch;
  accessTokenProvider?: () => Promise<string | null>;
  endpoint?: string;
}

interface SlidesEndpointPayload {
  ok?: unknown;
  uploadUrl?: unknown;
  id?: unknown;
  name?: unknown;
  url?: unknown;
  error?: unknown;
}

export async function uploadPptxToGoogleSlides({
  blob,
  name,
  fetchImpl = fetch,
  accessTokenProvider = currentSupabaseAccessToken,
  endpoint = GOOGLE_SLIDES_ENDPOINT
}: UploadPptxOptions): Promise<GoogleSlidesImportResult> {
  const normalizedName = name.replace(/\.pptx$/i, "").trim() || "Creative slides";
  const accessToken = await accessTokenProvider();
  const headers = requestHeaders(accessToken);
  const initialize = await fetchImpl(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "initialize",
      name: normalizedName,
      size: blob.size
    })
  });
  const initialized = await endpointPayload(initialize);
  if (!initialize.ok || initialized.ok !== true || typeof initialized.uploadUrl !== "string") {
    throw new Error(endpointError(initialized, "Could not start Google Slides upload."));
  }

  const uploaded = await fetchImpl(initialized.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": POWERPOINT_MIME_TYPE },
    body: blob
  });
  const file = await endpointPayload(uploaded);
  if (!uploaded.ok || typeof file.id !== "string" || !file.id.trim()) {
    throw new Error(endpointError(file, "Google Drive did not return a file ID."));
  }

  const shared = await fetchImpl(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "share", fileId: file.id.trim() })
  });
  const result = await endpointPayload(shared);
  if (
    !shared.ok ||
    result.ok !== true ||
    typeof result.id !== "string" ||
    typeof result.name !== "string" ||
    typeof result.url !== "string"
  ) {
    throw new Error(endpointError(result, "Could not share Google Slides."));
  }

  return { id: result.id, name: result.name, url: result.url };
}

async function currentSupabaseAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw error;
  return data.session?.access_token ?? null;
}

function requestHeaders(accessToken: string | null): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
  };
}

async function endpointPayload(response: Response): Promise<SlidesEndpointPayload> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as SlidesEndpointPayload)
      : {};
  } catch {
    return {};
  }
}

function endpointError(payload: SlidesEndpointPayload, fallback: string): string {
  if (typeof payload.error === "string" && payload.error.trim()) {
    return payload.error.trim();
  }
  if (
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string" &&
    payload.error.message.trim()
  ) {
    return payload.error.message.trim();
  }
  return fallback;
}
