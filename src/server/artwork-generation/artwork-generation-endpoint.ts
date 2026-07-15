import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  artworkModes,
  artworkOutputSizes,
  ctaActionTypes,
  emptyApprovalComments,
  emptyApprovalGate,
  imagePromptModels,
  outputFormatForService,
  type ArtworkOutputSize,
  type CtaActionType
} from "../../domain/creative-run.js";
import type { Database } from "../../lib/supabase/database.types.js";
import type {
  ArtworkGenerationRequest,
  ArtworkGenerationResponse
} from "../../services/artwork-generation/openai-image-generation.js";
import { resolveConvertCakeAuthorization } from "../shared/convert-cake-auth.js";
import {
  generateImagePrompt,
  type ImagePromptProvider,
  type ImagePromptAgentTrace
} from "./image-prompt-agent.js";
import {
  editImage,
  generateImage,
  type ReferenceImageInput
} from "./openai-images-client.js";

type FetchLike = typeof fetch;
type SelectedHook = ArtworkGenerationRequest["selectedHooks"][number];
type ArtworkOutput = ArtworkGenerationResponse["outputs"][number];

export interface ArtworkGenerationEndpointEnv {
  OPENAI_API_KEY?: string;
  OPENAI_IMAGE_GENERATION_MODEL?: string;
  OPENAI_IMAGE_PROMPT_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_IMAGE_PROMPT_MODEL?: string;
  ARTWORK_GENERATION_DEBUG_LOG_DIR?: string;
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
      download(path: string): Promise<{
        data: Blob | null;
        error: { message: string } | null;
      }>;
    };
  };
}

export interface ArtworkGenerationEndpointOptions {
  request: Request;
  env: ArtworkGenerationEndpointEnv;
  fetchImpl?: FetchLike;
  writeDebugLog?: ArtworkGenerationDebugLogger;
  createStorageClient?: (options: {
    supabaseUrl: string;
    supabaseAnonKey: string;
    accessToken: string;
  }) => ArtworkStorageClient;
}

const ARTWORK_BUCKET = "creative-assets";
const SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
const ARTWORK_GENERATION_CONCURRENCY = 2;

interface ImageRequestDebugLog {
  createdAt: string;
  model: string;
  directionId: string;
  request:
    | {
        endpoint: "/v1/images/generations";
        body: {
          model: string;
          prompt: string;
          n: 1;
          size: ArtworkOutputSize;
          quality: "medium";
        };
      }
    | {
        endpoint: "/v1/images/edits";
        multipartFields: {
          model: string;
          prompt: string;
          size: ArtworkOutputSize;
          images: readonly { label?: string; mimeType: string; bytes: number }[];
        };
      };
}

interface ImagePromptAgentDebugLog {
  kind: "image-prompt-agent";
  createdAt: string;
  provider: ImagePromptProvider;
  model: string;
  directionId: string;
  mode: ArtworkGenerationRequest["artworkMode"];
  status: "succeeded" | "failed";
  request: {
    endpoint: "/v1/responses" | "/api/v1/responses";
    store: false;
    inputText: string;
    referenceImages: readonly {
      label?: string;
      mimeType: string;
      bytes: number;
      detail: "high";
    }[];
    responseFormat: {
      type: "json_schema";
      name: "moons_image_generation_prompt";
      strict: true;
    };
  };
  response?: { prompt: string };
  error?: string;
}

type ArtworkGenerationDebugLog =
  | ImageRequestDebugLog
  | ImagePromptAgentDebugLog;

type ArtworkGenerationDebugLogger = (
  directory: string | undefined,
  entry: ArtworkGenerationDebugLog
) => Promise<void>;

