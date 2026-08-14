import type { Session } from "@supabase/supabase-js";
import { env } from "../../config/env";
import { getSupabaseClient } from "../supabase/client";

const GOOGLE_PROVIDER_TOKEN_KEY = "creative-compass.google-provider-token";
const GOOGLE_PROVIDER_TOKEN_EXPIRES_AT_KEY =
  "creative-compass.google-provider-token-expires-at";
const GOOGLE_PROVIDER_TOKEN_TTL_MS = 55 * 60 * 1000;
const GOOGLE_PROVIDER_TOKEN_ENDPOINT = `${env.apiBaseUrl}/google-provider-token`;
const PROVIDER_TOKEN_MAX_ATTEMPTS = 2;

interface GoogleProviderTokenPayload {
  ok?: unknown;
  accessToken?: unknown;
  expiresIn?: unknown;
  error?: unknown;
}

let refreshPromise: Promise<string> | null = null;

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function captureGoogleProviderToken(
  session: Pick<Session, "provider_token"> | null,
  now = Date.now()
): void {
  if (!session?.provider_token) return;
  storeGoogleProviderToken(
    session.provider_token,
    GOOGLE_PROVIDER_TOKEN_TTL_MS,
    now
  );
}

export async function cacheGoogleProviderRefreshToken(
  session: Pick<Session, "access_token" | "provider_refresh_token"> | null,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const accessToken = session?.access_token?.trim();
  const refreshToken = session?.provider_refresh_token?.trim();
  if (!accessToken || !refreshToken) return;

  const response = await fetchProviderToken(fetchImpl, {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ refreshToken })
  });
  if (!response.ok) {
    throw new Error(await providerTokenError(response));
  }
}

export function clearGoogleProviderToken(): void {
  const storage = browserStorage();
  if (!storage) return;
  storage.removeItem(GOOGLE_PROVIDER_TOKEN_KEY);
  storage.removeItem(GOOGLE_PROVIDER_TOKEN_EXPIRES_AT_KEY);
}

export function currentGoogleProviderToken(now = Date.now()): string | null {
  const storage = browserStorage();
  if (!storage) return null;

  const token = storage.getItem(GOOGLE_PROVIDER_TOKEN_KEY)?.trim();
  const expiresAt = Number(
    storage.getItem(GOOGLE_PROVIDER_TOKEN_EXPIRES_AT_KEY)
  );
  if (!token || !Number.isFinite(expiresAt) || expiresAt <= now) {
    clearGoogleProviderToken();
    return null;
  }
  return token;
}

export async function requireGoogleProviderToken(
  fetchImpl: typeof fetch = fetch,
  accessTokenProvider: () => Promise<string | null> =
    currentSupabaseAccessToken
): Promise<string> {
  const token = currentGoogleProviderToken();
  if (token) return token;
  if (refreshPromise) return refreshPromise;

  refreshPromise = refreshGoogleProviderToken(fetchImpl, accessTokenProvider);
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function refreshGoogleProviderToken(
  fetchImpl: typeof fetch,
  accessTokenProvider: () => Promise<string | null>
): Promise<string> {
  const accessToken = await accessTokenProvider();
  if (!accessToken) {
    throw new Error("Your Creative Compass session has expired. Sign in again.");
  }

  const response = await fetchProviderToken(fetchImpl, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const payload = await readProviderTokenPayload(response);
  if (
    !response.ok ||
    payload.ok !== true ||
    typeof payload.accessToken !== "string" ||
    !payload.accessToken.trim()
  ) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : response.ok
          ? "Could not renew Google access."
          : "Google Workspace access could not be authorized."
    );
  }

  const expiresIn =
    typeof payload.expiresIn === "number" &&
    Number.isFinite(payload.expiresIn)
      ? Math.max(60, payload.expiresIn)
      : 3_600;
  const cacheTtlMs = Math.max(
    30_000,
    Math.min(GOOGLE_PROVIDER_TOKEN_TTL_MS, expiresIn * 1_000 - 5 * 60 * 1_000)
  );
  storeGoogleProviderToken(payload.accessToken.trim(), cacheTtlMs);
  return payload.accessToken.trim();
}

function storeGoogleProviderToken(
  token: string,
  ttlMs: number,
  now = Date.now()
): void {
  const storage = browserStorage();
  if (!storage) return;
  storage.setItem(GOOGLE_PROVIDER_TOKEN_KEY, token);
  storage.setItem(
    GOOGLE_PROVIDER_TOKEN_EXPIRES_AT_KEY,
    String(now + ttlMs)
  );
}

async function currentSupabaseAccessToken(): Promise<string | null> {
  const {
    data: { session },
    error
  } = await getSupabaseClient().auth.getSession();
  if (error) throw error;
  return session?.access_token ?? null;
}

async function fetchProviderToken(
  fetchImpl: typeof fetch,
  init: RequestInit
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < PROVIDER_TOKEN_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(GOOGLE_PROVIDER_TOKEN_ENDPOINT, init);
      if (!isTransientStatus(response.status) || attempt === PROVIDER_TOKEN_MAX_ATTEMPTS - 1) {
        return response;
      }
    } catch (caught) {
      lastError = caught;
      if (attempt === PROVIDER_TOKEN_MAX_ATTEMPTS - 1) throw caught;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Google access renewal failed.");
}

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function providerTokenError(response: Response): Promise<string> {
  const payload = await readProviderTokenPayload(response);
  return typeof payload.error === "string"
    ? payload.error
    : "Could not save Google access renewal.";
}

async function readProviderTokenPayload(
  response: Response
): Promise<GoogleProviderTokenPayload> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    const payload = JSON.parse(text) as unknown;
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as GoogleProviderTokenPayload)
      : {};
  } catch {
    return {};
  }
}
