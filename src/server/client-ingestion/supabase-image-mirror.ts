import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/database.types";
import type {
  ImageMirror,
  MirroredVisualAsset
} from "./client-ingestion-harness";

export interface SupabaseImageMirrorOptions {
  client: SupabaseClient<Database>;
  bucket?: string;
  fetchImpl?: typeof fetch;
  signedUrlExpiresInSeconds?: number;
}

const DEFAULT_BUCKET = "brand-source-assets";
const DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;

export class SupabaseImageMirror implements ImageMirror {
  private readonly bucket: string;
  private readonly fetchImpl: typeof fetch;
  private readonly signedUrlExpiresInSeconds: number;

  constructor({
    client,
    bucket = DEFAULT_BUCKET,
    fetchImpl = fetch,
    signedUrlExpiresInSeconds = DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS
  }: SupabaseImageMirrorOptions) {
    this.client = client;
    this.bucket = bucket;
    this.fetchImpl = fetchImpl;
    this.signedUrlExpiresInSeconds = signedUrlExpiresInSeconds;
  }

  private readonly client: SupabaseClient<Database>;

  async mirror({
    clientId,
    jobId,
    sourceType,
    sourceItemId,
    index,
    imageUrl
  }: Parameters<ImageMirror["mirror"]>[0]): Promise<MirroredVisualAsset> {
    const response = await this.fetchImpl(imageUrl);
    if (!response.ok) {
      throw new Error(`Could not download source image: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("image/")) {
      throw new Error("Source asset is not an image.");
    }

    const blob = await response.blob();
    const originalUrlHash = await hashOriginalUrl(imageUrl);
    const assetStoragePath = buildStoragePath({
      clientId,
      jobId,
      sourceType,
      sourceItemId,
      index,
      originalUrlHash,
      extension: extensionFromMimeType(contentType)
    });

    const uploadResult = await this.client.storage
      .from(this.bucket)
      .upload(assetStoragePath, blob, {
        contentType,
        upsert: true
      });

    if (uploadResult.error) throw uploadResult.error;

    const signedUrlResult = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(assetStoragePath, this.signedUrlExpiresInSeconds);

    if (signedUrlResult.error) throw signedUrlResult.error;

    return {
      assetBucket: this.bucket,
      assetStoragePath,
      assetUrl: signedUrlResult.data.signedUrl,
      originalUrlHash
    };
  }
}

export function buildStoragePath({
  clientId,
  jobId,
  sourceType,
  sourceItemId,
  index,
  originalUrlHash,
  extension
}: {
  clientId: string;
  jobId: string;
  sourceType: string;
  sourceItemId: string | null;
  index: number;
  originalUrlHash: string;
  extension: string;
}): string {
  return [
    safePathSegment(clientId),
    safePathSegment(jobId),
    safePathSegment(sourceType),
    `${safePathSegment(sourceItemId ?? "asset")}-${index}-${originalUrlHash}.${extension}`
  ].join("/");
}

export async function hashOriginalUrl(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function extensionFromMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase().split(";")[0]?.trim();
  switch (normalized) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "img";
  }
}

function safePathSegment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9._-]+/g, "-")
      .replaceAll(/-+/g, "-")
      .replaceAll(/^-|-$/g, "")
      .slice(0, 80) || "unknown"
  );
}
