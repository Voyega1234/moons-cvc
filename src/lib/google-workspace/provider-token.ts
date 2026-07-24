import type { Session } from "@supabase/supabase-js";

const GOOGLE_PROVIDER_TOKEN_KEY = "creative-compass.google-provider-token";
const GOOGLE_PROVIDER_TOKEN_EXPIRES_AT_KEY =
  "creative-compass.google-provider-token-expires-at";
const GOOGLE_PROVIDER_TOKEN_TTL_MS = 55 * 60 * 1000;

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function captureGoogleProviderToken(
  session: Pick<Session, "provider_token"> | null,
  now = Date.now()
): void {
  const storage = browserStorage();
  if (!storage || !session?.provider_token) return;

  storage.setItem(GOOGLE_PROVIDER_TOKEN_KEY, session.provider_token);
  storage.setItem(
    GOOGLE_PROVIDER_TOKEN_EXPIRES_AT_KEY,
    String(now + GOOGLE_PROVIDER_TOKEN_TTL_MS)
  );
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

export function requireGoogleProviderToken(): string {
  const token = currentGoogleProviderToken();
  if (!token) {
    throw new Error(
      "Google access has expired. Sign out, then sign in with Google again."
    );
  }
  return token;
}
