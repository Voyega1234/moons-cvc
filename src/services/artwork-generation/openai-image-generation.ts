import { env } from "../../config/env";
import {
  emptyApprovalComments,
  emptyApprovalGate,
  type CreativeDirection,
  type CreativeOutput
} from "../../domain/creative-run";
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
  brandMemory: {
    working: readonly string[];
    avoid: readonly string[];
  };
  brandLibrary: {
    brand: readonly { title: string; description: string }[];
    products: readonly { title: string; description: string }[];
    docs: readonly { title: string; description: string }[];
    refs: readonly { title: string; description: string }[];
  };
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

  const payload = await readJsonResponse<
    Partial<ArtworkGenerationResponse> & { error?: string }
  >(response, "Artwork generation");

  if (!response.ok) {
    throw new Error(payload.error ?? `Artwork generation failed (${response.status}).`);
  }

  if (!Array.isArray(payload.outputs)) {
    throw new Error("Artwork generation returned no outputs.");
  }

  return payload.outputs.map(normalizeArtworkOutput);
}

export async function regenerateOutputImage({
  run,
  direction,
  extraInstructions
}: {
  run: WorkflowState;
  direction: Pick<
    CreativeDirection,
    "id" | "hook" | "concept" | "why" | "visual" | "cta" | "caption"
  >;
  extraInstructions?: string;
}): Promise<CreativeOutput> {
  if (!env.artworkGenerationEndpoint) {
    throw new Error("Artwork generation endpoint is not configured.");
  }

  const trimmedInstructions = extraInstructions?.trim();
  const request: ArtworkGenerationRequest = {
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
    quantity: 1,
    brief: run.brief,
    selectedHooks: [direction],
    textInputs: trimmedInstructions ? [trimmedInstructions] : [],
    referenceImages: run.referenceImages.map((item) => ({
      kind: "url" as const,
      url: item.url,
      label: item.label
    })),
    ...buildBrandContext(run.brand),
    output: {
      size: "1024x1024",
      format: "png"
    }
  };

  const response = await fetch(env.artworkGenerationEndpoint, {
    method: "POST",
    headers: await buildHeaders(),
    body: JSON.stringify(request)
  });

  const payload = await readJsonResponse<
    Partial<ArtworkGenerationResponse> & { error?: string }
  >(response, "Artwork regeneration");

  if (!response.ok) {
    throw new Error(
      payload.error ?? `Artwork regeneration failed (${response.status}).`
    );
  }

  const [regenerated] = payload.outputs ?? [];
  if (!regenerated) {
    throw new Error("Artwork regeneration returned no output.");
  }

  return normalizeArtworkOutput(regenerated);
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
    ...buildBrandContext(run.brand),
    output: {
      size: "1024x1024",
      format: "png"
    }
  };
}

function buildBrandContext(brand: WorkflowState["brand"]): Pick<
  ArtworkGenerationRequest,
  "brandMemory" | "brandLibrary"
> {
  return {
    brandMemory: {
      working: brand?.memory.working ?? [],
      avoid: brand?.memory.avoid ?? []
    },
    brandLibrary: {
      brand: compactLibraryItems(brand?.library.brand ?? []),
      products: compactLibraryItems(brand?.library.products ?? []),
      docs: compactLibraryItems(brand?.library.docs ?? []),
      refs: compactLibraryItems(brand?.library.refs ?? [])
    }
  };
}

function compactLibraryItems(
  items: readonly { title: string; description: string }[]
) {
  return items.map((item) => ({
    title: item.title,
    description: item.description
  }));
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
    revisionCount: 0,
    approval: emptyApprovalGate,
    approvalComments: emptyApprovalComments
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
    revisionCount: output.revisionCount,
    approval: emptyApprovalGate,
    approvalComments: emptyApprovalComments
  };
}

async function readJsonResponse<T>(
  response: Response,
  label: string
): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(`${label} returned an empty response body.`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    const contentType = response.headers.get("content-type") ?? "unknown";
    throw new Error(
      `${label} endpoint returned HTTP ${response.status} (${contentType}), not JSON.`
    );
  }
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