export async function handleArtworkGenerationRequest({
  request,
  env,
  fetchImpl = fetch,
  writeDebugLog = writeImageRequestDebugLog,
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
    const promptProvider: ImagePromptProvider =
      input.imagePromptModel === "anthropic/claude-sonnet-4.6"
        ? "openrouter"
        : "openai";
    const promptApiKey =
      promptProvider === "openrouter"
        ? env.OPENROUTER_API_KEY?.trim()
        : apiKey;
    if (!promptApiKey) {
      return jsonResponse(
        { ok: false, error: "OPENROUTER_API_KEY is required." },
        500
      );
    }
    const promptModel =
      promptProvider === "openrouter"
        ? env.OPENROUTER_IMAGE_PROMPT_MODEL?.trim() || input.imagePromptModel
        : env.OPENAI_IMAGE_PROMPT_MODEL?.trim() || input.imagePromptModel;

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
      promptProvider,
      promptApiKey,
      debugLogDirectory: env.ARTWORK_GENERATION_DEBUG_LOG_DIR?.trim(),
      writeDebugLog,
      storage,
      supabaseUrl,
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
  promptProvider,
  promptApiKey,
  debugLogDirectory,
  writeDebugLog,
  storage,
  supabaseUrl,
  fetchImpl
}: {
  input: ArtworkGenerationRequest;
  apiKey: string;
  model: string;
  promptModel?: string;
  promptProvider: ImagePromptProvider;
  promptApiKey: string;
  debugLogDirectory?: string;
  writeDebugLog: ArtworkGenerationDebugLogger;
  storage: ArtworkStorageClient;
  supabaseUrl: string;
  fetchImpl: FetchLike;
}): Promise<readonly ArtworkOutput[]> {
  const references = await resolveReferenceImages(
    input.referenceImages,
    fetchImpl,
    storage,
    supabaseUrl
  );

  const format = outputFormatForService(input.service);
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
        promptProvider,
        promptApiKey,
        debugLogDirectory,
        writeDebugLog,
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
  promptProvider,
  promptApiKey,
  debugLogDirectory,
  writeDebugLog,
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
  promptProvider: ImagePromptProvider;
  promptApiKey: string;
  debugLogDirectory?: string;
  writeDebugLog: ArtworkGenerationDebugLogger;
  references: readonly ReferenceImageInput[];
  format: string;
  storage: ArtworkStorageClient;
  fetchImpl: FetchLike;
}): Promise<ArtworkOutput> {
  const prompt = await resolveImagePrompt({
    input,
    hook,
    promptModel,
    promptProvider,
    promptApiKey,
    debugLogDirectory,
    writeDebugLog,
    references,
    fetchImpl
  });
  const imagePrompt = (input.artworkMode === "design-system"
    ? [
        prompt,
        buildReferenceFidelityInstruction(references, "design-system"),
        buildConceptAlignmentInstruction(hook),
        buildDesignSystemFinalArtworkInstruction(hook)
      ]
    : input.artworkMode === "reference-library"
      ? [
          prompt,
          buildReferenceFidelityInstruction(references, "reference-library"),
          buildConceptAlignmentInstruction(hook)
        ]
      : [
          buildReferenceFidelityInstruction(references, "standard"),
          buildConceptAlignmentInstruction(hook),
          prompt
        ])
    .filter(Boolean)
    .join("\n\n");
  await writeDebugLog(
    debugLogDirectory,
    buildImageRequestDebugLog({
      model,
      hook,
      prompt: imagePrompt,
      size: input.output.size,
      references
    })
  );
  const image =
    references.length > 0
      ? await editImage({
          apiKey,
          model,
          prompt: imagePrompt,
          size: input.output.size,
          referenceImages: references,
          fetchImpl
        })
      : await generateImage({
          apiKey,
          model,
          prompt: imagePrompt,
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

function buildReferenceFidelityInstruction(
  references: readonly ReferenceImageInput[],
  mode: ArtworkGenerationRequest["artworkMode"]
): string | null {
  if (!references.length) return null;

  const referenceMap = references.map(
    (reference, index) =>
      `Image ${index + 1} — ${reference.label ?? "Reference image"}`
  );
  const hasUploadedSourceMaterials = references.some((reference) =>
    reference.label?.startsWith("Uploaded ")
  );

  return [
    "REFERENCE-INFORMED DESIGN — highest priority:",
    ...referenceMap,
    "When the attached references are from the same client account, use them as that account's design system. Carry forward their typography hierarchy and line-break rhythm, logo and CTA discipline, composition and whitespace rhythm, color relationships, material quality, and publishable level of finish.",
    mode !== "standard"
      ? "The dominant visual medium shown by the references is authoritative. If they are photographic, editorial, collage, cinematic, or typography-led, stay in that same medium family. A new execution means a new message-specific idea and composition—not replacing the reference medium with simplified isometric 3D, toy-like objects, miniature SaaS scenes, generic UI cards, or sterile product renders."
      : hasUploadedSourceMaterials
        ? "Create a distinctly new execution for this brief, but preserve and visibly use every uploaded source material according to its label. A main object or product must remain recognisable and serve the requested role; a supporting component must be integrated as a real component. For ordinary style references, invent a different composition and never copy their readable text or recognisable layout."
        : "Create a distinctly new execution for this brief. Invent a different visual metaphor, hero subject, composition, information arrangement, and layout geometry; never reproduce the reference's objects, scene, text placement, visual sequence, or recognisable layout.",
    "Do not default to translucent UI cards, floating glass objects, generic search screens, phones, or blue glow merely because the category involves AI, SEO, or technology. Use those only when they are truly the strongest new visual metaphor. Use the new brief and supplied copy; do not reproduce readable reference text, logos, or artwork."
  ].join("\n");
}

function buildConceptAlignmentInstruction(hook: SelectedHook): string {
  return [
    "CONCEPT ALIGNMENT — highest priority:",
    `Required headline: ${hook.hook}`,
    `Strategic concept: ${hook.concept}`,
    `Reason this concept works: ${hook.why}`,
    `Approved visual direction: ${hook.visual}`,
    "The hero visual and every meaningful detail must demonstrate this exact concept. Do not substitute a generic adjacent AI, SEO, paid-media, workshop, or growth idea. Library references are style guidance; uploaded source materials must be used for the role stated in their label without overriding the concept."
  ].join("\n");
}

function buildDesignSystemFinalArtworkInstruction(hook: SelectedHook): string {
  return [
    "DESIGN-SYSTEM FINAL ARTWORK CONTRACT — overrides conflicting earlier instructions:",
    "Return one fully composed, publication-ready advertisement. This workflow has no downstream typography, CTA, or logo assembly step.",
    `Render this exact headline once, clearly and prominently: “${hook.hook}”`,
    `Render this exact CTA once: “${hook.cta}”`,
    "Integrate typography as a dominant compositional element, following the attached campaign references' Thai type scale, line-break rhythm, density, alignment, and contrast.",
    "Use an attached official logo image as the authoritative logo when one is supplied; do not invent or redraw a logo.",
    "Do not create a textless base visual. Do not leave blank headline, CTA, or logo-safe zones for later assembly. Do not replace the reference medium with generic isometric 3D or miniature UI objects."
  ].join("\n");
}

function buildImageRequestDebugLog({
  model,
  hook,
  prompt,
  size,
  references
}: {
  model: string;
  hook: SelectedHook;
  prompt: string;
  size: ArtworkOutputSize;
  references: readonly ReferenceImageInput[];
}): ImageRequestDebugLog {
  return {
    createdAt: new Date().toISOString(),
    model,
    directionId: hook.id,
    request:
      references.length
        ? {
            endpoint: "/v1/images/edits",
            multipartFields: {
              model,
              prompt,
              size,
              images: references.map((reference) => ({
                ...(reference.label ? { label: reference.label } : {}),
                mimeType: reference.mimeType,
                bytes: reference.bytes.length
              }))
            }
          }
        : {
            endpoint: "/v1/images/generations",
            body: { model, prompt, n: 1, size, quality: "medium" }
          }
  };
}

async function writeImageRequestDebugLog(
  directory: string | undefined,
  entry: ArtworkGenerationDebugLog
): Promise<void> {
  if (!directory) return;

  try {
    const logDirectory = join(process.cwd(), directory);
    await mkdir(logDirectory, { recursive: true });
    const suffix = "kind" in entry ? "-image-agent" : "";
    const filename = `${entry.createdAt.replaceAll(/[:.]/g, "-")}-${safePathSegment(entry.directionId)}${suffix}.json`;
    await writeFile(
      join(logDirectory, filename),
      `${JSON.stringify(entry, null, 2)}\n`,
      "utf8"
    );
  } catch (error) {
    console.warn("Could not write artwork-generation debug log.", error);
  }
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
  fetchImpl: FetchLike,
  storage: ArtworkStorageClient,
  supabaseUrl: string
): Promise<readonly ReferenceImageInput[]> {
  return Promise.all(
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

async function resolveImagePrompt({
  input,
  hook,
  promptModel,
  promptProvider,
  promptApiKey,
  debugLogDirectory,
  writeDebugLog,
  references,
  fetchImpl
}: {
  input: ArtworkGenerationRequest;
  hook: SelectedHook;
  promptModel?: string;
  promptProvider: ImagePromptProvider;
  promptApiKey: string;
  debugLogDirectory?: string;
  writeDebugLog: ArtworkGenerationDebugLogger;
  references: readonly ReferenceImageInput[];
  fetchImpl: FetchLike;
}): Promise<string> {
  return generateImagePrompt({
    apiKey: promptApiKey,
    model: promptModel,
    provider: promptProvider,
    mode: input.artworkMode,
    fetchImpl,
    writeTrace: async (trace) => {
      await writeDebugLog(
        debugLogDirectory,
        buildImagePromptAgentDebugLog(trace, hook.id, references)
      );
    },
    input: {
      brand: input.brand,
      service: input.service,
      brief: input.brief,
      hook,
      textInputs: input.textInputs,
      referenceImageLabels: input.referenceImages.map(
        (reference) => reference.label ?? "Reference image"
      ),
      referenceImages: references.map((reference, index) => ({
        dataUrl: `data:${reference.mimeType};base64,${reference.bytes.toString("base64")}`,
        label: input.referenceImages[index]?.label ?? "Reference image"
      })),
      canvasRatio: canvasRatioFromSize(input.output.size),
      brandLibrary: {
        brand: input.brandLibrary.brand,
        products: input.brandLibrary.products
      }
    }
  });
}

function buildImagePromptAgentDebugLog(
  trace: ImagePromptAgentTrace,
  directionId: string,
  references: readonly ReferenceImageInput[]
): ImagePromptAgentDebugLog {
  return {
    kind: "image-prompt-agent",
    createdAt: trace.createdAt,
    provider: trace.provider,
    model: trace.model,
    directionId,
    mode: trace.mode,
    status: trace.status,
    request: {
      endpoint: trace.endpoint,
      store: false,
      inputText: trace.inputText,
      referenceImages: references.map((reference) => ({
        ...(reference.label ? { label: reference.label } : {}),
        mimeType: reference.mimeType,
        bytes: reference.bytes.length,
        detail: "high"
      })),
      responseFormat: {
        type: "json_schema",
        name: "moons_image_generation_prompt",
        strict: true
      }
    },
    ...(trace.responsePrompt
      ? { response: { prompt: trace.responsePrompt } }
      : {}),
    ...(trace.error ? { error: trace.error } : {})
  };
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
  const artworkMode =
    value.artworkMode === undefined
      ? "standard"
      : readString(value.artworkMode, "artworkMode");
  if (!artworkModes.includes(artworkMode as (typeof artworkModes)[number])) {
    throw new Error(
      "artworkMode must be standard, design-system, or reference-library."
    );
  }
  const imagePromptModel =
    value.imagePromptModel === undefined
      ? "gpt-5.6-terra"
      : readString(value.imagePromptModel, "imagePromptModel");
  if (
    !imagePromptModels.includes(
      imagePromptModel as (typeof imagePromptModels)[number]
    )
  ) {
    throw new Error("imagePromptModel is not supported.");
  }
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
  const outputSize = readString(output.size, "output.size");
  if (!artworkOutputSizes.includes(outputSize as ArtworkOutputSize)) {
    throw new Error("output.size is not supported.");
  }

  return {
    model: model as ArtworkGenerationRequest["model"],
    artworkMode: artworkMode as ArtworkGenerationRequest["artworkMode"],
    imagePromptModel:
      imagePromptModel as ArtworkGenerationRequest["imagePromptModel"],
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
    brandLibrary: parseBrandLibrary(value.brandLibrary),
    output: {
      size: outputSize as ArtworkGenerationRequest["output"]["size"],
      format: readString(
        output.format,
        "output.format"
      ) as ArtworkGenerationRequest["output"]["format"]
    }
  };
}

function canvasRatioFromSize(size: ArtworkOutputSize): string {
  const [widthText, heightText] = size.split("x") as [string, string];
  const width = Number(widthText);
  const height = Number(heightText);
  const divisor = greatestCommonDivisor(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
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
    category: readString(brand.category, "brand.category"),
    personality: readOptionalStringArray(brand.personality, "brand.personality"),
    colors: readOptionalStringArray(brand.colors, "brand.colors")
  };
}

function readOptionalStringArray(
  value: unknown,
  field: string
): readonly string[] {
  if (value === undefined) return [];
  return readStringArray(value, field);
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
    supportingPoints: readOptionalStringArray(
      hook.supportingPoints,
      `selectedHooks[${index}].supportingPoints`
    ),
    ...(hook.ctaActionType === undefined
      ? {}
      : {
          ctaActionType: readCtaActionType(
            hook.ctaActionType,
            `selectedHooks[${index}].ctaActionType`
          )
        }),
    ...(typeof hook.ctaDestination === "string"
      ? { ctaDestination: hook.ctaDestination }
      : {}),
    ...(typeof hook.contactLine === "string"
      ? { contactLine: hook.contactLine }
      : {}),
    caption: readString(hook.caption, `selectedHooks[${index}].caption`)
  };
}

function readCtaActionType(value: unknown, field: string): CtaActionType {
  if (
    typeof value !== "string" ||
    !ctaActionTypes.includes(value as CtaActionType)
  ) {
    throw new Error(`${field} is invalid.`);
  }
  return value as CtaActionType;
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
