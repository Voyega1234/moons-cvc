import { resolveConvertCakeAuthorization } from "../shared/convert-cake-auth.js";
import {
  createGoogleWorkspaceAccessToken,
  GOOGLE_DRIVE_FILE_SCOPE,
  type GoogleWorkspaceAuthEnv
} from "../google-sheets/google-workspace-auth.js";

const POWERPOINT_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const GOOGLE_SLIDES_MIME_TYPE = "application/vnd.google-apps.presentation";

export interface GoogleSlidesUploadSessionEnv extends GoogleWorkspaceAuthEnv {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  GOOGLE_WORKSPACE_LOCAL_USER?: string;
}

export async function handleGoogleSlidesUploadSessionRequest({
  request,
  env,
  oidcToken,
  fetchImpl = fetch
}: {
  request: Request;
  env: GoogleSlidesUploadSessionEnv;
  oidcToken?: string;
  fetchImpl?: typeof fetch;
}): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  try {
    const auth = await resolveConvertCakeAuthorization(request, env, fetchImpl);
    if (!auth.authorized) {
      return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
    }
    const input = await request.json() as { name?: unknown; size?: unknown };
    const name =
      typeof input.name === "string"
        ? input.name.replace(/\.pptx$/i, "").trim()
        : "";
    const size = typeof input.size === "number" ? input.size : NaN;
    if (!name || !Number.isSafeInteger(size) || size <= 0) {
      return jsonResponse({ ok: false, error: "Slide upload metadata is invalid." }, 400);
    }

    const accessToken = await createGoogleWorkspaceAccessToken({
      env,
      subjectEmail: resolveSubjectEmail(auth.email, env),
      scopes: [GOOGLE_DRIVE_FILE_SCOPE],
      oidcToken,
      fetchImpl
    });
    const googleResponse = await fetchImpl(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": POWERPOINT_MIME_TYPE,
          "X-Upload-Content-Length": String(size)
        },
        body: JSON.stringify({ name, mimeType: GOOGLE_SLIDES_MIME_TYPE })
      }
    );
    if (!googleResponse.ok) {
      return jsonResponse(
        { ok: false, error: await googleError(googleResponse) },
        googleResponse.status
      );
    }
    const uploadUrl = googleResponse.headers.get("Location");
    if (!uploadUrl) {
      return jsonResponse(
        { ok: false, error: "Google Drive did not return an upload location." },
        502
      );
    }
    return jsonResponse({ ok: true, uploadUrl, name });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Could not start the Google Slides upload."
      },
      500
    );
  }
}

function resolveSubjectEmail(
  authenticatedEmail: string | null,
  env: GoogleSlidesUploadSessionEnv
): string {
  const email = authenticatedEmail ?? env.GOOGLE_WORKSPACE_LOCAL_USER;
  if (!email?.trim()) throw new Error("Authenticated user email is required.");
  return email;
}

async function googleError(response: Response): Promise<string> {
  try {
    const body = await response.json() as {
      error?: { message?: string };
      message?: string;
    };
    return body.error?.message || body.message || `Google Drive returned ${response.status}.`;
  } catch {
    return `Google Drive returned ${response.status}.`;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
