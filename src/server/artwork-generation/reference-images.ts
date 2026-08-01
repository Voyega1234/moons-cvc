import sharp from "sharp";
import type { ArtworkGenerationRequest } from "../../services/artwork-generation/openai-image-generation.js";
import type { ArtworkStorageClient } from "./artwork-generation-types.js";
import type { ReferenceImageInput } from "./openai-images-client.js";

type FetchLike = typeof fetch;

export interface StoredArtworkReference {
  image: ReferenceImageInput;
  signedUrl: string;
}
export async function resolveReferenceImages(
  referenceImages: ArtworkGenerationRequest["referenceImages"],
  fetchImpl: FetchLike,
  storage: ArtworkStorageClient,
  supabaseUrl: string
): Promise<readonly ReferenceImageInput[]> {
  const resolved = await Promise.all(
    referenceImages.map(async (reference) => {
      if (reference.kind === "url") {
        const response = await fetchImpl(reference.url);
        if (!response.ok) {
          const storedReference = await recoverSupabaseReferenceImage({
            url: reference.url,
            storage,
            supabaseUrl
          });
          if (storedReference) {
            return {
              ...storedReference,
              ...(reference.label ? { label: reference.label } : {})
            };
          }
          throw new Error(
            `Could not download reference image "${reference.label ?? "Untitled"}": ${response.status}`
          );
        }
        const mimeType =
          response.headers.get("content-type")?.split(";")[0]?.trim() ||
          reference.mediaType ||
          "image/png";
        return {
          bytes: Buffer.from(await response.arrayBuffer()),
          mimeType,
          ...(reference.label ? { label: reference.label } : {})
        };
      }

      if (reference.kind === "base64") {
        return {
          bytes: Buffer.from(reference.data, "base64"),
          mimeType: reference.mediaType,
          ...(reference.label ? { label: reference.label } : {})
        };
      }

      throw new Error(
        "Reference images from OpenAI file IDs are not supported yet."
      );
    })
  );

  return Promise.all(resolved.map(normalizeReferenceImageForOpenAI));
}

export async function normalizeReferenceImageForOpenAI(
  reference: ReferenceImageInput
): Promise<ReferenceImageInput> {
  const mimeType = reference.mimeType.toLowerCase();
  if (mimeType !== "image/jpeg" && mimeType !== "image/jpg") return reference;

  try {
    return {
      ...reference,
      bytes: await sharp(reference.bytes, { failOn: "error" })
        .rotate()
        .toColourspace("srgb")
        .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
        .toBuffer(),
      mimeType: "image/jpeg"
    };
  } catch {
    throw new Error(
      `Reference image "${reference.label ?? "Untitled"}" is not a valid JPEG. Re-export it as an RGB JPEG or PNG and try again.`
    );
  }
}

async function recoverSupabaseReferenceImage({
  url,
  storage,
  supabaseUrl
}: {
  url: string;
  storage: ArtworkStorageClient;
  supabaseUrl: string;
}): Promise<ReferenceImageInput | null> {
  const location = parseSupabaseSignedStorageUrl(url, supabaseUrl);
  if (!location) return null;

  const result = await storage.storage.from(location.bucket).download(location.path);
  if (result.error || !result.data) return null;

  return {
    bytes: Buffer.from(await result.data.arrayBuffer()),
    mimeType: result.data.type || "image/png"
  };
}

function parseSupabaseSignedStorageUrl(
  value: string,
  supabaseUrl: string
): { bucket: string; path: string } | null {
  try {
    const url = new URL(value);
    const projectUrl = new URL(supabaseUrl);
    const prefix = "/storage/v1/object/sign/";
    if (url.origin !== projectUrl.origin || !url.pathname.startsWith(prefix)) {
      return null;
    }

    const [bucket, ...pathParts] = url.pathname.slice(prefix.length).split("/");
    if (!bucket || !pathParts.length) return null;
    return {
      bucket: decodeURIComponent(bucket),
      path: pathParts.map((part) => decodeURIComponent(part)).join("/")
    };
  } catch {
    return null;
  }
}

