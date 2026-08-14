import { env } from "../../config/env";
import {
  getSupabaseClient,
  isSupabaseConfigured
} from "../../lib/supabase/client";

const POWERPOINT_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export interface GoogleSlidesImportResult {
  id: string;
  name: string;
  url: string;
}

interface UploadPptxOptions {
  blob: Blob;
  name: string;
  sessionToken?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

export async function requestGoogleWorkspaceSessionToken(): Promise<string> {
  if (!isSupabaseConfigured()) {
    throw new Error("Sign in before exporting to Google Slides.");
  }
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token?.trim();
  if (!token) throw new Error("Sign in before exporting to Google Slides.");
  return token;
}

async function driveError(response: Response): Promise<Error> {
  if (response.status === 401) {
    return new Error(
      "Your Creative Compass session expired. Sign in and try the export again."
    );
  }
  const fallback = `Google Drive returned ${response.status}.`;
  try {
    const body = (await response.json()) as {
      error?: { message?: string };
      message?: string;
    };
    return new Error(body.error?.message || body.message || fallback);
  } catch {
    return new Error(fallback);
  }
}

export async function uploadPptxToGoogleSlides({
  blob,
  name,
  sessionToken,
  endpoint = `${env.apiBaseUrl}/google-slides-upload-session`,
  fetchImpl = fetch
}: UploadPptxOptions): Promise<GoogleSlidesImportResult> {
  const normalizedName = name.replace(/\.pptx$/i, "").trim() || "Creative slides";
  const authorization = sessionToken ?? await requestGoogleWorkspaceSessionToken();
  const initialize = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authorization}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: normalizedName, size: blob.size })
  });

  if (!initialize.ok) throw await driveError(initialize);
  const session = await initialize.json() as {
    ok?: boolean;
    uploadUrl?: string;
    name?: string;
  };
  if (session.ok !== true || !session.uploadUrl) {
    throw new Error("Google Drive did not return an upload location.");
  }

  const uploaded = await fetchImpl(session.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": POWERPOINT_MIME_TYPE },
    body: blob
  });
  if (!uploaded.ok) throw await driveError(uploaded);

  const file = (await uploaded.json()) as {
    id?: string;
    name?: string;
    webViewLink?: string;
  };
  if (!file.id) throw new Error("Google Drive uploaded the deck without a file ID.");

  return {
    id: file.id,
    name: file.name || session.name || normalizedName,
    url:
      file.webViewLink ||
      `https://docs.google.com/presentation/d/${file.id}/edit`
  };
}
