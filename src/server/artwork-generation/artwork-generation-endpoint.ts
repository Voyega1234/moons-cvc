import { createClient } from "@supabase/supabase-js";
import { emptyApprovalComments, emptyApprovalGate } from "../../domain/creative-run";
import type { Database } from "../../lib/supabase/database.types";
import type {
  ArtworkGenerationRequest,
  ArtworkGenerationResponse
} from "../../services/artwork-generation/openai-image-generation";
import { resolveConvertCakeAuthorization } from "../shared/convert-cake-auth";
import { generateImagePrompt } from "./image-prompt-agent";
import {
  editImage,
  generateImage,
  type ReferenceImageInput
} from "./openai-images-client";

type FetchLike = typeof fetch;
type SelectedHook = ArtworkGenerationRequest["selectedHooks"][number];
type ArtworkOutput = ArtworkGenerationResponse["outputs"][number];

export interface ArtworkGenerationEndpointEnv {
  OPENAI_API_KEY?: string;
  OPENAI_IMAGE_GENERATION_MODEL?: string;
  OPENAI_IMAGE_PROMPT_MODEL?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

export interface ArtworkStorageClient {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: Buffer,
        options: { contentType: string; upsert: boolean }
      ): Promise<{ error: { message: string } | null }>;
      createSignedUrl(
        path: string,
        expiresInSeconds: number
      ): Promise<{
        data: { signedUrl: string } | null;
        error: { message: string } | null;
      }>;
    };
  };
}

export interface ArtworkGenerationEndpointOptions {
  request: Request;
  env: ArtworkGenerationEndpointEnv;
  fetchImpl?: FetchLike;
  createStorageClient?: (options: {
    supabaseUrl: string;
    supabaseAnonKey: string;
    accessToken: string;
  }) => ArtworkStorageClient;
}

const ARTWORK_BUCKET = "creative-assets";
const SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
const ARTWORK_GENERATION_CONCURRENCY = 2;

export async function handleArtworkGenerationRequest({
  request,
  env,
  fetchImpl = fetch,
  createStorageClient = defaultCreateStorageClient
}: ArtworkGenerationEndpointOptions): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  try {
    const apiKey = env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return jsonResponse(
        { ok: false, error: "OPENAI_API_KEY is required." },
        500
      );
    }

    const auth = await resolveConvertCakeAuthorization(request, env, fetchImpl);
    if (!auth.authorized) {
      return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
    }

    const supabaseUrl = env.SUPABASE_URL?.trim();
    const supabaseAnonKey = env.SUPABASE_ANON_KEY?.trim();
    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonResponse(
        { ok: false, error: "Supabase storage is not configured." },
        500
      );
    }
    if (!auth.accessToken) {
      return jsonResponse(
        { ok: false, error: "Missing Supabase access token." },
        401
      );
    }

    const input = parseRequestBody(await request.json());
    const model = env.OPENAI_IMAGE_GENERATION_MODEL?.trim() || input.model;
    const promptModel = env.OPENAI_IMAGE_PROMPT_MODEL?.trim();

    const storage = createStorageClient({
      supabaseUrl,
      supabaseAnonKey,
      accessToken: auth.accessToken
    });

    const outputs = await generateOutputsForSelectedHooks({
      input,
      apiKey,
      model,
      promptModel,
      storage,
      fetchImpl
    });

    return jsonResponse({ ok: true, outputs });
  } catch (error) {
    return jsonResponse({ ok: false, error: readableError(error) }, 500);
  }
}

function defaultCreateStorageClient({
  supabaseUrl,
  supabaseAnonKey,
  accessToken
}: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessToken: string;
}): ArtworkStorageClient {
  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
}

async function generateOutputsForSelectedHooks({
  input,
  apiKey,
  model,
  promptModel,
  storage,
  fetchImpl
}: {
  input: ArtworkGenerationRequest;
  apiKey: string;
  model: string;
  promptModel?: string;
  storage: ArtworkStorageClient;
  fetchImpl: FetchLike;
}): Promise<readonly ArtworkOutput[]> {
  const references = await resolveReferenceImages(
    input.referenceImages,
    fetchImpl
  );

  const format = formatForService(input.service);
  return mapWithConcurrency(
    input.selectedHooks,
    ARTWORK_GENERATION_CONCURRENCY,
    (hook) =>
      generateOutputForHook({
        input,
        hook,
        apiKey,
        model,
        promptModel,
        references,
        format,
        storage,
        fetchImpl
      })
  );
}

