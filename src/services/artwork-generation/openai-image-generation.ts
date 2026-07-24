import { env } from "../../config/env";
import {
  defaultArtworkOutputSize,
  emptyApprovalComments,
  emptyApprovalGate,
  inferredReferenceImageRole,
  outputFormatForService,
  type AlbumFormatPreference,
  referenceImageRoleLabels,
  type ArtworkOutputSize,
  type CreativeDirection,
  type CreativeOutput,
  type ReferenceImageSelection
} from "../../domain/creative-run";
import {
  creativeMixItems,
  creativeMixServiceAt,
  directionServiceAt,
  selectedBrandProducts,
  type WorkflowState
} from "../../features/workflow/model";
import type {
  ArtworkMode,
  ImagePromptModel
} from "../../domain/creative-run";
import { getSupabaseClient } from "../../lib/supabase/client";
import { generateArtworkFromWebhook } from "./n8n-artwork-generation";

const ARTWORK_REQUEST_BATCH_SIZE = 4;
const ARTWORK_REQUEST_CONCURRENCY = 2;

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

export function artworkReferencesFromSelections(
  references: readonly ReferenceImageSelection[]
): readonly ArtworkReferenceImage[] {
  return [...references]
    .sort(
      (left, right) =>
        Number(Boolean(right.primary)) - Number(Boolean(left.primary))
    )
    .map((reference) => ({
      kind: "url" as const,
      url: reference.url,
      label: [
        reference.primary ? "Primary reference" : "Supporting reference",
        referenceImageRoleLabels[inferredReferenceImageRole(reference)],
        reference.label
      ].join(" · ")
    }));
}

export interface GenerateArtworkForSelectedHooksInput {
  run: WorkflowState;
  textInputs?: readonly string[];
  referenceImages?: readonly ArtworkReferenceImage[];
  onProgress?: (completed: number, total: number) => void;
  onBatch?: (outputs: readonly CreativeOutput[]) => void;
}

export interface ArtworkGenerationRequest {
  model: "gpt-image-2";
  artworkMode: ArtworkMode;
  imagePromptModel: ImagePromptModel;
  albumFormat?: AlbumFormatPreference;
  runId: string;
  assetVersion?: number;
  brand: {
    id: string;
    name: string;
    category: string;
    personality: readonly string[];
    colors: readonly string[];
  } | null;
  service: WorkflowState["service"];
  quantity: number;
  brief: string;
  selectedHooks: readonly Pick<
    CreativeDirection,
    | "id"
    | "hook"
    | "concept"
    | "why"
    | "visual"
    | "cta"
    | "supportingPoints"
    | "formatBeats"
    | "albumFormat"
    | "ctaActionType"
    | "ctaDestination"
    | "contactLine"
    | "caption"
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
    size: ArtworkOutputSize;
    format: "png";
  };
}

export interface ArtworkGenerationResponse {
  outputs: readonly CreativeOutput[];
}

export interface ArtworkRevisionRequest {
  requestType: "artwork-revision";
  model: "gpt-image-2";
  clientId: string;
  runId: string;
  outputId: string;
  directionId: string;
  assetVersion: number;
  format: string;
  sourceImageUrl: string;
  instructions: string;
  output: {
    size: ArtworkOutputSize;
    format: "png";
  };
}

type ArtworkRegenerationDirection = Pick<
  CreativeDirection,
  | "id"
  | "hook"
  | "concept"
  | "why"
  | "visual"
  | "cta"
  | "supportingPoints"
  | "formatBeats"
  | "albumFormat"
  | "ctaActionType"
  | "ctaDestination"
  | "contactLine"
  | "caption"
>;

