import { get as httpsGet } from "node:https";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/database.types.js";
import type {
  ImageMirror,
  MirroredVisualAsset
} from "./client-ingestion-harness.js";

export interface SupabaseImageMirrorOptions {
  client: SupabaseClient<Database>;
  bucket?: string;
  fetchImpl?: ImageFetch;
  facebookCdnFetchImpl?: ImageFetch;
  signedUrlExpiresInSeconds?: number;
}

type ImageFetch = (imageUrl: string) => Promise<Response>;

const DEFAULT_BUCKET = "brand-source-assets";
const DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 20_000;

export class SupabaseImageMirror implements ImageMirror {
  private readonly bucket: string;
  private readonly fetchImpl: ImageFetch;
  private readonly facebookCdnFetchImpl: ImageFetch;
  private readonly signedUrlExpiresInSeconds: number;

  constructor({
    client,
    bucket = DEFAULT_BUCKET,
    fetchImpl = fetch,
    facebookCdnFetchImpl = fetchFacebookImageOverIpv4,
    signedUrlExpiresInSeconds = DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS
  }: SupabaseImageMirrorOptions) {
    this.client = client;
    this.bucket = bucket;
    this.fetchImpl = fetchImpl;
    this.facebookCdnFetchImpl = facebookCdnFetchImpl;
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
    const download = isFacebookCdnUrl(imageUrl)
      ? this.facebookCdnFetchImpl
      : this.fetchImpl;
    const response = await withTimeout(
      download(imageUrl),
      IMAGE_DOWNLOAD_TIMEOUT_MS,
      "Source image download timed out."
    );
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

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(resolve, reject).finally(() => clearTimeout(timeout));
  });
}

export function isFacebookCdnUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "fbcdn.net" || hostname.endsWith(".fbcdn.net");
  } catch {
    return false;
  }
}

function fetchFacebookImageOverIpv4(imageUrl: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = httpsGet(
      imageUrl,
      { family: 4 },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 500,
              headers: {
                "content-type": response.headers["content-type"] ?? ""
              }
            })
          );
        });
      }
    );

    request.setTimeout(IMAGE_DOWNLOAD_TIMEOUT_MS, () => {
      request.destroy(new Error("Facebook CDN image download timed out."));
    });
    request.on("error", reject);
  });
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
