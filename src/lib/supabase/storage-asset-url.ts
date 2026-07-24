import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export interface SupabaseStorageLocation {
  bucket: string;
  path: string;
}

const SIGNED_OBJECT_PREFIX = "/storage/v1/object/sign/";
const DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
const REFRESH_EARLY_SECONDS = 5 * 60;
const refreshedUrlCache = new Map<
  string,
  { url: string; refreshAfter: number }
>();

export function parseSupabaseSignedStorageUrl(
  value: string
): SupabaseStorageLocation | null {
  try {
    const url = new URL(value);
    const prefixIndex = url.pathname.indexOf(SIGNED_OBJECT_PREFIX);
    if (prefixIndex < 0) return null;

    const location = url.pathname.slice(
      prefixIndex + SIGNED_OBJECT_PREFIX.length
    );
    const separatorIndex = location.indexOf("/");
    if (separatorIndex <= 0 || separatorIndex === location.length - 1) {
      return null;
    }

    return {
      bucket: decodeURIComponent(location.slice(0, separatorIndex)),
      path: decodeURIComponent(location.slice(separatorIndex + 1))
    };
  } catch {
    return null;
  }
}

export async function refreshSupabaseSignedAssetUrl(
  client: SupabaseClient<Database>,
  value: string,
  expiresInSeconds = DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS
): Promise<string> {
  const location = parseSupabaseSignedStorageUrl(value);
  if (!location) return value;

  const now = Date.now();
  const existingExpiry = signedUrlExpiry(value);
  if (existingExpiry && existingExpiry - REFRESH_EARLY_SECONDS * 1000 > now) {
    return value;
  }

  const cacheKey = `${location.bucket}/${location.path}`;
  const cached = refreshedUrlCache.get(cacheKey);
  if (cached && cached.refreshAfter > now) return cached.url;

  try {
    const { data, error } = await client.storage
      .from(location.bucket)
      .createSignedUrl(location.path, expiresInSeconds);
    if (error || !data?.signedUrl) return value;
    refreshedUrlCache.set(cacheKey, {
      url: data.signedUrl,
      refreshAfter:
        now + Math.max(0, expiresInSeconds - REFRESH_EARLY_SECONDS) * 1000
    });
    return data.signedUrl;
  } catch {
    return value;
  }
}

function signedUrlExpiry(value: string): number | null {
  try {
    const token = new URL(value).searchParams.get("token");
    const payload = token?.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof decoded.exp === "number" ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}