async function generateOutputForHook({
  input,
  hook,
  apiKey,
  model,
  promptModel,
  references,
  format,
  storage,
  fetchImpl
}: {
  input: ArtworkGenerationRequest;
  hook: SelectedHook;
  apiKey: string;
  model: string;
  promptModel?: string;
  references: readonly ReferenceImageInput[];
  format: string;
  storage: ArtworkStorageClient;
  fetchImpl: FetchLike;
}): Promise<ArtworkOutput> {
  const prompt = await resolveImagePrompt({
    input,
    hook,
    apiKey,
    promptModel,
    fetchImpl
  });
  const image =
    references.length > 0
      ? await editImage({
          apiKey,
          model,
          prompt,
          size: input.output.size,
          referenceImages: references,
          fetchImpl
        })
      : await generateImage({
          apiKey,
          model,
          prompt,
          size: input.output.size,
          fetchImpl
        });

  const assetStoragePath = buildStoragePath({
    clientId: input.brand?.id ?? "unbranded",
    runId: input.runId,
    directionId: hook.id
  });

  const uploadResult = await storage.storage
    .from(ARTWORK_BUCKET)
    .upload(assetStoragePath, Buffer.from(image.base64, "base64"), {
      contentType: image.mimeType,
      upsert: true
    });
  if (uploadResult.error) throw new Error(uploadResult.error.message);

  const signedUrlResult = await storage.storage
    .from(ARTWORK_BUCKET)
    .createSignedUrl(assetStoragePath, SIGNED_URL_EXPIRES_IN_SECONDS);
  if (signedUrlResult.error) throw new Error(signedUrlResult.error.message);
  if (!signedUrlResult.data) {
    throw new Error("Could not create a signed URL for the generated asset.");
  }

  return {
    id: `${hook.id}-v1`,
    directionId: hook.id,
    format,
    status: "ready",
    clientStatus: "queued",
    assetUrl: signedUrlResult.data.signedUrl,
    assetStoragePath,
    assetBucket: ARTWORK_BUCKET,
    provider: "openai",
    model,
    revisionCount: 0,
    approval: emptyApprovalGate,
    approvalComments: emptyApprovalComments
  };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  map: (item: T) => Promise<R>
): Promise<readonly R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await map(items[index]!);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

async function resolveReferenceImages(
  referenceImages: ArtworkGenerationRequest["referenceImages"],
  fetchImpl: FetchLike
): Promise<readonly ReferenceImageInput[]> {
  return Promise.all(
    referenceImages.map(async (reference) => {
      if (reference.kind === "url") {
        const response = await fetchImpl(reference.url);
        if (!response.ok) {
          throw new Error(
            `Could not download reference image: ${response.status}`
          );
        }
        const mimeType =
          response.headers.get("content-type")?.split(";")[0]?.trim() ||
          reference.mediaType ||
          "image/png";
        return {
          bytes: Buffer.from(await response.arrayBuffer()),
          mimeType
        };
      }

      if (reference.kind === "base64") {
        return {
          bytes: Buffer.from(reference.data, "base64"),
          mimeType: reference.mediaType
        };
      }

      throw new Error(
        "Reference images from OpenAI file IDs are not supported yet."
      );
    })
  );
}

function formatForService(service: ArtworkGenerationRequest["service"]): string {
  return service === "ugc-video" ? "9:16 UGC" : "1:1 Static";
}

async function resolveImagePrompt({
  input,
  hook,
  apiKey,
  promptModel,
  fetchImpl
}: {
  input: ArtworkGenerationRequest;
  hook: SelectedHook;
  apiKey: string;
  promptModel?: string;
  fetchImpl: FetchLike;
}): Promise<string> {
  try {
    return await generateImagePrompt({
      apiKey,
      model: promptModel,
      fetchImpl,
      input: {
        brand: input.brand,
        service: input.service,
        brief: input.brief,
        hook,
        textInputs: input.textInputs,
        referenceImageLabels: input.referenceImages.map(
          (reference) => reference.label ?? "Reference image"
        ),
        canvasRatio: "1:1",
        brandMemory: input.brandMemory,
        brandLibrary: {
          brand: input.brandLibrary.brand,
          products: input.brandLibrary.products
        }
      }
    });
  } catch {
    // Fall back to the deterministic prompt so image generation still
    // succeeds if the prompt agent call fails or times out.
    return buildImagePrompt(input, hook);
  }
}