export async function generateArtworkForSelectedHooks({
  run,
  textInputs = [],
  referenceImages = [],
  onProgress,
  onBatch
}: GenerateArtworkForSelectedHooksInput): Promise<readonly CreativeOutput[]> {
  const requests = buildArtworkGenerationRequests({
    run,
    textInputs,
    referenceImages
  });
  const templateOutputs = buildUgcTemplateOutputs(run);
  const shouldResume = run.artworkGenerationStatus === "failed";
  const selectedDirectionIds = new Set(
    run.directions
      .filter((direction) => direction.selected)
      .map((direction) => direction.id)
  );
  const existingOutputs = shouldResume
    ? run.outputs.filter((output) => selectedDirectionIds.has(output.directionId))
    : [];
  const total = requests.reduce(
    (sum, request) => sum + request.selectedHooks.length,
    existingOutputs.length + templateOutputs.length
  );
  let completed = existingOutputs.length + templateOutputs.length;
  if (templateOutputs.length) onBatch?.(templateOutputs);
  onProgress?.(completed, total);

  if (
    env.artworkGenerationMode === "openai" &&
    !env.artworkGenerationEndpoint
  ) {
    const draftOutputs = buildDraftOutputs(
      run,
      requests.flatMap((request) => request.selectedHooks)
    );
    if (draftOutputs.length) onBatch?.(draftOutputs);
    const outputs = sortOutputsBySelectedDirection(run, [
      ...existingOutputs,
      ...draftOutputs,
      ...templateOutputs
    ]);
    onProgress?.(total, total);
    return outputs;
  }

  const payloads = await mapWithConcurrency(
    requests,
    ARTWORK_REQUEST_CONCURRENCY,
    async (request) => {
      const payload = await requestArtworkGeneration({ request, run });
      const outputs = payload.outputs.map(normalizeArtworkOutput);
      onBatch?.(outputs);
      completed += request.selectedHooks.length;
      onProgress?.(completed, total);
      return payload;
    }
  );
  return sortOutputsBySelectedDirection(run, [
    ...existingOutputs,
    ...payloads.flatMap((payload) =>
      payload.outputs.map(normalizeArtworkOutput)
    ),
    ...templateOutputs
  ]);
}

export async function reviseOutputImage({
  run,
  output,
  instructions
}: {
  run: WorkflowState;
  output: CreativeOutput;
  instructions: string;
}): Promise<CreativeOutput> {
  if (
    env.artworkGenerationMode === "openai" &&
    !env.artworkGenerationEndpoint
  ) {
    throw new Error("Artwork generation endpoint is not configured.");
  }

  const request = buildArtworkRevisionRequest({ run, output, instructions });
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
  >(response, "Artwork revision");

  if (!response.ok) {
    throw new Error(payload.error ?? `Artwork revision failed (${response.status}).`);
  }

  const revised = payload.outputs?.[0];
  if (!revised) {
    throw new Error("Artwork revision returned no output.");
  }

  return normalizeArtworkOutput(revised);
}

export function buildArtworkRevisionRequest({
  run,
  output,
  instructions
}: {
  run: WorkflowState;
  output: CreativeOutput;
  instructions: string;
}): ArtworkRevisionRequest {
  const sourceImageUrl = output.assetUrl?.trim();
  if (!sourceImageUrl) {
    throw new Error("The current artwork image is required for revision.");
  }
  const trimmedInstructions = instructions.trim();
  if (!trimmedInstructions) {
    throw new Error("Describe the changes you want to apply.");
  }

  return {
    requestType: "artwork-revision",
    model: "gpt-image-2",
    clientId: run.brand?.id ?? "unbranded",
    runId: run.id,
    outputId: output.id,
    directionId: output.directionId,
    assetVersion: output.revisionCount + 2,
    format: output.format,
    sourceImageUrl,
    instructions: trimmedInstructions,
    output: {
      size: run.outputSize ?? defaultArtworkOutputSize,
      format: "png"
    }
  };
}

export async function regenerateOutputImages({
  run,
  direction,
  extraInstructions,
  sourceImageUrl
}: {
  run: WorkflowState;
  direction: ArtworkRegenerationDirection;
  extraInstructions?: string;
  sourceImageUrl?: string;
}): Promise<readonly CreativeOutput[]> {
  if (
    env.artworkGenerationMode === "openai" &&
    !env.artworkGenerationEndpoint
  ) {
    throw new Error("Artwork generation endpoint is not configured.");
  }

  const request = buildArtworkRegenerationRequest({
    run,
    direction,
    extraInstructions,
    sourceImageUrl
  });

  const payload = await requestArtworkGeneration({ request, run });
  const regenerated = payload.outputs ?? [];
  if (!regenerated.length) {
    throw new Error("Artwork regeneration returned no output.");
  }

  return regenerated.map(normalizeArtworkOutput);
}

