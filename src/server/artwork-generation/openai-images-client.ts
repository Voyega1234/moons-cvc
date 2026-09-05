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

const OPENROUTER_IMAGES_ENDPOINT = "https://openrouter.ai/api/v1/images";
export const OPENAI_IMAGE_PROMPT_SAFE_CHARACTERS = 30_000;

function openRouterImageModel(model: string): string {
  return model.includes("/") ? model : `openai/${model}`;
}

export function fitOpenAIImagePrompt(prompt: string): string {
  if (prompt.length <= OPENAI_IMAGE_PROMPT_SAFE_CHARACTERS) return prompt;

  const marker =
    "\n\n[Lower-priority context was shortened to fit the image provider prompt limit. Preserve the core brief and final requirements.]\n\n";
  const available = OPENAI_IMAGE_PROMPT_SAFE_CHARACTERS - marker.length;
  const prefixLength = Math.floor(available * 0.64);
  const suffixLength = available - prefixLength;

  return `${prompt.slice(0, prefixLength).trimEnd()}${marker}${prompt
    .slice(prompt.length - suffixLength)
    .trimStart()}`.slice(0, OPENAI_IMAGE_PROMPT_SAFE_CHARACTERS);
}

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
  const response = await fetchImpl(OPENROUTER_IMAGES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: openRouterImageModel(model),
      prompt: fitOpenAIImagePrompt(prompt),
      size,
      quality,
      input_references: referenceImages.map((reference) => ({
        type: "image_url",
        image_url: {
          url: `data:${reference.mimeType};base64,${reference.bytes.toString(
            "base64"
          )}`
        }
      }))
    })
  });

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(
      readErrorMessage(payload) ?? `OpenRouter image edit failed: ${response.status}`
    );
  }

  return {
    base64: extractB64Json(payload),
    mimeType: "image/png"
  };
}

export type GptImageAspectRatio =
  | "1:1"
  | "3:2"
  | "2:3"
  | "4:3"
  | "3:4"
  | "16:9"
  | "9:16"
  | "21:9"
  | "auto";

const GPT_IMAGE_ASPECT_RATIO_VALUES: Record<
  Exclude<GptImageAspectRatio, "auto">,
  number
> = {
  "1:1": 1,
  "3:2": 3 / 2,
  "2:3": 2 / 3,
  "4:3": 4 / 3,
  "3:4": 3 / 4,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "21:9": 21 / 9
};

export function gptImageAspectRatioForOutputSize(
  size: ArtworkOutputSize
): GptImageAspectRatio {
  const [widthText, heightText] = size.split("x");
  const width = Number(widthText);
  const height = Number(heightText);
  const targetRatio = width / height;

  let closest: Exclude<GptImageAspectRatio, "auto"> = "1:1";
  let closestDiff = Infinity;
  for (const [ratio, value] of Object.entries(
    GPT_IMAGE_ASPECT_RATIO_VALUES
  ) as [Exclude<GptImageAspectRatio, "auto">, number][]) {
    const diff = Math.abs(value - targetRatio);
    if (diff < closestDiff) {
      closest = ratio;
      closestDiff = diff;
    }
  }
  return closest;
}

export interface EditImageWithAspectRatioOptions {
  apiKey: string;
  model: string;
  prompt: string;
  aspectRatio: GptImageAspectRatio;
  quality?: "auto" | "low" | "medium" | "high";
  referenceImages: readonly ReferenceImageInput[];
  fetchImpl: typeof fetch;
}

export async function editImageWithAspectRatio({
  apiKey,
  model,
  prompt,
  aspectRatio,
  quality = "high",
  referenceImages,
  fetchImpl
}: EditImageWithAspectRatioOptions): Promise<GeneratedImage> {
  const response = await fetchImpl(OPENROUTER_IMAGES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: openRouterImageModel(model),
      prompt: fitOpenAIImagePrompt(prompt),
      aspect_ratio: aspectRatio,
      quality,
      input_references: referenceImages.map((reference) => ({
        type: "image_url",
        image_url: {
          url: `data:${reference.mimeType};base64,${reference.bytes.toString(
            "base64"
          )}`
        }
      }))
    })
  });

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(
      readErrorMessage(payload) ?? `OpenRouter image edit failed: ${response.status}`
    );
  }

  return {
    base64: extractB64Json(payload),
    mimeType: "image/png"
  };
}

export async function generateImage({
  apiKey,
  model,
  prompt,
  size,
  fetchImpl
}: GenerateImageOptions): Promise<GeneratedImage> {
  const response = await fetchImpl(OPENROUTER_IMAGES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: openRouterImageModel(model),
      prompt: fitOpenAIImagePrompt(prompt),
      n: 1,
      size,
      quality: "medium"
    })
  });

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(
      readErrorMessage(payload) ?? `OpenRouter image generation failed: ${response.status}`
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

  throw new Error("OpenRouter image generation did not return image data.");
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error("OpenRouter image generation returned an empty response body.");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("OpenRouter image generation returned a non-JSON response.");
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
