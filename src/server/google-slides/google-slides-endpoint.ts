import { resolveConvertCakeAuthorization } from "../shared/convert-cake-auth.js";
import {
  createGoogleDriveAccessToken,
  type GoogleWorkspaceAuthEnv
} from "../google-sheets/google-workspace-auth.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const POWERPOINT_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const GOOGLE_SLIDES_MIME_TYPE = "application/vnd.google-apps.presentation";
const GENERATED_MARKER = "moons-google-slides";
const SHARING_DOMAIN = "convertcake.com";

export interface GoogleSlidesEndpointEnv extends GoogleWorkspaceAuthEnv {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  GOOGLE_WORKSPACE_LOCAL_USER?: string;
  GOOGLE_SLIDES_FOLDER_ID?: string;
}

export interface GoogleSlidesEndpointOptions {
  request: Request;
  env: GoogleSlidesEndpointEnv;
  oidcToken?: string;
  fetchImpl?: typeof fetch;
  createDriveAccessToken?: typeof createGoogleDriveAccessToken;
}

export async function handleGoogleSlidesRequest({
  request,
  env,
  oidcToken,
  fetchImpl = fetch,
  createDriveAccessToken = createGoogleDriveAccessToken
}: GoogleSlidesEndpointOptions): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  try {
    if (
      isVercelDeployment(env.VERCEL_ENV) &&
      (!env.SUPABASE_URL?.trim() || !env.SUPABASE_ANON_KEY?.trim())
    ) {
      throw new Error("Supabase auth configuration is required.");
    }
    const auth = await resolveConvertCakeAuthorization(request, env, fetchImpl);
    if (!auth.authorized) {
      return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
    }

    const body = await requestJson(request);
    const folderId = required(env.GOOGLE_SLIDES_FOLDER_ID, "GOOGLE_SLIDES_FOLDER_ID");
    const accessToken = await createDriveAccessToken({
      env,
      oidcToken,
      fetchImpl
    });

    if (body.action === "initialize") {
      return await initializeUpload({
        accessToken,
        folderId,
        name: readName(body.name),
        size: readSize(body.size),
        origin: request.headers.get("Origin")?.trim() || undefined,
        fetchImpl
      });
    }
    if (body.action === "share") {
      return await shareUploadedDeck({
        accessToken,
        folderId,
        fileId: readFileId(body.fileId),
        fetchImpl
      });
    }

    return jsonResponse({ ok: false, error: "Unknown Google Slides action." }, 400);
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Google Slides export failed."
      },
      500
    );
  }
}

async function initializeUpload({
  accessToken,
  folderId,
  name,
  size,
  origin,
  fetchImpl
}: {
  accessToken: string;
  folderId: string;
  name: string;
  size: number;
  origin?: string;
  fetchImpl: typeof fetch;
}): Promise<Response> {
  const params = new URLSearchParams({
    uploadType: "resumable",
    supportsAllDrives: "true",
    fields: "id,name,mimeType,webViewLink,parents,appProperties"
  });
  const response = await fetchImpl(`${DRIVE_UPLOAD_API}/files?${params}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": POWERPOINT_MIME_TYPE,
      "X-Upload-Content-Length": String(size),
      ...(origin ? { Origin: origin } : {})
    },
    body: JSON.stringify({
      name,
      mimeType: GOOGLE_SLIDES_MIME_TYPE,
      parents: [folderId],
      appProperties: { generatedBy: GENERATED_MARKER }
    })
  });
  if (!response.ok) throw await googleError(response, "Could not start Google Slides upload.");
  const uploadUrl = response.headers.get("Location")?.trim();
  if (!uploadUrl) throw new Error("Google Drive did not return an upload location.");
  return jsonResponse({ ok: true, uploadUrl });
}

async function shareUploadedDeck({
  accessToken,
  folderId,
  fileId,
  fetchImpl
}: {
  accessToken: string;
  folderId: string;
  fileId: string;
  fetchImpl: typeof fetch;
}): Promise<Response> {
  const fields = "id,name,mimeType,webViewLink,parents,appProperties";
  const fileResponse = await fetchImpl(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=${encodeURIComponent(fields)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!fileResponse.ok) throw await googleError(fileResponse, "Could not verify Google Slides upload.");
  const file = await jsonRecord(fileResponse, "Google Drive file lookup");
  const parents = Array.isArray(file.parents) ? file.parents : [];
  const appProperties = isRecord(file.appProperties) ? file.appProperties : {};
  if (
    file.mimeType !== GOOGLE_SLIDES_MIME_TYPE ||
    !parents.includes(folderId) ||
    appProperties.generatedBy !== GENERATED_MARKER
  ) {
    throw new Error("Google Slides file is outside the configured export folder.");
  }

  const permissionResponse = await fetchImpl(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true&sendNotificationEmail=false&fields=id`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: "domain",
        role: "writer",
        domain: SHARING_DOMAIN,
        allowFileDiscovery: false
      })
    }
  );
  if (!permissionResponse.ok) throw await googleError(permissionResponse, "Could not share Google Slides.");

  const name = typeof file.name === "string" && file.name.trim()
    ? file.name.trim()
    : "Creative slides";
  const webViewLink = typeof file.webViewLink === "string" && file.webViewLink.trim()
    ? file.webViewLink.trim()
    : `https://docs.google.com/presentation/d/${fileId}/edit`;
  return jsonResponse({ ok: true, id: fileId, name, url: webViewLink });
}

async function requestJson(request: Request): Promise<Record<string, unknown>> {
  const value = (await request.json()) as unknown;
  if (!isRecord(value)) throw new Error("Google Slides request must be a JSON object.");
  return value;
}

function readName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Google Slides name is required.");
  const name = value.replace(/\.pptx$/i, "").trim();
  if (!name) throw new Error("Google Slides name is required.");
  return name.slice(0, 180);
}

function readSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Google Slides upload size must be a positive integer.");
  }
  return value;
}

function readFileId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{10,}$/.test(value.trim())) {
    throw new Error("Google Slides file ID is invalid.");
  }
  return value.trim();
}

function isVercelDeployment(value: string | undefined): boolean {
  const environment = value?.trim().toLowerCase();
  return environment === "production" || environment === "preview";
}

async function googleError(response: Response, fallback: string): Promise<Error> {
  try {
    const payload = (await response.json()) as unknown;
    if (
      isRecord(payload) &&
      isRecord(payload.error) &&
      typeof payload.error.message === "string" &&
      payload.error.message.trim()
    ) {
      return new Error(payload.error.message.trim());
    }
  } catch {
    // Use the stable product-facing fallback below.
  }
  return new Error(fallback);
}

async function jsonRecord(response: Response, label: string): Promise<Record<string, unknown>> {
  const value = (await response.json()) as unknown;
  if (!isRecord(value)) throw new Error(`${label} returned invalid JSON.`);
  return value;
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
