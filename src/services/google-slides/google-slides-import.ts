import {
  clearGoogleProviderToken,
  requireGoogleProviderToken
} from "../../lib/google-workspace/provider-token";

const POWERPOINT_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const GOOGLE_SLIDES_MIME_TYPE = "application/vnd.google-apps.presentation";

export interface GoogleSlidesImportResult {
  id: string;
  name: string;
  url: string;
}

interface UploadPptxOptions {
  blob: Blob;
  name: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}

export async function requestGoogleDriveAccessToken(): Promise<string> {
  return requireGoogleProviderToken();
}

async function driveError(response: Response): Promise<Error> {
  if (response.status === 401) {
    clearGoogleProviderToken();
    return new Error(
      "Google access has expired. Sign out, then sign in with Google again."
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
  accessToken,
  fetchImpl = fetch
}: UploadPptxOptions): Promise<GoogleSlidesImportResult> {
  const normalizedName = name.replace(/\.pptx$/i, "").trim() || "Creative slides";
  const initialize = await fetchImpl(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": POWERPOINT_MIME_TYPE,
        "X-Upload-Content-Length": String(blob.size)
      },
      body: JSON.stringify({
        name: normalizedName,
        mimeType: GOOGLE_SLIDES_MIME_TYPE
      })
    }
  );

  if (!initialize.ok) throw await driveError(initialize);
  const uploadUrl = initialize.headers.get("Location");
  if (!uploadUrl) {
    throw new Error("Google Drive did not return an upload location.");
  }

  const uploaded = await fetchImpl(uploadUrl, {
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
    name: file.name || normalizedName,
    url:
      file.webViewLink ||
      `https://docs.google.com/presentation/d/${file.id}/edit`
  };
}
