import { StructuredOutputError } from "../shared/structured-output.js";
import type { ReferenceImageInput } from "./openai-images-client.js";

// Retry and model failover belong to the caller's single-image operation.
export async function generateGeminiImage({
  apiKey, model, prompt, aspect_ratio = "1:1", resolution = "2K", referenceImages = [], fetchImpl
}: {
  apiKey: string;
  model: string;
  prompt: string;
  aspect_ratio?: string;
  resolution?: string;
  referenceImages?: readonly ReferenceImageInput[];
  fetchImpl: typeof fetch;
}): Promise<{ base64: string }> {
  const nativeModel = model.replace(/^google\//, "");
  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(nativeModel)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [
          { text: prompt },
          ...referenceImages.flatMap((reference, index) => [
            { text: reference.label || `Reference image ${index + 1}` },
            { inlineData: { mimeType: reference.mimeType, data: reference.bytes.toString("base64") } }
          ])
        ] }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { aspectRatio: aspect_ratio, imageSize: resolution }
        }
      })
    }
  );
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new StructuredOutputError(response.ok ? "invalid_json" : "provider_error",
      `Gemini image generation failed: ${response.status} — non-JSON response`, String(response.status));
  }
  const body = isRecord(payload) ? payload : {};
  if (!response.ok || body.error) {
    const error = isRecord(body.error) ? body.error : {};
    const message = typeof error.message === "string"
      ? error.message.replaceAll(apiKey, "[redacted]").replace(/https?:\/\/\S+/gi, "[URL]").slice(0, 300)
      : "Provider request failed";
    throw new StructuredOutputError("provider_error",
      `Gemini image generation failed: ${response.status} — ${message}`, String(response.status));
  }
  const candidates = Array.isArray(body.candidates) ? body.candidates.filter(isRecord) : [];
  const feedback = isRecord(body.promptFeedback) ? body.promptFeedback : {};
  if (feedback.blockReason || candidates.some(candidate =>
    ["SAFETY", "IMAGE_SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "RECITATION"].includes(String(candidate.finishReason)))) {
    throw new StructuredOutputError("refusal", "Gemini image generation was refused or blocked by the provider.");
  }
  const parts = candidates.flatMap(candidate => {
    const content = isRecord(candidate.content) ? candidate.content : {};
    return Array.isArray(content.parts) ? content.parts.filter(isRecord) : [];
  });
  for (const part of parts) {
    if (part.thought === true) continue;
    const image = isRecord(part.inlineData) ? part.inlineData : {};
    if (typeof image.mimeType === "string" && image.mimeType.startsWith("image/") &&
      typeof image.data === "string" && image.data.trim()) {
      return { base64: image.data };
    }
  }
  throw new StructuredOutputError("empty_output", "Gemini image generation did not return image data.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
