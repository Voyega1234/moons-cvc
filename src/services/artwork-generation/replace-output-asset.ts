import type { CreativeOutput } from "../../domain/creative-run";
import type { WorkflowState } from "../../features/workflow/model";
import { getSupabaseClient } from "../../lib/supabase/client";

const ARTWORK_BUCKET = "creative-assets";
const SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export interface ReplacementAsset {
  assetUrl: string;
  assetStoragePath: string;
  assetBucket: string;
}

export async function uploadReplacementAsset({
  run,
  output,
  file
}: {
  run: WorkflowState;
  output: CreativeOutput;
  file: File;
}): Promise<ReplacementAsset> {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new Error("Upload a PNG, JPEG, or WEBP image.");
  }

  const client = getSupabaseClient();
  const nextRevision = output.revisionCount + 1;
  const assetStoragePath = [
    safePathSegment(run.brand?.id ?? "unbranded"),
    safePathSegment(run.id),
    "outputs",
    `${safePathSegment(output.directionId)}-v${nextRevision}.${extensionFromMimeType(file.type)}`
  ].join("/");

  const uploadResult = await client.storage
    .from(ARTWORK_BUCKET)
    .upload(assetStoragePath, file, { contentType: file.type, upsert: true });
  if (uploadResult.error) throw uploadResult.error;

  const signedUrlResult = await client.storage
    .from(ARTWORK_BUCKET)
    .createSignedUrl(assetStoragePath, SIGNED_URL_EXPIRES_IN_SECONDS);
  if (signedUrlResult.error) throw signedUrlResult.error;

  return {
    assetUrl: signedUrlResult.data.signedUrl,
    assetStoragePath,
    assetBucket: ARTWORK_BUCKET
  };
}

function extensionFromMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    default:
      return "png";
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
