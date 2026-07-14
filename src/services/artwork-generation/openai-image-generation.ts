import { env } from "../../config/env";
import {
  emptyApprovalComments,
  emptyApprovalGate,
  outputFormatForService,
  type CreativeDirection,
  type CreativeOutput
} from "../../domain/creative-run";
import {
  creativeMixItems,
  creativeMixServiceAt,
  directionServiceAt,
  type WorkflowState
} from "../../features/workflow/model";
import type {
  ArtworkMode,
  ImagePromptModel
} from "../../domain/creative-run";
import { getSupabaseClient } from "../../lib/supabase/client";
import { generateArtworkFromWebhook } from "./n8n-artwork-generation";

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
  artworkMode: ArtworkMode;
  imagePromptModel: ImagePromptModel;
  runId: string;
  brand: {
    id: string;
    name: string;
    category: string;
    personality: readonly string[];
    colors: readonly string[];
    mustAvoid: readonly string[];
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
  const requests = buildArtworkGenerationRequests({
    run,
    textInputs,
    referenceImages
  });

  if (
    env.artworkGenerationMode === "openai" &&
    !env.artworkGenerationEndpoint
  ) {
    return buildDraftOutputs(
      run,
      requests.flatMap((request) => request.selectedHooks)
    );
  }

  const payloads = await Promise.all(
    requests.map((request) => requestArtworkGeneration({ request, run }))
  );
  return payloads.flatMap((payload) =>
    payload.outputs.map(normalizeArtworkOutput)
  );
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
  if (
    env.artworkGenerationMode === "openai" &&
    !env.artworkGenerationEndpoint
  ) {
    throw new Error("Artwork generation endpoint is not configured.");
  }

  const trimmedInstructions = extraInstructions?.trim();
  const directionIndex = run.directions.findIndex(
    (item) => item.id === direction.id
  );
  const savedDirection = run.directions[directionIndex];
  const request: ArtworkGenerationRequest = {
    model: "gpt-image-2",
    artworkMode: run.artworkMode,
    imagePromptModel: run.imagePromptModel,
    runId: run.id,
    brand: buildBrandIdentity(run.brand),
    service: savedDirection
      ? directionServiceAt(run, savedDirection, directionIndex)
      : creativeMixServiceAt(run, 0),
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

  const payload = await requestArtworkGeneration({ request, run });

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
  const [request] = buildArtworkGenerationRequests({
    run,
    textInputs,
    referenceImages
  });
  if (request) return request;

  return buildArtworkRequest({
    run,
    service: creativeMixItems(run)[0]?.service ?? run.service,
    quantity: 0,
    selectedHooks: [],
    textInputs,
    referenceImages
  });
}

export function buildArtworkGenerationRequests({
  run,
  textInputs = [],
  referenceImages = []
}: GenerateArtworkForSelectedHooksInput): readonly ArtworkGenerationRequest[] {
  const selectedHooks = run.directions
    .map((direction, index) => ({
      direction,
      service: directionServiceAt(run, direction, index)
    }))
    .filter(({ direction }) => direction.selected);

  return creativeMixItems(run).flatMap((item) => {
    const hooks = selectedHooks
      .filter(({ service }) => service === item.service)
      .slice(0, item.quantity)
      .map(({ direction: { id, hook, concept, why, visual, cta, caption } }) => ({
        id,
        hook,
        concept,
        why,
        visual,
        cta,
        caption
      }));
    return hooks.length
      ? [
          buildArtworkRequest({
            run,
            service: item.service,
            quantity: hooks.length,
            selectedHooks: hooks,
            textInputs,
            referenceImages
          })
        ]
      : [];
  });
}

function buildArtworkRequest({
  run,
  service,
  quantity,
  selectedHooks,
  textInputs,
  referenceImages
}: {
  run: WorkflowState;
  service: WorkflowState["service"];
  quantity: number;
  selectedHooks: ArtworkGenerationRequest["selectedHooks"];
  textInputs: readonly string[];
  referenceImages: readonly ArtworkReferenceImage[];
}): ArtworkGenerationRequest {

  return {
    model: "gpt-image-2",
    artworkMode: run.artworkMode,
    imagePromptModel: run.imagePromptModel,
    runId: run.id,
    brand: buildBrandIdentity(run.brand),
    service,
    quantity,
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

function buildBrandIdentity(
  brand: WorkflowState["brand"]
): ArtworkGenerationRequest["brand"] {
  if (!brand) return null;

  return {
    id: brand.id,
    name: brand.name,
    category: brand.category,
    personality: extractBrandRuleValues(
      brand.library.brand,
      /personality|tone|voice|words|guideline|บุคลิก|น้ำเสียง/i
    ),
    colors: extractBrandRuleValues(
      brand.library.brand,
      /colou?r|palette|สี/i
    ),
    mustAvoid: compactUnique([
      ...brand.memory.avoid,
      ...extractBrandRuleValues(
        [...brand.library.brand, ...brand.library.refs],
        /avoid|must not|restriction|ห้าม|ไม่ควร/i
      )
    ])
  };
}

function extractBrandRuleValues(
  items: readonly { title: string; description: string }[],
  titlePattern: RegExp
): readonly string[] {
  return compactUnique(
    items
      .filter((item) => titlePattern.test(item.title))
      .flatMap((item) => item.description.split(/[,;|\n]+/))
  );
}

function compactUnique(values: readonly string[]): readonly string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean))
  ).slice(0, 8);
}

function buildBrandContext(brand: WorkflowState["brand"]): Pick<
  ArtworkGenerationRequest,
  "brandLibrary"
> {
  return {
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

async function requestArtworkGeneration({
  request,
  run
}: {
  request: ArtworkGenerationRequest;
  run: WorkflowState;
}): Promise<ArtworkGenerationResponse> {
  if (env.artworkGenerationMode === "n8n") {
    return generateArtworkFromWebhook({ request, brand: run.brand });
  }

  const endpoint = env.artworkGenerationEndpoint;
  if (!endpoint) {
    throw new Error("Artwork generation endpoint is not configured.");
  }

  const response = await fetch(endpoint, {
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

  return { outputs: payload.outputs };
}

function buildDraftOutputs(
  run: WorkflowState,
  selectedHooks: ArtworkGenerationRequest["selectedHooks"]
): readonly CreativeOutput[] {
  return selectedHooks.map((hook, index) => {
    const directionIndex = run.directions.findIndex(
      (direction) => direction.id === hook.id
    );
    const direction = run.directions[directionIndex];
    const service = direction
      ? directionServiceAt(run, direction, directionIndex)
      : creativeMixServiceAt(run, index);
    return {
    id: `output-${index + 1}`,
    directionId: hook.id,
    format: outputFormatForService(service),
    status: "draft",
    clientStatus: "queued",
    provider: "openai",
    model: "gpt-image-2",
    revisionCount: 0,
    approval: emptyApprovalGate,
    approvalComments: emptyApprovalComments
  };
  });
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
