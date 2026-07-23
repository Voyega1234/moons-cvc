const GOOGLE_IDENTITY_SCRIPT_URL = "https://accounts.google.com/gsi/client";
const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const POWERPOINT_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const GOOGLE_SLIDES_MIME_TYPE = "application/vnd.google-apps.presentation";

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GoogleTokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}

interface GoogleIdentityServices {
  accounts: {
    oauth2: {
      initTokenClient(options: {
        client_id: string;
        scope: string;
        callback: (response: GoogleTokenResponse) => void;
        error_callback?: (error: { type?: string }) => void;
      }): GoogleTokenClient;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

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

let identityScriptPromise: Promise<void> | null = null;
let cachedToken: { value: string; expiresAt: number } | null = null;

function loadGoogleIdentityServices(): Promise<void> {
  if (window.google?.accounts.oauth2) return Promise.resolve();
  if (identityScriptPromise) return identityScriptPromise;

  identityScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GOOGLE_IDENTITY_SCRIPT_URL}"]`
    );
    const script = existing ?? document.createElement("script");

    const handleLoad = () => {
      if (window.google?.accounts.oauth2) {
        resolve();
      } else {
        identityScriptPromise = null;
        reject(new Error("Google sign-in loaded without the OAuth client."));
      }
    };
    const handleError = () => {
      identityScriptPromise = null;
      reject(new Error("Could not load Google sign-in. Check your connection."));
    };

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });
    if (!existing) {
      script.src = GOOGLE_IDENTITY_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });

  return identityScriptPromise;
}

export async function requestGoogleDriveAccessToken(
  clientId: string
): Promise<string> {
  const normalizedClientId = clientId.trim();
  if (!normalizedClientId) {
    throw new Error(
      "Google Slides export is not configured. Add VITE_GOOGLE_OAUTH_CLIENT_ID and redeploy."
    );
  }

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  await loadGoogleIdentityServices();
  const oauth = window.google?.accounts.oauth2;
  if (!oauth) throw new Error("Google OAuth is unavailable in this browser.");

  return new Promise((resolve, reject) => {
    const tokenClient = oauth.initTokenClient({
      client_id: normalizedClientId,
      scope: GOOGLE_DRIVE_FILE_SCOPE,
      callback: (response) => {
        if (!response.access_token) {
          reject(
            new Error(
              response.error_description ||
                response.error ||
                "Google authorization did not return an access token."
            )
          );
          return;
        }
        const expiresInSeconds = Math.max(0, response.expires_in ?? 3600);
        cachedToken = {
          value: response.access_token,
          expiresAt: Date.now() + expiresInSeconds * 1000
        };
        resolve(response.access_token);
      },
      error_callback: (error) => {
        reject(
          new Error(
            error.type === "popup_closed"
              ? "Google authorization was closed before it finished."
              : "Could not authorize Google Drive access."
          )
        );
      }
    });
    tokenClient.requestAccessToken();
  });
}

async function driveError(response: Response): Promise<Error> {
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
