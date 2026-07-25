import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from "node:crypto";
import {
  resolveConvertCakeAuthorization,
  type ConvertCakeAuthEnv
} from "../shared/convert-cake-auth.js";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const TOKEN_TABLE = "google_workspace_credentials";
const TOKEN_VERSION = "v1";

export interface GoogleProviderTokenEnv extends ConvertCakeAuthEnv {
  SUPABASE_SERVICE_ROLE_KEY?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_TOKEN_ENCRYPTION_KEY?: string;
}

interface HandleGoogleProviderTokenRequestOptions {
  request: Request;
  env: GoogleProviderTokenEnv;
  fetchImpl?: typeof fetch;
}

interface StoredCredential {
  encrypted_refresh_token?: unknown;
}

interface GoogleTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  error?: unknown;
  error_description?: unknown;
}

export async function handleGoogleProviderTokenRequest({
  request,
  env,
  fetchImpl = fetch
}: HandleGoogleProviderTokenRequestOptions): Promise<Response> {
  const configuration = readConfiguration(env);
  if (!configuration) {
    return jsonResponse(
      {
        ok: false,
        error: "Google access renewal is not configured on the server."
      },
      503
    );
  }

  const auth = await resolveConvertCakeAuthorization(request, env, fetchImpl);
  if (!auth.authorized || !auth.userId) {
    return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
  }

  if (request.method === "POST") {
    const refreshToken = await readRefreshToken(request);
    if (!refreshToken) {
      return jsonResponse(
        { ok: false, error: "A Google refresh token is required." },
        400
      );
    }

    const encryptedRefreshToken = encryptRefreshToken(
      refreshToken,
      configuration.encryptionKey
    );
    const stored = await storeCredential({
      supabaseUrl: configuration.supabaseUrl,
      serviceRoleKey: configuration.serviceRoleKey,
      userId: auth.userId,
      encryptedRefreshToken,
      fetchImpl
    });
    if (!stored) {
      return jsonResponse(
        { ok: false, error: "Could not save Google access renewal." },
        502
      );
    }
    return jsonResponse({ ok: true });
  }

  if (request.method === "GET") {
    const loadedCredential = await loadCredential({
      supabaseUrl: configuration.supabaseUrl,
      serviceRoleKey: configuration.serviceRoleKey,
      userId: auth.userId,
      fetchImpl
    });
    if (!loadedCredential.ok) {
      return jsonResponse(
        { ok: false, error: "Could not load saved Google access." },
        502
      );
    }
    const credential = loadedCredential.credential;
    if (!credential) {
      return jsonResponse(
        {
          ok: false,
          error:
            "Google access needs a one-time reconnect. Sign out and continue with Google once."
        },
        409
      );
    }

    let refreshToken: string;
    try {
      refreshToken = decryptRefreshToken(
        credential.encrypted_refresh_token,
        configuration.encryptionKey
      );
    } catch {
      return jsonResponse(
        { ok: false, error: "Stored Google access could not be read." },
        500
      );
    }

    const refreshed = await refreshGoogleAccessToken({
      refreshToken,
      clientId: configuration.clientId,
      clientSecret: configuration.clientSecret,
      fetchImpl
    });
    if (!refreshed.ok) {
      return jsonResponse(
        {
          ok: false,
          error:
            "Google access needs a one-time reconnect. Sign out and continue with Google once."
        },
        409
      );
    }

    return jsonResponse({
      ok: true,
      accessToken: refreshed.accessToken,
      expiresIn: refreshed.expiresIn
    });
  }

  return jsonResponse({ ok: false, error: "Method not allowed." }, 405, {
    Allow: "GET, POST"
  });
}

function readConfiguration(env: GoogleProviderTokenEnv): {
  supabaseUrl: string;
  serviceRoleKey: string;
  clientId: string;
  clientSecret: string;
  encryptionKey: Buffer;
} | null {
  const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const encodedEncryptionKey = env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim();
  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    !clientId ||
    !clientSecret ||
    !encodedEncryptionKey
  ) {
    return null;
  }

  const encryptionKey = Buffer.from(encodedEncryptionKey, "base64");
  if (encryptionKey.length !== 32) return null;

  return {
    supabaseUrl,
    serviceRoleKey,
    clientId,
    clientSecret,
    encryptionKey
  };
}

