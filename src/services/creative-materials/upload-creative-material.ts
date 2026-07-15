import { env } from "../../config/env";
import type { UploadedCreativeMaterial } from "../../domain/creative-run";
import {
  getSupabaseClient,
  isSupabaseConfigured
} from "../../lib/supabase/client";

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function uploadCreativeMaterial({
  runId,
  brandId,
  file
}: {
  runId: string;
  brandId?: string;
  file: File;
}): Promise<UploadedCreativeMaterial> {
  validateImage(file);
  const id = crypto.randomUUID();

  if (!isSupabaseConfigured()) {
    return {
      id,
      name: file.name,
      mediaType: file.type,
      role: "main-object",
      description: "",
      url: await readAsDataUrl(file)
    };
  }

  const client = getSupabaseClient();
  const storagePath = [
    safePathSegment(brandId ?? "unbranded"),
    "creative-materials",
    safePathSegment(runId),
    `${id}-${safeFileName(file.name)}`
  ].join("/");
  const upload = await client.storage.from(env.brandAssetsBucket).upload(
    storagePath,
    file,
    { contentType: file.type, upsert: false }
  );
  if (upload.error) throw upload.error;

  const signed = await client.storage
    .from(env.brandAssetsBucket)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRES_IN_SECONDS);
  if (signed.error) {
    await client.storage.from(env.brandAssetsBucket).remove([storagePath]);
    throw signed.error;
  }

  return {
    id,
    name: file.name,
    mediaType: file.type,
    role: "main-object",
    description: "",
    url: signed.data.signedUrl,
    storagePath,
    storageBucket: env.brandAssetsBucket
  };
}

function validateImage(file: File) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Upload a PNG, JPEG, or WEBP image.");
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error("Image is too large. Maximum upload size is 10MB.");
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function safeFileName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
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