export function buildArtworkRegenerationRequest({
  run,
  direction,
  extraInstructions,
  sourceImageUrl
}: {
  run: WorkflowState;
  direction: ArtworkRegenerationDirection;
  extraInstructions?: string;
  sourceImageUrl?: string;
}): ArtworkGenerationRequest {
  const trimmedInstructions = extraInstructions?.trim();
  const trimmedSourceImageUrl = sourceImageUrl?.trim();
  const directionIndex = run.directions.findIndex(
    (item) => item.id === direction.id
  );
  const savedDirection = run.directions[directionIndex];
  if (
    savedDirection &&
    directionServiceAt(run, savedDirection, directionIndex) === "ugc-video"
  ) {
    throw new Error("UGC uses the editable 9:16 template, not image generation.");
  }
  return {
    model: "gpt-image-2",
    artworkMode: run.artworkMode,
    imagePromptModel: run.imagePromptModel,
    albumFormat: run.albumFormat,
    runId: run.id,
    assetVersion: nextArtworkAssetVersion(run),
    brand: buildBrandIdentity(run.brand),
    service: savedDirection
      ? directionServiceAt(run, savedDirection, directionIndex)
      : creativeMixServiceAt(run, 0),
    quantity: 1,
    brief: run.brief,
    selectedHooks: [direction],
    textInputs: trimmedInstructions ? [trimmedInstructions] : [],
    referenceImages: [
      ...(trimmedSourceImageUrl
        ? [
            {
              kind: "url" as const,
              url: trimmedSourceImageUrl,
              label: "Current artwork to revise"
            }
          ]
        : []),
      ...artworkReferencesFromSelections(run.referenceImages),
      ...brandGuidelineReferences(run),
      ...creativeMaterialReferences(run)
    ],
    ...buildBrandContext(run),
    output: {
      size: run.outputSize ?? defaultArtworkOutputSize,
      format: "png"
    }
  };
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
  const completedDirectionIds = new Set(
    run.artworkGenerationStatus === "failed"
      ? run.outputs.map((output) => output.directionId)
      : []
  );
  const selectedHooks = run.directions
    .map((direction, index) => ({
      direction,
      service: directionServiceAt(run, direction, index)
    }))
    .filter(
      ({ direction }) =>
        direction.selected && !completedDirectionIds.has(direction.id)
    );

  return creativeMixItems(run).flatMap((item) => {
    if (item.service === "ugc-video") return [];
    const hooks = selectedHooks
      .filter(({ service }) => service === item.service)
      .slice(0, item.quantity)
      .map(({ direction: {
        id,
        hook,
        concept,
        why,
        visual,
        cta,
        supportingPoints,
        formatBeats,
        albumFormat,
        ctaActionType,
        ctaDestination,
        contactLine,
        caption
      } }) => ({
        id,
        hook,
        concept,
        why,
        visual,
        cta,
        supportingPoints,
        formatBeats,
        albumFormat,
        ctaActionType,
        ctaDestination,
        contactLine,
        caption
      }));
    return chunk(hooks, ARTWORK_REQUEST_BATCH_SIZE).map((selectedHooks) =>
          buildArtworkRequest({
            run,
            service: item.service,
            quantity: selectedHooks.length,
            selectedHooks,
            textInputs,
            referenceImages
          })
        );
  });
}

function buildUgcTemplateOutputs(run: WorkflowState): readonly CreativeOutput[] {
  const completedDirectionIds = new Set(
    run.artworkGenerationStatus === "failed"
      ? run.outputs.map((output) => output.directionId)
      : []
  );
  return run.directions
    .map((direction, index) => ({ direction, index }))
    .filter(
      ({ direction, index }) =>
        direction.selected &&
        directionServiceAt(run, direction, index) === "ugc-video" &&
        !completedDirectionIds.has(direction.id)
    )
    .map(({ direction }, index) => ({
      id: `ugc-template-${direction.id}-${index + 1}`,
      directionId: direction.id,
      format: outputFormatForService("ugc-video"),
      status: "draft" as const,
      clientStatus: "queued" as const,
      provider: "template",
      model: "compass-ugc-template",
      revisionCount: 0,
      approval: emptyApprovalGate,
      approvalComments: emptyApprovalComments
    }));
}

function sortOutputsBySelectedDirection(
  run: WorkflowState,
  outputs: readonly CreativeOutput[]
): readonly CreativeOutput[] {
  const selectedOrder = new Map(
    run.directions
      .filter((direction) => direction.selected)
      .map((direction, index) => [direction.id, index])
  );
  return [...outputs].sort(
    (left, right) =>
      (selectedOrder.get(left.directionId) ?? Number.MAX_SAFE_INTEGER) -
      (selectedOrder.get(right.directionId) ?? Number.MAX_SAFE_INTEGER)
  );
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
    albumFormat: run.albumFormat,
    runId: run.id,
    assetVersion: nextArtworkAssetVersion(run),
    brand: buildBrandIdentity(run.brand),
    service,
    quantity,
    brief: run.brief,
    selectedHooks,
    textInputs,
    referenceImages: [
      ...referenceImages,
      ...brandGuidelineReferences(run),
      ...creativeMaterialReferences(run)
    ],
    ...buildBrandContext(run),
    output: {
      size: run.outputSize ?? defaultArtworkOutputSize,
      format: "png"
    }
  };
}