function buildImagePrompt(
  input: ArtworkGenerationRequest,
  hook: SelectedHook
): string {
  return [
    `Create a paid social ad visual for ${input.brand?.name ?? "the brand"}${
      input.brand?.category ? ` (${input.brand.category})` : ""
    }.`,
    `Hook: ${hook.hook}`,
    `Concept: ${hook.concept}`,
    `Visual direction: ${hook.visual}`,
    `Caption context: ${hook.caption}`,
    `Brief: ${input.brief}`,
    ...input.textInputs,
    "Design a clean, brand-safe, scroll-stopping social ad image that matches the visual direction. Avoid adding text overlays unless the visual direction explicitly calls for them."
  ].join("\n");
}

function buildStoragePath({
  clientId,
  runId,
  directionId
}: {
  clientId: string;
  runId: string;
  directionId: string;
}): string {
  return [
    safePathSegment(clientId),
    safePathSegment(runId),
    "outputs",
    `${safePathSegment(directionId)}-v1.png`
  ].join("/");
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

function parseRequestBody(value: unknown): ArtworkGenerationRequest {
  if (!isRecord(value)) throw new Error("Invalid artwork generation request.");

  const model = readString(value.model, "model");
  const runId = readString(value.runId, "runId");
  const service = readString(value.service, "service");
  const quantity = readNumber(value.quantity, "quantity");
  const brief = readString(value.brief, "brief");
  const textInputs = readStringArray(value.textInputs, "textInputs");

  if (!Array.isArray(value.referenceImages)) {
    throw new Error("referenceImages must be an array.");
  }
  if (!Array.isArray(value.selectedHooks)) {
    throw new Error("selectedHooks must be an array.");
  }

  const output = readRecord(value.output, "output");

  return {
    model: model as ArtworkGenerationRequest["model"],
    runId,
    brand: value.brand == null ? null : parseBrand(value.brand),
    service: service as ArtworkGenerationRequest["service"],
    quantity,
    brief,
    selectedHooks: value.selectedHooks.map((item, index) =>
      parseSelectedHook(item, index)
    ),
    textInputs,
    referenceImages:
      value.referenceImages as ArtworkGenerationRequest["referenceImages"],
    brandMemory: parseBrandMemory(value.brandMemory),
    brandLibrary: parseBrandLibrary(value.brandLibrary),
    output: {
      size: readString(
        output.size,
        "output.size"
      ) as ArtworkGenerationRequest["output"]["size"],
      format: readString(
        output.format,
        "output.format"
      ) as ArtworkGenerationRequest["output"]["format"]
    }
  };
}

function parseBrandMemory(
  value: unknown
): ArtworkGenerationRequest["brandMemory"] {
  if (!isRecord(value)) return { working: [], avoid: [] };
  return {
    working: Array.isArray(value.working)
      ? value.working.filter((item): item is string => typeof item === "string")
      : [],
    avoid: Array.isArray(value.avoid)
      ? value.avoid.filter((item): item is string => typeof item === "string")
      : []
  };
}

function parseBrandLibrary(
  value: unknown
): ArtworkGenerationRequest["brandLibrary"] {
  if (!isRecord(value)) {
    return { brand: [], products: [], docs: [], refs: [] };
  }
  return {
    brand: parseLibraryItems(value.brand),
    products: parseLibraryItems(value.products),
    docs: parseLibraryItems(value.docs),
    refs: parseLibraryItems(value.refs)
  };
}

function parseLibraryItems(
  value: unknown
): readonly { title: string; description: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .filter(
      (item) =>
        typeof item.title === "string" && typeof item.description === "string"
    )
    .map((item) => ({
      title: item.title as string,
      description: item.description as string
    }));
}

function parseBrand(value: unknown): ArtworkGenerationRequest["brand"] {
  const brand = readRecord(value, "brand");
  return {
    id: readString(brand.id, "brand.id"),
    name: readString(brand.name, "brand.name"),
    category: readString(brand.category, "brand.category")
  };
}

function parseSelectedHook(value: unknown, index: number): SelectedHook {
  const hook = readRecord(value, `selectedHooks[${index}]`);
  return {
    id: readString(hook.id, `selectedHooks[${index}].id`),
    hook: readString(hook.hook, `selectedHooks[${index}].hook`),
    concept: readString(hook.concept, `selectedHooks[${index}].concept`),
    why: readString(hook.why, `selectedHooks[${index}].why`),
    visual: readString(hook.visual, `selectedHooks[${index}].visual`),
    cta: readString(hook.cta, `selectedHooks[${index}].cta`),
    caption: readString(hook.caption, `selectedHooks[${index}].caption`)
  };
}

function readRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  return value;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  return value;
}

function readNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a number.`);
  }
  return value;
}

function readStringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be a string array.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown artwork generation error.";
}