async function readRefreshToken(request: Request): Promise<string | null> {
  try {
    const body = (await request.json()) as unknown;
    if (!isRecord(body) || typeof body.refreshToken !== "string") return null;
    const refreshToken = body.refreshToken.trim();
    return refreshToken && refreshToken.length <= 8_192 ? refreshToken : null;
  } catch {
    return null;
  }
}

export function encryptRefreshToken(
  refreshToken: string,
  encryptionKey: Buffer
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(refreshToken, "utf8"),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();
  return [
    TOKEN_VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(".");
}

export function decryptRefreshToken(
  encryptedRefreshToken: unknown,
  encryptionKey: Buffer
): string {
  if (typeof encryptedRefreshToken !== "string") {
    throw new Error("Encrypted Google refresh token is invalid.");
  }
  const [version, encodedIv, encodedAuthTag, encodedCiphertext, ...extra] =
    encryptedRefreshToken.split(".");
  if (
    version !== TOKEN_VERSION ||
    !encodedIv ||
    !encodedAuthTag ||
    !encodedCiphertext ||
    extra.length
  ) {
    throw new Error("Encrypted Google refresh token is invalid.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey,
    Buffer.from(encodedIv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(encodedAuthTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

async function storeCredential({
  supabaseUrl,
  serviceRoleKey,
  userId,
  encryptedRefreshToken,
  fetchImpl
}: {
  supabaseUrl: string;
  serviceRoleKey: string;
  userId: string;
  encryptedRefreshToken: string;
  fetchImpl: typeof fetch;
}): Promise<boolean> {
  const response = await fetchImpl(
    `${supabaseUrl}/rest/v1/${TOKEN_TABLE}?on_conflict=user_id`,
    {
      method: "POST",
      headers: serviceRoleHeaders(serviceRoleKey, true),
      body: JSON.stringify({
        user_id: userId,
        encrypted_refresh_token: encryptedRefreshToken,
        updated_at: new Date().toISOString()
      })
    }
  );
  return response.ok;
}

async function loadCredential({
  supabaseUrl,
  serviceRoleKey,
  userId,
  fetchImpl
}: {
  supabaseUrl: string;
  serviceRoleKey: string;
  userId: string;
  fetchImpl: typeof fetch;
}): Promise<
  | { ok: true; credential: StoredCredential | null }
  | { ok: false }
> {
  const response = await fetchImpl(
    `${supabaseUrl}/rest/v1/${TOKEN_TABLE}?user_id=eq.${encodeURIComponent(userId)}&select=encrypted_refresh_token&limit=1`,
    { headers: serviceRoleHeaders(serviceRoleKey) }
  );
  if (!response.ok) return { ok: false };

  const rows = (await response.json()) as unknown;
  if (!Array.isArray(rows)) return { ok: false };
  return {
    ok: true,
    credential: isRecord(rows[0]) ? (rows[0] as StoredCredential) : null
  };
}

function serviceRoleHeaders(
  serviceRoleKey: string,
  write = false
): HeadersInit {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...(write
      ? {
          "Content-Type": "application/json",
          "Content-Profile": "moons",
          Prefer: "resolution=merge-duplicates"
        }
      : { "Accept-Profile": "moons" })
  };
}

async function refreshGoogleAccessToken({
  refreshToken,
  clientId,
  clientSecret,
  fetchImpl
}: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetchImpl: typeof fetch;
}): Promise<
  | { ok: true; accessToken: string; expiresIn: number }
  | { ok: false }
> {
  const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  if (!response.ok) return { ok: false };

  const body = (await response.json()) as GoogleTokenResponse;
  const accessToken =
    typeof body.access_token === "string" ? body.access_token.trim() : "";
  const expiresIn =
    typeof body.expires_in === "number" && Number.isFinite(body.expires_in)
      ? Math.max(60, Math.floor(body.expires_in))
      : 3_600;
  return accessToken
    ? { ok: true, accessToken, expiresIn }
    : { ok: false };
}

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: HeadersInit = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
