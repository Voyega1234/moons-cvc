import { env } from "../../config/env";
import type { CreativeDirection, CreativeOutput } from "../../domain/creative-run";
import type { WorkflowState } from "../../features/workflow/model";
import { getSupabaseClient } from "../../lib/supabase/client";

export type ArtworkReferenceImage =
  | {
      kind: "url";
      url: string;
      label?: string;
      mediaType?: string;
    }
  | {
      kind: "base64";
      data: string;
      mediaType: string;
      label?: string;
    }
  | {
      kind: "openai_file";
      fileId: string;
      label?: string;
    };

export interface GenerateArtworkForSelectedHooksInput {
  run: WorkflowState;
  textInputs?: readonly string[];
  referenceImages?: readonly ArtworkReferenceImage[];
}

export interface ArtworkGenerationRequest {
  model: "gpt-image-2";
  runId: string;
  brand: {
    id: string;
    name: string;
    category: string;
  } | null;
  service: WorkflowState["service"];
  quantity: number;
  brief: string;
  selectedHooks: readonly Pick<
    CreativeDirection,
    "id" | "hook" | "concept" | "why" | "visual" | "cta" | "caption"
  >[];
  textInputs: readonly string[];
  referenceImages: readonly ArtworkReferenceImage[];
  output: {
    size: "1024x1024";
    format: "png";
  };
}

export interface ArtworkGenerationResponse {
  outputs: readonly CreativeOutput[];
}

export async function generateArtworkForSelectedHooks({
  run,
  textInputs = [],
  referenceImages = []
}: GenerateArtworkForSelectedHooksInput): Promise<readonly CreativeOutput[]> {
  const request = buildArtworkGenerationRequest({
    run,
    textInputs,
    referenceImages
  });

  if (!env.artworkGenerationEndpoint) {
    return buildDraftOutputs(run, request.selectedHooks);
  }

  const response = await fetch(env.artworkGenerationEndpoint, {
    method: "POST",
    headers: await buildHeaders(),
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    throw new Error(`Artwork generation failed: ${response.status}`);
  }

  const payload = (await response.json()) as Partial<ArtworkGenerationResponse>;
  if (!Array.isArray(payload.outputs)) {
    throw new Error("Artwork generation returned no outputs.");
  }

  return payload.outputs.map(normalizeArtworkOutput);
}

export function buildArtworkGenerationRequest({
  run,
  textInputs = [],
  referenceImages = []
}: GenerateArtworkForSelectedHooksInput): ArtworkGenerationRequest {
  const selectedHooks = run.directions
    .filter((direction) => direction.selected)
    .map(({ id, hook, concept, why, visual, cta, caption }) => ({
      id,
      hook,
      concept,
      why,
      visual,
      cta,
      caption
    }));

  return {
    model: "gpt-image-2",
    runId: run.id,
    brand: run.brand
      ? {
          id: run.brand.id,
          name: run.brand.name,
          category: run.brand.category
        }
      : null,
    service: run.service,
    quantity: run.quantity,
    brief: run.brief,
    selectedHooks,
    textInputs,
    referenceImages,
    output: {
      size: "1024x1024",
      format: "png"
    }
  };
}

function buildDraftOutputs(
  run: WorkflowState,
  selectedHooks: ArtworkGenerationRequest["selectedHooks"]
): readonly CreativeOutput[] {
  return selectedHooks.map((hook, index) => ({
    id: `output-${index + 1}`,
    directionId: hook.id,
    format: run.service === "ugc-video" ? "9:16 UGC" : "1:1 Static",
    status: "draft",
    clientStatus: "queued",
    provider: "openai",
    model: "gpt-image-2",
    revisionCount: 0
  }));
}

export function normalizeArtworkOutput(output: CreativeOutput): CreativeOutput {
  return {
    id: output.id,
    directionId: output.directionId,
    format: output.format,
    status: output.status,
    clientStatus: output.clientStatus,
    ...(output.assetUrl ? { assetUrl: output.assetUrl } : {}),
    ...(output.assetStoragePath
      ? { assetStoragePath: output.assetStoragePath }
      : {}),
    ...(output.assetBucket ? { assetBucket: output.assetBucket } : {}),
    ...(output.provider ? { provider: output.provider } : {}),
    ...(output.model ? { model: output.model } : {}),
    revisionCount: output.revisionCount
  };
}

async function buildHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  try {
    const { data } = await getSupabaseClient().auth.getSession();
    if (data.session?.access_token) {
      headers.Authorization = `Bearer ${data.session.access_token}`;
    }
  } catch {
    return headers;
  }

  return headers;
}