function nextArtworkAssetVersion(run: WorkflowState): number {
  const currentVersion = run.outputs.reduce(
    (latest, output) => Math.max(latest, output.revisionCount + 1),
    0
  );
  if (currentVersion === 0) return 1;
  return run.artworkGenerationStatus === "failed"
    ? currentVersion
    : currentVersion + 1;
}

function creativeMaterialReferences(
  run: WorkflowState
): readonly ArtworkReferenceImage[] {
  return run.uploadedMaterials.map((material) => {
    const role = creativeMaterialRoleLabel(material.role);
    const label = [
      `Uploaded ${role}: ${material.name}`,
      material.description
    ]
      .filter(Boolean)
      .join(" — ");
    const dataUrl = /^data:([^;]+);base64,(.+)$/i.exec(material.url);
    if (dataUrl) {
      return {
        kind: "base64" as const,
        mediaType: dataUrl[1] || material.mediaType,
        data: dataUrl[2] || "",
        label
      };
    }
    return {
      kind: "url" as const,
      url: material.url,
      mediaType: material.mediaType,
      label
    };
  });
}

function brandGuidelineReferences(
  run: WorkflowState
): readonly ArtworkReferenceImage[] {
  return (run.brand?.library.brand ?? [])
    .filter(
      (item) =>
        item.assetUrl &&
        normalizeBrandRuleTitle(item.title) === "brandciguideline" &&
        isSupportedImageUrl(item.assetUrl)
    )
    .map((item) => ({
      kind: "url" as const,
      url: item.assetUrl as string,
      label:
        "Brand CI / Guideline source — follow its identity, typography, color, spacing, imagery, and logo rules; do not copy sample campaign content"
    }));
}

function normalizeBrandRuleTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isSupportedImageUrl(value: string): boolean {
  try {
    return /\.(?:png|jpe?g|webp)$/i.test(new URL(value).pathname);
  } catch {
    return /\.(?:png|jpe?g|webp)(?:\?|$)/i.test(value);
  }
}

function creativeMaterialRoleLabel(
  role: WorkflowState["uploadedMaterials"][number]["role"]
): string {
  switch (role) {
    case "main-object":
      return "main object (use as the hero/source object)";
    case "product":
      return "product (preserve its visible identity)";
    case "supporting-component":
      return "supporting component";
    case "client-context":
      return "client material/context";
  }
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
    colors: extractBrandPaletteColors(brand.library.brand)
  };
}

function extractBrandPaletteColors(
  items: readonly { title: string; description: string }[]
): readonly string[] {
  return compactUnique(
    items.flatMap((item) => {
      const title = item.title.trim().toLowerCase();
      if (title === "colors" || title === "secondary colors") {
        return extractColorTokens(item.description);
      }

      if (title === "visual guidance") {
        return extractPaletteLineColors(item.description);
      }

      return [];
    })
  );
}

function extractPaletteLineColors(description: string): readonly string[] {
  const line = description
    .split("\n")
    .find((candidate) => /^color palette\s*:/i.test(candidate.trim()));
  if (!line) return [];

  return extractColorTokens(line.replace(/^color palette\s*:/i, ""));
}

function extractColorTokens(value: string): readonly string[] {
  return value
    .split(/[,;|\n]+/)
    .map((token) => token.trim())
    .filter((token) => /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(token));
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

function chunk<T>(items: readonly T[], size: number): readonly T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function mapWithConcurrency<Input, Output>(
  items: readonly Input[],
  concurrency: number,
  task: (item: Input, index: number) => Promise<Output>
): Promise<readonly Output[]> {
  const results = new Array<Output>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await task(item, index);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), items.length) },
      () => worker()
    )
  );
  return results;
}

function buildBrandContext(run: WorkflowState): Pick<
  ArtworkGenerationRequest,
  "brandMemory" | "brandLibrary"
> {
  const brand = run.brand;
  return {
    brandMemory: {
      working: brand?.memory.working ?? [],
      avoid: brand?.memory.avoid ?? []
    },
    brandLibrary: {
      brand: compactLibraryItems(brand?.library.brand ?? []),
      products: compactLibraryItems(selectedBrandProducts(run)),
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
    ...(output.albumMasterAssetUrl
      ? { albumMasterAssetUrl: output.albumMasterAssetUrl }
      : {}),
    ...(output.albumMasterAssetStoragePath
      ? { albumMasterAssetStoragePath: output.albumMasterAssetStoragePath }
      : {}),
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
