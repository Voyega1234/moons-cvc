import { env } from "../../config/env";
import type { Brand } from "../../domain/brand";
import type {
  ArtworkGenerationRequest,
  ArtworkGenerationResponse
} from "./openai-image-generation";

export interface N8nArtworkGenerationRequest extends ArtworkGenerationRequest {
  logoUrl: string | null;
  referenceImageUrls: readonly {
    url: string;
    label?: string;
  }[];
}

export async function generateArtworkFromWebhook({
  request,
  brand
}: {
  request: ArtworkGenerationRequest;
  brand: Brand | null;
}): Promise<ArtworkGenerationResponse> {
  const webhookUrl = env.artworkGenerationWebhookUrl;
  if (!webhookUrl) {
    throw new Error("n8n artwork generation webhook is not configured.");
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildN8nArtworkGenerationRequest({ request, brand }))
  });
  const payload = await readJsonResponse<
    Partial<ArtworkGenerationResponse> & { error?: string }
  >(response);

  if (!response.ok) {
    throw new Error(payload.error ?? `n8n artwork generation failed (${response.status}).`);
  }
  if (!Array.isArray(payload.outputs)) {
    throw new Error("n8n artwork generation returned no outputs.");
  }

  return { outputs: payload.outputs };
}

export function buildN8nArtworkGenerationRequest({
  request,
  brand
}: {
  request: ArtworkGenerationRequest;
  brand: Brand | null;
}): N8nArtworkGenerationRequest {
  const selectedLogoUrl = request.referenceImages.find(
    (image) => image.kind === "url" && isLogoReference(image.label)
  );

  return {
    ...request,
    logoUrl:
      (selectedLogoUrl?.kind === "url" ? selectedLogoUrl.url : null) ??
      brand?.library.brand.find(
        (item) => item.title.trim().toLowerCase() === "logo"
      )?.assetUrl ??
      null,
    referenceImageUrls: request.referenceImages.flatMap((image) =>
      image.kind === "url" && !isLogoReference(image.label)
        ? [
            {
              url: image.url,
              ...(image.label ? { label: image.label } : {})
            }
          ]
        : []
    )
  };
}

function isLogoReference(label: string | undefined): boolean {
  const normalized = label?.trim().toLowerCase();
  return Boolean(
    normalized === "logo" ||
      normalized?.includes("· logo ·") ||
      normalized?.startsWith("logo reference")
  );
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error("n8n artwork generation returned an empty response body.");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    const contentType = response.headers.get("content-type") ?? "unknown";
    throw new Error(
      `n8n artwork generation endpoint returned HTTP ${response.status} (${contentType}), not JSON.`
    );
  }
}
