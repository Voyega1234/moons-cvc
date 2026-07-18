import type { ArtworkOutputSize } from "../../domain/creative-run.js";

export interface GeneratedImage {
  base64: string;
  mimeType: string;
}

export interface GenerateImageOptions {
  apiKey: string;
  model: string;
  prompt: string;
  size: ArtworkOutputSize;
  fetchImpl: typeof fetch;
}

const OPENAI_IMAGES_GENERATIONS_ENDPOINT =
  "https://api.openai.com/v1/images/generations";
const OPENAI_IMAGES_EDITS_ENDPOINT = "https://api.openai.com/v1/images/edits";

export interface ReferenceImageInput {
  bytes: Buffer;
  mimeType: string;
  label?: string;
}

export interface EditImageOptions {
  apiKey: string;
  model: string;
  prompt: string;
  size: ArtworkOutputSize;
  quality?: "low" | "medium" | "high" | "auto";
  referenceImages: readonly ReferenceImageInput[];
  fetchImpl: typeof fetch;
}

export async function editImage({
  apiKey,
  model,
  prompt,
  size,
  quality = "medium",
  referenceImages,
  fetchImpl
}: EditImageOptions): Promise<GeneratedImage> {
  const form = new FormData();
  form.set("model", model);
  form.set("prompt", prompt);
  form.set("size", size);
  form.set("quality", quality);

  referenceImages.forEach((reference, index) => {
    const blob = new Blob([reference.bytes as unknown as BlobPart], {
      type: reference.mimeType
    });
    form.append(
      "image[]",
      blob,
      `reference-${index}.${extensionFromMimeType(reference.mimeType)}`
    );
  });

  const response = await fetchImpl(OPENAI_IMAGES_EDITS_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(
      readErrorMessage(payload) ?? `OpenAI image edit failed: ${response.status}`
    );
  }

  return {
    base64: extractB64Json(payload),
    mimeType: "image/png"
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

export async function generateImage({
  apiKey,
  model,
  prompt,
  size,
  fetchImpl
}: GenerateImageOptions): Promise<GeneratedImage> {
  const response = await fetchImpl(OPENAI_IMAGES_GENERATIONS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size,
      quality: "medium"
    })
  });

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(
      readErrorMessage(payload) ?? `OpenAI image generation failed: ${response.status}`
    );
  }

  return {
    base64: extractB64Json(payload),
    mimeType: "image/png"
  };
}

function extractB64Json(payload: unknown): string {
  if (isRecord(payload) && Array.isArray(payload.data)) {
    const first = payload.data[0];
    if (isRecord(first) && typeof first.b64_json === "string") {
      return first.b64_json;
    }
  }

  throw new Error("OpenAI image generation did not return image data.");
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error("OpenAI image generation returned an empty response body.");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("OpenAI image generation returned a non-JSON response.");
  }
}

function readErrorMessage(payload: unknown): string | null {
  if (
    isRecord(payload) &&
    isRecord(payload.error) &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
