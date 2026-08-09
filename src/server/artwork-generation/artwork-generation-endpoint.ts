import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import {
  albumFormatPreferences,
  albumFormats,
  artworkModes,
  artworkOutputSizes,
  ctaActionTypes,
  defaultAlbumFormatPreference,
  emptyApprovalComments,
  emptyApprovalGate,
  imagePromptModels,
  outputFormatForService,
  resolveAlbumFormat,
  type AlbumFormat,
  type ArtworkOutputSize,
  type CtaActionType
} from "../../domain/creative-run.js";
import type { Database } from "../../lib/supabase/database.types.js";
import type {
  ArtworkGenerationRequest,
  ArtworkGenerationResponse,
  ArtworkRevisionRequest
} from "../../services/artwork-generation/openai-image-generation.js";
import { resolveConvertCakeAuthorization } from "../shared/convert-cake-auth.js";
import {
  buildStandardImagePrompt,
  generateImagePrompt,
  type ImagePromptProvider,
  type ImagePromptAgentTrace
} from "./image-prompt-agent.js";
import {
  enrichCreativeStrategy,
  type CreativeStrategyEnrichment,
  type CreativeStrategyEnrichmentTrace
} from "./creative-strategy-enrichment-agent.js";
import {
  directCreativeSet,
  reviewGeneratedArtwork,
  type CreativeSetDirection,
  type DesignSystemFlowTrace
} from "./design-system-flow-agent.js";
import {
  ARTWORK_REFERENCE_BUCKET,
  buildArtworkReferenceLabel,
  selectArtworkReferencePatterns
} from "./artwork-reference-library.js";
import {
  editImage,
  generateImage,
  type GeneratedImage,
  type ReferenceImageInput
} from "./openai-images-client.js";
import {
  buildSelectedHookLearningCandidates,
  isSelectedHookLearningCaptureEnabled,
  SupabaseSelectedHookLearningCandidateStore,
  type SelectedHookLearningCandidateStore
} from "./selected-hook-learning.js";

type FetchLike = typeof fetch;
type SelectedHook = ArtworkGenerationRequest["selectedHooks"][number];
type ArtworkOutput = ArtworkGenerationResponse["outputs"][number];

interface StoredArtworkReference {
  image: ReferenceImageInput;
  signedUrl: string;
}

interface DesignSystemNewFlowContext {
  lockedCampaignInput: Readonly<Record<string, unknown>>;
  setDirection: CreativeSetDirection;
}

export interface ArtworkGenerationEndpointEnv {
  OPENAI_API_KEY?: string;
  OPENAI_IMAGE_GENERATION_MODEL?: string;
  OPENAI_IMAGE_PROMPT_MODEL?: string;
  OPENAI_CREATIVE_STRATEGY_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_IMAGE_PROMPT_MODEL?: string;
  ARTWORK_GENERATION_DEBUG_LOG_DIR?: string;
  CREATIVE_LEARNING_CAPTURE_ENABLED?: string;
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
  createLearningCandidateStore?: (options: {
    supabaseUrl: string;
    supabaseAnonKey: string;
    accessToken: string;
  }) => SelectedHookLearningCandidateStore;
}

const ARTWORK_BUCKET = "creative-assets";
const SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
const ARTWORK_GENERATION_CONCURRENCY = 2;
const IMAGE_PROMPT_MAX_CHARACTERS = 32_000;
const IMAGE_PROMPT_TARGET_CHARACTERS = 30_000;

interface ImageRequestDebugLog {
  createdAt: string;
  model: string;
  runId: string;
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
          quality?: "medium";
          images: readonly {
            label?: string;
            mimeType: string;
            bytes: number;
          }[];
        };
      };
}

interface ImagePromptAgentDebugLog {
  kind: "image-prompt-agent";
  createdAt: string;
  provider: ImagePromptProvider;
  model: string;
  runId: string;
  directionId: string;
  mode: ArtworkGenerationRequest["artworkMode"];
  stage?: "production-brief";
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
      name:
        | "moons_image_generation_prompt"
        | "moons_creative_visual_concept";
      strict: true;
    };
  };
  response?: { prompt: string };
  error?: string;
}

interface CreativeStrategyAgentDebugLog {
  kind: "creative-strategy-agent";
  createdAt: string;
  provider: ImagePromptProvider;
  model: string;
  runId: string;
  directionId: string;
  status: "succeeded" | "failed";
  request: {
    endpoint: "/v1/responses" | "/api/v1/responses";
    store: false;
    inputText: string;
    responseFormat: {
      type: "json_schema";
      name: "moons_creative_strategy_enrichment";
      strict: true;
    };
  };
  response?: CreativeStrategyEnrichment;
  error?: string;
}

interface DesignSystemFlowAgentDebugLog {
  kind: "design-system-flow-agent";
  createdAt: string;
  provider: ImagePromptProvider;
  model: string;
  runId: string;
  directionId: string;
  stage: DesignSystemFlowTrace["stage"];
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
      name: "moons_creative_set_direction" | "moons_visual_quality_review";
      strict: true;
    };
  };
  response?: DesignSystemFlowTrace["response"];
  error?: string;
}

interface ImageOutputDebugLog {
  kind: "image-output";
  createdAt: string;
  model: string;
  runId: string;
  directionId: string;
  response: {
    mimeType: string;
    bytes: number;
    localFile: string;
    assetBucket: typeof ARTWORK_BUCKET;
    assetStoragePath: string;
  };
}

interface ArtworkGenerationDebugAsset {
  filename: string;
  bytes: Buffer;
}

type ArtworkGenerationDebugLog =
  | ImageRequestDebugLog
  | CreativeStrategyAgentDebugLog
  | DesignSystemFlowAgentDebugLog
  | ImagePromptAgentDebugLog
  | ImageOutputDebugLog;

type ArtworkGenerationDebugLogger = (
  directory: string | undefined,
  entry: ArtworkGenerationDebugLog,
  assets?: readonly ArtworkGenerationDebugAsset[]
) => Promise<void>;

export async function handleArtworkGenerationRequest({
  request,
  env,
  fetchImpl = fetch,
  writeDebugLog = writeImageRequestDebugLog,
  createStorageClient = defaultCreateStorageClient,
  createLearningCandidateStore = defaultCreateLearningCandidateStore
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

    const requestBody = await request.json();
    const revisionInput = isArtworkRevisionRequest(requestBody)
      ? parseRevisionRequestBody(requestBody)
      : null;
    const storage = createStorageClient({
      supabaseUrl,
      supabaseAnonKey,
      accessToken: auth.accessToken
    });

    if (revisionInput) {
      const model =
        env.OPENAI_IMAGE_GENERATION_MODEL?.trim() || revisionInput.model;
      const output = await reviseArtworkOutput({
        input: revisionInput,
        apiKey,
        model,
        debugLogDirectory: env.ARTWORK_GENERATION_DEBUG_LOG_DIR?.trim(),
        writeDebugLog,
        storage,
        supabaseUrl,
        fetchImpl
      });
      return jsonResponse({ ok: true, outputs: [output] });
    }

    const input = parseRequestBody(requestBody);
    const model = env.OPENAI_IMAGE_GENERATION_MODEL?.trim() || input.model;
    const promptProvider: ImagePromptProvider =
      input.imagePromptModel === "anthropic/claude-sonnet-4.6"
        ? "openrouter"
        : "openai";
    const promptApiKey =
      promptProvider === "openrouter"
        ? env.OPENROUTER_API_KEY?.trim()
        : apiKey;
    const requiresPromptModel =
      input.artworkMode !== "standard" &&
      input.artworkMode !== "direct-final-artwork";
    if (!promptApiKey && requiresPromptModel) {
      return jsonResponse(
        { ok: false, error: "OPENROUTER_API_KEY is required." },
        500
      );
    }
    const promptModel =
      promptProvider === "openrouter"
        ? env.OPENROUTER_IMAGE_PROMPT_MODEL?.trim() || input.imagePromptModel
        : env.OPENAI_IMAGE_PROMPT_MODEL?.trim() || input.imagePromptModel;
    const creativeStrategyModel =
      promptProvider === "openrouter"
        ? env.OPENROUTER_IMAGE_PROMPT_MODEL?.trim() || input.imagePromptModel
        : env.OPENAI_CREATIVE_STRATEGY_MODEL?.trim() || undefined;

    const outputs = await generateOutputsForSelectedHooks({
      input,
      apiKey,
      model,
      promptModel,
      promptProvider,
      promptApiKey: promptApiKey ?? apiKey,
      creativeStrategyModel,
      debugLogDirectory: env.ARTWORK_GENERATION_DEBUG_LOG_DIR?.trim(),
      writeDebugLog,
      storage,
      supabaseUrl,
      fetchImpl
    });

    if (isSelectedHookLearningCaptureEnabled(env.CREATIVE_LEARNING_CAPTURE_ENABLED)) {
      const candidates = buildSelectedHookLearningCandidates({ input, outputs });
      if (candidates.length) {
        try {
          const candidateStore = createLearningCandidateStore({
            supabaseUrl,
            supabaseAnonKey,
            accessToken: auth.accessToken
          });
          await candidateStore.upsertCandidates(candidates);
        } catch (error) {
          console.warn(
            "Could not capture selected hook learning candidates.",
            error
          );
        }
      }
    }

    return jsonResponse({ ok: true, outputs });
  } catch (error) {
    return jsonResponse({ ok: false, error: readableError(error) }, 500);
  }
}

async function reviseArtworkOutput({
  input,
  apiKey,
  model,
  debugLogDirectory,
  writeDebugLog,
  storage,
  supabaseUrl,
  fetchImpl
}: {
  input: ArtworkRevisionRequest;
  apiKey: string;
  model: string;
  debugLogDirectory?: string;
  writeDebugLog: ArtworkGenerationDebugLogger;
  storage: ArtworkStorageClient;
  supabaseUrl: string;
  fetchImpl: FetchLike;
}): Promise<ArtworkOutput> {
  const [sourceImage] = await resolveReferenceImages(
    [
      {
        kind: "url",
        url: input.sourceImageUrl,
        label: "Image 1 — current artwork"
      }
    ],
    fetchImpl,
    storage,
    supabaseUrl
  );
  if (!sourceImage) {
    throw new Error("Could not load the current artwork for revision.");
  }

  const prompt = composeImagePrompt([
    buildArtworkRevisionPrompt(input.instructions)
  ]);
  const hook = { id: input.directionId };
  const imageRequestDebug = buildImageRequestDebugBundle({
    model,
    runId: input.runId,
    hook,
    prompt,
    size: input.output.size,
    quality: "medium",
    references: [sourceImage]
  });
  await writeDebugLog(
    debugLogDirectory,
    imageRequestDebug.entry,
    imageRequestDebug.assets
  );

  const image = await editImage({
    apiKey,
    model,
    prompt,
    size: input.output.size,
    quality: "medium",
    referenceImages: [sourceImage],
    fetchImpl
  });

  return persistArtworkOutput({
    input: {
      runId: input.runId,
      brand: { id: input.clientId }
    },
    hook,
    outputId: input.outputId,
    directionId: input.directionId,
    assetVersion: input.assetVersion,
    format: input.format,
    model,
    imageBytes: Buffer.from(image.base64, "base64"),
    mimeType: image.mimeType,
    storage,
    debugLogDirectory,
    writeDebugLog
  });
}

export function buildArtworkRevisionPrompt(instructions: string): string {
  return [
    "Act as a Senior Art Director performing a meaningful enhancement of Image 1.",
    "Image 1 is the source of truth for the core advertising idea and recognizable hero visual, but its current layout and styling are not locked. The result must look visibly more considered, persuasive, and production-ready—not like the same artwork with one small patch.",
    "Treat the following creative review direction as the minimum required improvement, not the limit of what you may enhance:",
    instructions.trim(),
    "Before editing, perform an anti-AI production audit of Image 1. Look for inconsistent geometry or perspective, conflicting light direction, missing contact shadows, weak ambient occlusion, floating or pasted elements, melted edges, repeated textures, warped text or logos, implausible materials, excessive glow, generic glossy CGI, fake interface details, and decorative clutter without a visual system. Correct every visible issue that applies; do not invent defects that are not present.",
    "The finished advertisement must not look obviously AI-generated. Make it feel art-directed, composited, retouched, and finished by an experienced designer. Preserve intentional 3D or stylized art when appropriate, but replace synthetic plastic smoothness with believable material texture, controlled imperfection, coherent depth, clean edges, and purposeful graphic construction.",
    "At mobile-feed size, the revised artwork must earn the intended audience's attention within one second and strengthen rather than weaken brand perception. Create one distinctive visual or typographic hook, immediate message comprehension, recognizable brand character, and a credible reason to keep looking. Eliminate any cheap, generic, cluttered, misleading, or visibly AI-made treatment that could reduce trust; do not use sensational decoration or clickbait as a substitute for art direction.",
    "Build one plausible lighting system across the full canvas. Keep key light direction, color temperature, reflections, highlights, cast shadows, contact shadows, and ambient occlusion consistent with object position and surface. Correct scale and perspective so every element feels grounded in the same scene.",
    "Preserve the core concept, marketing intent, recognizable main visual or product, correct brand identity, essential headline meaning, and aspect ratio. Do not replace the campaign with an unrelated idea or generic template.",
    "Use professional art-direction judgment across the whole canvas. You may redesign the grid and composition; change font style, weights, line breaks, scale, alignment, and text containers; reposition, resize, crop, or refine existing elements; simplify or rewrite secondary copy; strengthen the CTA; improve lighting, depth, retouching, and graphic layering; and create a clearer visual journey.",
    "You may add relevant supporting elements when they make the advertisement feel more complete: icons, benefit modules, labels, dividers, microcopy, proof or trust strips, platform or partner elements such as Google or Meta, and brand-appropriate graphic accents. Integrate them into one coherent design system instead of pasting them into empty space.",
    "Plausible editable placeholder proof, offer details, or supporting copy may be introduced when useful for a complete social advertisement. Do not duplicate the logo, wordmark, CTA, or the same claim in multiple places, and do not create internally contradictory information.",
    "Apply Balance, Contrast, Emphasis, Movement, Dominance, Pattern, Rhythm, Unity, Variety, Proportion, Scale, and Space together with hierarchy, alignment, proximity, and grid discipline. Use empty areas intentionally, keep at least one genuine quiet zone, and judge readability at mobile-feed size. Avoid tiny text, excessive decoration, crowded edges, an oversized hero that suffocates the layout, and making every element equally loud.",
    "Make a material improvement in at least three areas such as typography, composition, hierarchy, brand presence, CTA, supporting graphics, lighting, or final finish. Return one polished, high-end, production-ready social media advertisement."
  ].join("\n\n");
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

function defaultCreateLearningCandidateStore({
  supabaseUrl,
  supabaseAnonKey,
  accessToken
}: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessToken: string;
}): SelectedHookLearningCandidateStore {
  const client = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
  return new SupabaseSelectedHookLearningCandidateStore(client);
}

async function generateOutputsForSelectedHooks({
  input,
  apiKey,
  model,
  promptModel,
  promptProvider,
  promptApiKey,
  creativeStrategyModel,
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
  creativeStrategyModel?: string;
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
  const designSystemNewFlow =
    input.artworkMode === "design-system-new"
      ? await prepareDesignSystemNewFlow({
          input,
          references,
          apiKey: promptApiKey,
          model: promptModel,
          provider: promptProvider,
          debugLogDirectory,
          writeDebugLog,
          fetchImpl
        })
      : undefined;

  const format = outputFormatForService(input.service);
  const outputGroups = await mapWithConcurrency(
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
        creativeStrategyModel,
        debugLogDirectory,
        writeDebugLog,
        references,
        designSystemNewFlow,
        format,
        storage,
        fetchImpl
      })
  );
  return outputGroups.flat();
}

async function prepareDesignSystemNewFlow({
  input,
  references,
  apiKey,
  model,
  provider,
  debugLogDirectory,
  writeDebugLog,
  fetchImpl
}: {
  input: ArtworkGenerationRequest;
  references: readonly ReferenceImageInput[];
  apiKey: string;
  model?: string;
  provider: ImagePromptProvider;
  debugLogDirectory?: string;
  writeDebugLog: ArtworkGenerationDebugLogger;
  fetchImpl: FetchLike;
}): Promise<DesignSystemNewFlowContext> {
  const lockedCampaignInput = buildLockedCampaignInput(input, references);
  const setDirection = await directCreativeSet({
    apiKey,
    model,
    provider,
    fetchImpl,
    lockedCampaignInput,
    ideas: input.selectedHooks.map((hook) => ({
      directionId: hook.id,
      headline: hook.hook,
      concept: hook.concept,
      visualDirection: hook.visual
    })),
    referenceImages: references.slice(0, 16).map((reference) => ({
      imageUrl: `data:${reference.mimeType};base64,${reference.bytes.toString("base64")}`,
      label: reference.label,
      mimeType: reference.mimeType,
      bytes: reference.bytes.length
    })),
    writeTrace: async (trace) => {
      await writeDebugLog(
        debugLogDirectory,
        buildDesignSystemFlowAgentDebugLog(
          trace,
          input.runId,
          "campaign-set"
        )
      );
    }
  });

  return { lockedCampaignInput, setDirection };
}

function buildLockedCampaignInput(
  input: ArtworkGenerationRequest,
  references: readonly ReferenceImageInput[]
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    runId: input.runId,
    brand: input.brand,
    service: input.service,
    quantity: input.quantity,
    canvas: referenceCanvasRatioFromSize(input.output.size),
    workingBrief: input.brief,
    artworkBriefAndUserCorrections: input.textInputs,
    selectedHooks: input.selectedHooks.map((hook) => ({
      directionId: hook.id,
      headline: hook.hook,
      subheadline: hook.subheadline,
      concept: hook.concept,
      reason: hook.why,
      visualDirection: hook.visual,
      supportingPoints: hook.supportingPoints ?? [],
      cta: hook.cta,
      formatBeats: hook.formatBeats ?? []
    })),
    brandMemory: input.brandMemory,
    brandLibrary: input.brandLibrary,
    selectedProductIds: input.selectedProductIds ?? [],
    attachedArtifactRoles: references
      .slice(0, 16)
      .map((reference, index) =>
        buildCampaignArtifactRole(reference, index)
      )
  });
}

async function generateOutputForHook({
  input,
  hook,
  apiKey,
  model,
  promptModel,
  promptProvider,
  promptApiKey,
  creativeStrategyModel,
  debugLogDirectory,
  writeDebugLog,
  references,
  designSystemNewFlow,
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
  creativeStrategyModel?: string;
  debugLogDirectory?: string;
  writeDebugLog: ArtworkGenerationDebugLogger;
  references: readonly ReferenceImageInput[];
  designSystemNewFlow?: DesignSystemNewFlowContext;
  format: string;
  storage: ArtworkStorageClient;
  fetchImpl: FetchLike;
}): Promise<readonly ArtworkOutput[]> {
  const isAlbum = input.service === "album-post";
  const albumFormat = resolveAlbumFormat(
    input.albumFormat ?? defaultAlbumFormatPreference,
    hook.albumFormat
  );
  const generationSize: ArtworkOutputSize = isAlbum
    ? "2048x2048"
    : input.output.size;
  const canvasRatio = canvasRatioFromSize(generationSize);
  const isDirectFinalArtwork =
    input.artworkMode === "direct-final-artwork";
  const setDirection = designSystemNewFlow?.setDirection.setDirection;
  const shotOpportunity = designSystemNewFlow?.setDirection.ideas.find(
    (idea) => idea.directionId === hook.id
  )?.shotOpportunity;
  if (
    input.artworkMode === "design-system-new" &&
    (!setDirection || !shotOpportunity)
  ) {
    throw new Error(
      `Design System (New) is missing the set direction for "${hook.id}".`
    );
  }
  let strategy: CreativeStrategyEnrichment | undefined;
  if (
    input.artworkMode === "reference-library" ||
    input.artworkMode === "design-system" ||
    input.artworkMode === "design-system-new"
  ) {
    try {
      strategy = await resolveCreativeStrategy({
        input,
        hook,
        apiKey: promptApiKey,
        model: creativeStrategyModel,
        provider: promptProvider,
        debugLogDirectory,
        writeDebugLog,
        setDirection,
        shotOpportunity,
        fetchImpl
      });
    } catch (error) {
      console.warn(
        `Creative strategy enrichment failed for "${hook.id}"; continuing without it.`,
        error
      );
    }
  }
  const artworkReferences =
    input.artworkMode === "reference-library"
      ? await resolveStoredArtworkReferences({ input, hook, strategy, storage })
      : [];
  const promptReferences = [
    ...references,
    ...artworkReferences.map(({ image }) => image)
  ];
  const generationReferences = promptReferences;
  const isDesignSystemMode =
    input.artworkMode === "design-system" ||
    input.artworkMode === "design-system-new";
  const creativeProvocation =
    isDesignSystemMode
      ? await resolveImagePrompt({
          input,
          hook,
          promptModel,
          promptProvider,
          promptApiKey,
          debugLogDirectory,
          writeDebugLog,
          references: promptReferences,
          artworkReferences,
          strategy,
          setDirection,
          shotOpportunity,
          canvasRatio,
          albumFormat,
          fetchImpl
        })
      : undefined;
  const compiledDesignSystemPrompt = isDesignSystemMode
    ? await buildDirectDesignSystemPrompt({
          input,
          hook,
          references: promptReferences,
          canvasRatio,
          albumFormat,
          strategy,
          creativeProvocation,
          setDirection,
          shotOpportunity
        })
    : undefined;
  const compiledDirectFinalArtworkPrompt = isDirectFinalArtwork
    ? await buildDirectFinalArtworkPrompt({
        input,
        hook,
        references: promptReferences,
        albumFormat
      })
    : undefined;
  const prompt =
    isDirectFinalArtwork
      ? compiledDirectFinalArtworkPrompt ?? ""
      : isDesignSystemMode
      ? compiledDesignSystemPrompt ?? ""
      : await resolveImagePrompt({
          input,
          hook,
          promptModel,
          promptProvider,
          promptApiKey,
          debugLogDirectory,
          writeDebugLog,
          references: promptReferences,
          artworkReferences,
          strategy,
          setDirection,
          shotOpportunity,
          canvasRatio,
          albumFormat,
          fetchImpl
        });
  const promptParts =
    isDirectFinalArtwork || isDesignSystemMode
      ? [prompt]
      : input.artworkMode === "reference-library"
        ? [prompt, buildReferenceLibraryImageInstruction(generationReferences)]
        : [prompt];
  if (isAlbum) {
    const assetVersion = input.assetVersion ?? 1;
    const masterPrompt = composeImagePrompt(
      promptParts,
      buildAlbumMasterInstruction(hook, albumFormat)
    );
    const masterHook = { ...hook, id: `${hook.id}-album-master` };
    const imageRequestDebug = buildImageRequestDebugBundle({
      model,
      runId: input.runId,
      hook: masterHook,
      prompt: masterPrompt,
      size: generationSize,
      quality: "medium",
      references: generationReferences
    });
    await writeDebugLog(
      debugLogDirectory,
      imageRequestDebug.entry,
      imageRequestDebug.assets
    );
    const generatedImage =
      generationReferences.length > 0
        ? await editImage({
            apiKey,
            model,
            prompt: masterPrompt,
            size: generationSize,
            quality: "medium",
            referenceImages: generationReferences,
            fetchImpl
          })
        : await generateImage({
            apiKey,
            model,
            prompt: masterPrompt,
            size: generationSize,
            fetchImpl
          });
    const image = await applyDesignSystemVisualQc({
      input,
      hook,
      image: generatedImage,
      setDirection,
      shotOpportunity,
      apiKey,
      model,
      promptModel,
      promptProvider,
      promptApiKey,
      generationSize,
      debugLogDirectory,
      writeDebugLog,
      fetchImpl
    });
    const alignedImage = await ensureFourGridMasterAlignment({
      input,
      hook,
      albumFormat,
      image,
      apiKey,
      model,
      generationSize,
      debugLogDirectory,
      writeDebugLog,
      fetchImpl
    });
    const imageBytes = Buffer.from(alignedImage.base64, "base64");
    const masterOutput = await persistArtworkOutput({
      input,
      hook: masterHook,
      outputId: `${hook.id}-album-master-v${assetVersion}`,
      directionId: hook.id,
      assetVersion,
      format,
      model,
      imageBytes,
      mimeType: alignedImage.mimeType,
      storage,
      debugLogDirectory,
      writeDebugLog
    });
    const panels = await splitAlbumMaster(imageBytes, albumFormat);
    return Promise.all(
      panels.map(async (panel) => ({
        ...(await persistArtworkOutput({
          input,
          hook: { ...hook, id: `${hook.id}-album-${panel.index}` },
          outputId: `${hook.id}-album-${panel.index}-v${assetVersion}`,
          directionId: hook.id,
          assetVersion,
          format,
          model,
          imageBytes: panel.bytes,
          mimeType: "image/png",
          storage,
          debugLogDirectory,
          writeDebugLog
        })),
        albumMasterAssetUrl: masterOutput.assetUrl,
        albumMasterAssetStoragePath: masterOutput.assetStoragePath
      }))
    );
  }

  const imagePrompt = composeImagePrompt(promptParts);
  const imageRequestDebug = buildImageRequestDebugBundle({
    model,
    runId: input.runId,
    hook,
    prompt: imagePrompt,
    size: generationSize,
    quality: "medium",
    references: generationReferences
  });
  await writeDebugLog(
    debugLogDirectory,
    imageRequestDebug.entry,
    imageRequestDebug.assets
  );
  const generatedImage =
    generationReferences.length > 0
      ? await editImage({
          apiKey,
          model,
          prompt: imagePrompt,
          size: generationSize,
          quality: "medium",
          referenceImages: generationReferences,
          fetchImpl
        })
      : await generateImage({
          apiKey,
          model,
          prompt: imagePrompt,
          size: generationSize,
          fetchImpl
        });
  const image = await applyDesignSystemVisualQc({
    input,
    hook,
    image: generatedImage,
    setDirection,
    shotOpportunity,
    apiKey,
    model,
    promptModel,
    promptProvider,
    promptApiKey,
    generationSize,
    debugLogDirectory,
    writeDebugLog,
    fetchImpl
  });

  return [
    await persistArtworkOutput({
      input,
      hook,
      outputId: `${hook.id}-v${input.assetVersion ?? 1}`,
      directionId: hook.id,
      assetVersion: input.assetVersion ?? 1,
      format,
      model,
      imageBytes: Buffer.from(image.base64, "base64"),
      mimeType: image.mimeType,
      storage,
      debugLogDirectory,
      writeDebugLog
    })
  ];
}

async function applyDesignSystemVisualQc({
  input,
  hook,
  image,
  setDirection,
  shotOpportunity,
  apiKey,
  model,
  promptModel,
  promptProvider,
  promptApiKey,
  generationSize,
  debugLogDirectory,
  writeDebugLog,
  fetchImpl
}: {
  input: ArtworkGenerationRequest;
  hook: SelectedHook;
  image: GeneratedImage;
  setDirection?: string;
  shotOpportunity?: string;
  apiKey: string;
  model: string;
  promptModel?: string;
  promptProvider: ImagePromptProvider;
  promptApiKey: string;
  generationSize: ArtworkOutputSize;
  debugLogDirectory?: string;
  writeDebugLog: ArtworkGenerationDebugLogger;
  fetchImpl: FetchLike;
}): Promise<GeneratedImage> {
  if (input.artworkMode !== "design-system-new") return image;

  const sourceBytes = Buffer.from(image.base64, "base64");
  try {
    const review = await reviewGeneratedArtwork({
      apiKey: promptApiKey,
      model: promptModel,
      provider: promptProvider,
      fetchImpl,
      image: {
        bytes: sourceBytes,
        mimeType: image.mimeType,
        label: "Generated artwork before Visual QC"
      },
      context: {
        headline: hook.hook,
        concept: hook.concept,
        setDirection: setDirection ?? "",
        shotOpportunity: shotOpportunity ?? ""
      },
      writeTrace: async (trace) => {
        await writeDebugLog(
          debugLogDirectory,
          buildDesignSystemFlowAgentDebugLog(trace, input.runId, hook.id)
        );
      }
    });
    if (review.decision === "pass") return image;

    const revisionPrompt = buildVisualQcRevisionPrompt(
      review.revisionInstruction
    );
    const sourceReference: ReferenceImageInput = {
      bytes: sourceBytes,
      mimeType: image.mimeType,
      label: "Image 1 — generated artwork to refine"
    };
    const revisionHook = { id: `${hook.id}-visual-qc-revision` };
    const imageRequestDebug = buildImageRequestDebugBundle({
      model,
      runId: input.runId,
      hook: revisionHook,
      prompt: revisionPrompt,
      size: generationSize,
      quality: "medium",
      references: [sourceReference]
    });
    await writeDebugLog(
      debugLogDirectory,
      imageRequestDebug.entry,
      imageRequestDebug.assets
    );
    return await editImage({
      apiKey,
      model,
      prompt: revisionPrompt,
      size: generationSize,
      quality: "medium",
      referenceImages: [sourceReference],
      fetchImpl
    });
  } catch (error) {
    console.warn(
      `Visual QC could not complete for "${hook.id}"; keeping the original generated artwork.`,
      error
    );
    return image;
  }
}

async function ensureFourGridMasterAlignment({
  input,
  hook,
  albumFormat,
  image,
  apiKey,
  model,
  generationSize,
  debugLogDirectory,
  writeDebugLog,
  fetchImpl
}: {
  input: ArtworkGenerationRequest;
  hook: SelectedHook;
  albumFormat: AlbumFormat;
  image: GeneratedImage;
  apiKey: string;
  model: string;
  generationSize: ArtworkOutputSize;
  debugLogDirectory?: string;
  writeDebugLog: ArtworkGenerationDebugLogger;
  fetchImpl: FetchLike;
}): Promise<GeneratedImage> {
  if (albumFormat !== "four-grid") return image;

  const sourceBytes = Buffer.from(image.base64, "base64");
  const alignment = await inspectFourGridMasterAlignment(sourceBytes);
  if (alignment.valid) return image;

  const revisionPrompt = [
    "Repair Image 1's Album grid geometry only.",
    `The detected vertical divider is at ${alignment.verticalPercent}% and the horizontal divider is at ${alignment.horizontalPercent}%.`,
    "Move both continuous dividers to the exact 50% center lines so the master contains four equal square panels in a strict two-by-two grid.",
    "Keep every existing panel in its current quadrant and preserve all intended copy, typography, objects, brand assets, colors, lighting, visual style, and campaign content.",
    "Do not rewrite, add, remove, swap, crop, or redesign any panel. Return one corrected square Album master artwork."
  ].join("\n\n");
  const sourceReference: ReferenceImageInput = {
    bytes: sourceBytes,
    mimeType: image.mimeType,
    label: "Image 1 — Album master with misaligned grid dividers"
  };
  const repairHook = { id: `${hook.id}-album-grid-repair` };
  const imageRequestDebug = buildImageRequestDebugBundle({
    model,
    runId: input.runId,
    hook: repairHook,
    prompt: revisionPrompt,
    size: generationSize,
    quality: "medium",
    references: [sourceReference]
  });
  await writeDebugLog(
    debugLogDirectory,
    imageRequestDebug.entry,
    imageRequestDebug.assets
  );
  const repairedImage = await editImage({
    apiKey,
    model,
    prompt: revisionPrompt,
    size: generationSize,
    quality: "medium",
    referenceImages: [sourceReference],
    fetchImpl
  });
  const repairedAlignment = await inspectFourGridMasterAlignment(
    Buffer.from(repairedImage.base64, "base64")
  );
  if (!repairedAlignment.valid) {
    throw new Error(
      "Album grid alignment is still invalid after one repair. Regenerate the Album before export."
    );
  }
  return repairedImage;
}

function buildVisualQcRevisionPrompt(instruction: string): string {
  return [
    "Refine Image 1 as a senior art director and retoucher.",
    "Preserve its core campaign concept, approved copy, brand identity, official assets, output ratio, and strongest working visual decisions.",
    "Apply only the following high-impact visual correction:",
    instruction.trim(),
    "Correct the issue across the whole composition so hierarchy, spacing, lighting, shadow, perspective, depth, materials, edges, and asset integration remain coherent.",
    "Do not add new facts, offers, claims, products, decorative modules, or a different campaign idea. Return one finished publication-ready artwork."
  ].join("\n\n");
}

function buildAlbumMasterInstruction(
  hook: SelectedHook,
  format: AlbumFormat
): string {
  const beats = hook.formatBeats ?? [];
  const panelInstructions =
    format === "three-horizontal" || format === "three-vertical"
      ? [
          `The dominant cover area uses the exact headline “${hook.hook}”, the main visual, and immediate brand recognition.`,
          `The first supporting area develops the story using ${beats[0] ?? "the opening supporting point"} and ${beats[1] ?? "the mechanism or proof"}.`,
          `The closing supporting area uses ${beats[2] ?? "the offer or decision moment"} and contains the album's only CTA: the exact text “${hook.cta}”.`
        ]
      : [
          `The dominant cover area uses the exact headline “${hook.hook}”, the main visual, and immediate brand recognition.`,
          `The opening supporting area develops ${beats[0] ?? "the opening supporting point"}.`,
          `The evidence supporting area develops ${beats[1] ?? "the mechanism or proof"}.`,
          `The closing supporting area uses ${beats[2] ?? "the offer or decision moment"} and contains the album's only CTA: the exact text “${hook.cta}”.`
        ];
  return [
    "ALBUM MASTER GRID - highest-priority layout instruction:",
    albumLayoutPrompt(format),
    "The prescribed layout is non-negotiable. Do not rotate it, mirror it, replace it with a top-and-bottom mosaic, or invent another grid.",
    "Render one square master artwork containing the complete album. Keep every panel inside its own rectangular area.",
    "Use subtle, straight, continuous separators so the panel boundaries remain machine-detectable. Never bend, stagger, overlap, or interrupt a separator.",
    ...panelInstructions,
    `CTA UNIQUENESS IS MANDATORY: render exactly one CTA across the entire master, located only in the closing supporting area. Do not place a CTA, button, signup banner, action strip, or duplicate of “${hook.cta}” in the cover, opening support, evidence support, header, footer, or any other area. Perform a final count before rendering: the CTA text must appear once, not twice.`,
    "Do not render sequence labels, page numbers, step numbers, or decorative numerals such as 01, 02, 03, or 04. Positional words in this instruction are structural notes only and must never become visible copy. Keep only verified dates, prices, metrics, or quantities required by the approved campaign content.",
    "Keep text, logo, CTA, faces, products, and essential proof at least 8% inside each panel boundary. Never place essential content across a separator.",
    "ONE CAMPAIGN WORLD IS MANDATORY: art-direct the complete master as one composition, not a collage of separate mini-posters. Every area must share the same brand palette, typography family, lighting logic, camera or illustration language, depth, material treatment, icon style, and production finish.",
    "Build the supporting areas as continuations or close crops of the cover's visual world. Reuse its environment, texture, motifs, shapes, and image-making technique. Controlled tonal variation is allowed within the same palette, but never switch to an unrelated background, photographic genre, illustration style, 3D material, or lighting setup.",
    "Create hierarchy through scale, crop, whitespace, and information density rather than making each area look like a different campaign."
  ].join("\n");
}

function albumLayoutPrompt(format: AlbumFormat): string {
  switch (format) {
    case "three-vertical":
      return "Use a vertical cover occupying the full left half and two equal supporting panels stacked on the right half.";
    case "three-horizontal":
      return "Use a horizontal cover occupying the full top half and two equal supporting panels side by side across the bottom half.";
    case "four-vertical":
      return "Use a large vertical cover occupying the full left two-thirds and three equal supporting panels stacked on the right one-third.";
    case "four-grid":
      return "Use exactly four equal panels in a strict two-by-two grid.";
  }
}

interface AlbumBoundaryDetection {
  vertical?: number;
  horizontal?: number;
  secondaryVertical?: number;
  secondaryHorizontal?: number;
}

interface AlbumCropRegion {
  index: 1 | 2 | 3 | 4;
  left: number;
  top: number;
  width: number;
  height: number;
  maxWidth: number;
  maxHeight: number;
}

const FOUR_GRID_ALIGNMENT_TOLERANCE = 0.02;

export async function inspectFourGridMasterAlignment(
  imageBytes: Buffer
): Promise<{
  valid: boolean;
  verticalPercent: number;
  horizontalPercent: number;
}> {
  const metadata = await sharp(imageBytes).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Could not read the generated album master dimensions.");
  }

  const side = Math.min(metadata.width, metadata.height);
  const left = Math.floor((metadata.width - side) / 2);
  const top = Math.floor((metadata.height - side) / 2);
  const analysisSize = 512;
  const pixels = await sharp(imageBytes)
    .extract({ left, top, width: side, height: side })
    .resize(analysisSize, analysisSize, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
  const boundaries = detectAlbumBoundaries({
    pixels,
    width: analysisSize,
    height: analysisSize,
    format: "four-grid"
  });
  const expected = analysisSize / 2;
  const vertical = boundaries.vertical ?? expected;
  const horizontal = boundaries.horizontal ?? expected;
  const tolerance = analysisSize * FOUR_GRID_ALIGNMENT_TOLERANCE;

  return {
    valid:
      Math.abs(vertical - expected) <= tolerance &&
      Math.abs(horizontal - expected) <= tolerance,
    verticalPercent: Number(((vertical / analysisSize) * 100).toFixed(1)),
    horizontalPercent: Number(((horizontal / analysisSize) * 100).toFixed(1))
  };
}

async function splitAlbumMaster(
  imageBytes: Buffer,
  format: AlbumFormat
): Promise<readonly { index: 1 | 2 | 3 | 4; bytes: Buffer }[]> {
  const metadata = await sharp(imageBytes).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Could not read the generated album master dimensions.");
  }

  const side = Math.min(metadata.width, metadata.height);
  const left = Math.floor((metadata.width - side) / 2);
  const top = Math.floor((metadata.height - side) / 2);
  const analysisSize = 512;
  const analysis = await sharp(imageBytes)
    .extract({ left, top, width: side, height: side })
    .resize(analysisSize, analysisSize, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
  const detected = detectAlbumBoundaries({
    pixels: analysis,
    width: analysisSize,
    height: analysisSize,
    format
  });
  const scale = side / analysisSize;
  const boundaries: AlbumBoundaryDetection = {
    ...(detected.vertical !== undefined
      ? { vertical: Math.round(detected.vertical * scale) }
      : {}),
    ...(detected.horizontal !== undefined
      ? { horizontal: Math.round(detected.horizontal * scale) }
      : {}),
    ...(detected.secondaryVertical !== undefined
      ? { secondaryVertical: Math.round(detected.secondaryVertical * scale) }
      : {}),
    ...(detected.secondaryHorizontal !== undefined
      ? { secondaryHorizontal: Math.round(detected.secondaryHorizontal * scale) }
      : {})
  };
  const regions = albumCropRegions({
    left,
    top,
    side,
    format,
    boundaries
  });

  return Promise.all(
    regions.map(async (region) => ({
      index: region.index,
      bytes: await sharp(imageBytes)
        .extract({
          left: region.left,
          top: region.top,
          width: region.width,
          height: region.height
        })
        .resize({
          width: region.maxWidth,
          height: region.maxHeight,
          fit: format === "four-grid" ? "fill" : "inside"
        })
        .png()
        .toBuffer()
    }))
  );
}

export function detectAlbumBoundaries({
  pixels,
  width,
  height,
  format
}: {
  pixels: Uint8Array;
  width: number;
  height: number;
  format: AlbumFormat;
}): AlbumBoundaryDetection {
  const vertical = (
    expected: number,
    radius: number,
    yStart = 0,
    yEnd = height
  ) =>
    findContinuousBoundary({
      pixels,
      width,
      height,
      axis: "vertical",
      expected,
      radius,
      crossStart: yStart,
      crossEnd: yEnd
    });
  const horizontal = (
    expected: number,
    radius: number,
    xStart = 0,
    xEnd = width
  ) =>
    findContinuousBoundary({
      pixels,
      width,
      height,
      axis: "horizontal",
      expected,
      radius,
      crossStart: xStart,
      crossEnd: xEnd
    });

  if (format === "three-vertical") {
    const seam = vertical(width * 0.5, width * 0.26);
    return {
      vertical: seam,
      secondaryHorizontal: horizontal(
        height * 0.5,
        height * 0.24,
        seam + 3,
        width
      )
    };
  }
  if (format === "three-horizontal") {
    const seam = horizontal(height * 0.5, height * 0.26);
    return {
      horizontal: seam,
      secondaryVertical: vertical(
        width * 0.5,
        width * 0.24,
        seam + 3,
        height
      )
    };
  }
  if (format === "four-grid") {
    return {
      vertical: vertical(width * 0.5, width * 0.24),
      horizontal: horizontal(height * 0.5, height * 0.24)
    };
  }

  const seam = vertical(width * (2 / 3), width * 0.34);
  const first = horizontal(
    height / 3,
    height * 0.17,
    seam + 3,
    width
  );
  const second = horizontal(
    height * (2 / 3),
    height * 0.17,
    seam + 3,
    width
  );
  return {
    vertical: seam,
    secondaryHorizontal:
      first < second - height * 0.12 ? first : Math.round(height / 3),
    horizontal:
      first < second - height * 0.12
        ? second
        : Math.round(height * (2 / 3))
  };
}

function findContinuousBoundary({
  pixels,
  width,
  height,
  axis,
  expected,
  radius,
  crossStart,
  crossEnd
}: {
  pixels: Uint8Array;
  width: number;
  height: number;
  axis: "vertical" | "horizontal";
  expected: number;
  radius: number;
  crossStart: number;
  crossEnd: number;
}): number {
  const axisLength = axis === "vertical" ? width : height;
  const start = Math.max(6, Math.floor(expected - radius));
  const end = Math.min(axisLength - 7, Math.ceil(expected + radius));
  const scores: { position: number; raw: number; weighted: number }[] = [];

  for (let position = start; position <= end; position += 1) {
    const gradients: number[] = [];
    const from = Math.max(2, Math.floor(crossStart));
    const to = Math.min(
      axis === "vertical" ? height - 2 : width - 2,
      Math.ceil(crossEnd)
    );
    for (let cross = from; cross < to; cross += 2) {
      let strongest = 0;
      for (let offset = -4; offset <= 3; offset += 1) {
        const first =
          axis === "vertical"
            ? pixels[cross * width + position + offset]
            : pixels[(position + offset) * width + cross];
        const second =
          axis === "vertical"
            ? pixels[cross * width + position + offset + 1]
            : pixels[(position + offset + 1) * width + cross];
        strongest = Math.max(
          strongest,
          Math.abs((first ?? 0) - (second ?? 0))
        );
      }
      gradients.push(strongest);
    }
    gradients.sort((a, b) => a - b);
    const raw = gradients[Math.floor(gradients.length * 0.4)] ?? 0;
    const proximity = 1 - 0.28 * (Math.abs(position - expected) / radius);
    scores.push({ position, raw, weighted: raw * proximity });
  }

  const best = scores.reduce(
    (current, candidate) =>
      candidate.weighted > current.weighted ? candidate : current,
    scores[0] ?? {
      position: Math.round(expected),
      raw: 0,
      weighted: 0
    }
  );
  const rawScores = scores.map((score) => score.raw).sort((a, b) => a - b);
  const median = rawScores[Math.floor(rawScores.length / 2)] ?? 0;
  if (best.raw < Math.max(4, median * 1.2)) return Math.round(expected);

  const boundaryCluster = scores.filter(
    (score) =>
      Math.abs(score.position - best.position) <= 12 &&
      score.raw >= best.raw * 0.85
  );
  return Math.round(
    boundaryCluster.reduce((sum, score) => sum + score.position, 0) /
      Math.max(1, boundaryCluster.length)
  );
}

export function albumCropRegions({
  left,
  top,
  side,
  format,
  boundaries
}: {
  left: number;
  top: number;
  side: number;
  format: AlbumFormat;
  boundaries: AlbumBoundaryDetection;
}): readonly AlbumCropRegion[] {
  const vertical = clampBoundary(boundaries.vertical, side / 2, side);
  const horizontal = clampBoundary(boundaries.horizontal, side / 2, side);

  if (format === "three-vertical") {
    const rightHorizontal = clampBoundary(
      boundaries.secondaryHorizontal,
      side / 2,
      side
    );
    return [
      cropRegion(1, left, top, vertical, side, 1920),
      cropRegion(
        2,
        left + vertical,
        top,
        side - vertical,
        rightHorizontal,
        960
      ),
      cropRegion(
        3,
        left + vertical,
        top + rightHorizontal,
        side - vertical,
        side - rightHorizontal,
        960
      )
    ];
  }
  if (format === "three-horizontal") {
    const bottomVertical = clampBoundary(
      boundaries.secondaryVertical,
      side / 2,
      side
    );
    return [
      cropRegion(1, left, top, side, horizontal, 1920),
      cropRegion(
        2,
        left,
        top + horizontal,
        bottomVertical,
        side - horizontal,
        960
      ),
      cropRegion(
        3,
        left + bottomVertical,
        top + horizontal,
        side - bottomVertical,
        side - horizontal,
        960
      )
    ];
  }
  if (format === "four-grid") {
    return [
      cropRegion(1, left, top, vertical, horizontal, 960),
      cropRegion(2, left + vertical, top, side - vertical, horizontal, 960),
      cropRegion(3, left, top + horizontal, vertical, side - horizontal, 960),
      cropRegion(
        4,
        left + vertical,
        top + horizontal,
        side - vertical,
        side - horizontal,
        960
      )
    ];
  }

  const firstHorizontal = clampBoundary(
    boundaries.secondaryHorizontal,
    side / 3,
    side
  );
  const secondHorizontal = clampBoundary(
    boundaries.horizontal,
    side * (2 / 3),
    side
  );
  return [
    cropRegion(1, left, top, vertical, side, 1920),
    cropRegion(
      2,
      left + vertical,
      top,
      side - vertical,
      firstHorizontal,
      960
    ),
    cropRegion(
      3,
      left + vertical,
      top + firstHorizontal,
      side - vertical,
      secondHorizontal - firstHorizontal,
      960
    ),
    cropRegion(
      4,
      left + vertical,
      top + secondHorizontal,
      side - vertical,
      side - secondHorizontal,
      960
    )
  ];
}

function cropRegion(
  index: AlbumCropRegion["index"],
  left: number,
  top: number,
  width: number,
  height: number,
  maxEdge: number
): AlbumCropRegion {
  return {
    index,
    left: Math.round(left),
    top: Math.round(top),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    maxWidth: maxEdge,
    maxHeight: maxEdge
  };
}

function clampBoundary(
  value: number | undefined,
  fallback: number,
  side: number
): number {
  return Math.min(
    side - 1,
    Math.max(1, Math.round(value ?? fallback))
  );
}

async function persistArtworkOutput({
  input,
  hook,
  outputId,
  directionId,
  assetVersion = 1,
  format,
  model,
  imageBytes,
  mimeType,
  storage,
  debugLogDirectory,
  writeDebugLog
}: {
  input: { runId: string; brand: { id: string } | null };
  hook: { id: string };
  outputId: string;
  directionId: string;
  assetVersion?: number;
  format: string;
  model: string;
  imageBytes: Buffer;
  mimeType: string;
  storage: ArtworkStorageClient;
  debugLogDirectory?: string;
  writeDebugLog: ArtworkGenerationDebugLogger;
}): Promise<ArtworkOutput> {
  const assetStoragePath = buildStoragePath({
    clientId: input.brand?.id ?? "unbranded",
    runId: input.runId,
    directionId: hook.id,
    assetVersion
  });
  const uploadResult = await storage.storage
    .from(ARTWORK_BUCKET)
    .upload(assetStoragePath, imageBytes, {
      contentType: mimeType,
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

  const imageOutputDebug = buildImageOutputDebugBundle({
    model,
    runId: input.runId,
    hook,
    imageBytes,
    mimeType,
    assetStoragePath
  });
  await writeDebugLog(
    debugLogDirectory,
    imageOutputDebug.entry,
    imageOutputDebug.assets
  );

  return {
    id: outputId,
    directionId,
    format,
    status: "ready",
    clientStatus: "queued",
    assetUrl: signedUrlResult.data.signedUrl,
    assetStoragePath,
    assetBucket: ARTWORK_BUCKET,
    provider: "openai",
    model,
    revisionCount: Math.max(0, assetVersion - 1),
    approval: emptyApprovalGate,
    approvalComments: emptyApprovalComments
  };
}

async function resolveCreativeStrategy({
  input,
  hook,
  apiKey,
  model,
  provider,
  debugLogDirectory,
  writeDebugLog,
  setDirection,
  shotOpportunity,
  fetchImpl
}: {
  input: ArtworkGenerationRequest;
  hook: SelectedHook;
  apiKey: string;
  model?: string;
  provider: ImagePromptProvider;
  debugLogDirectory?: string;
  writeDebugLog: ArtworkGenerationDebugLogger;
  setDirection?: string;
  shotOpportunity?: string;
  fetchImpl: FetchLike;
}): Promise<CreativeStrategyEnrichment> {
  return enrichCreativeStrategy({
    apiKey,
    model,
    provider,
    fetchImpl,
    ...(input.artworkMode === "design-system" ||
    input.artworkMode === "design-system-new"
      ? { loadPrompt: loadDesignSystemV6StrategyPrompt }
      : {}),
    input: {
      brand: input.brand,
      service: input.service,
      brief: input.brief,
      hook,
      brandMemory: input.brandMemory,
      brandLibrary: input.brandLibrary,
      setDirection,
      shotOpportunity
    },
    writeTrace: async (trace) => {
      await writeDebugLog(
        debugLogDirectory,
        buildCreativeStrategyAgentDebugLog(trace, input.runId, hook.id)
      );
    }
  });
}

async function resolveStoredArtworkReferences({
  input,
  hook,
  strategy,
  storage
}: {
  input: ArtworkGenerationRequest;
  hook: SelectedHook;
  strategy?: CreativeStrategyEnrichment;
  storage: ArtworkStorageClient;
}): Promise<readonly StoredArtworkReference[]> {
  const patterns = selectArtworkReferencePatterns({
    brandName: input.brand?.name,
    brandCategory: input.brand?.category,
    service: input.service,
    canvasRatio: referenceCanvasRatioFromSize(input.output.size),
    brief: input.brief,
    hook,
    strategy
  });
  const bucket = storage.storage.from(ARTWORK_REFERENCE_BUCKET);

  return Promise.all(
    patterns.map(async (pattern, index) => {
      const [signedUrlResult, downloadResult] = await Promise.all([
        bucket.createSignedUrl(
          pattern.storagePath,
          SIGNED_URL_EXPIRES_IN_SECONDS
        ),
        bucket.download(pattern.storagePath)
      ]);

      if (signedUrlResult.error) throw new Error(signedUrlResult.error.message);
      if (!signedUrlResult.data) {
        throw new Error(
          `Could not create a signed URL for artwork reference "${pattern.label}".`
        );
      }
      if (downloadResult.error) throw new Error(downloadResult.error.message);
      if (!downloadResult.data) {
        throw new Error(`Artwork reference "${pattern.label}" was not found.`);
      }

      return {
        signedUrl: signedUrlResult.data.signedUrl,
        image: {
          bytes: Buffer.from(await downloadResult.data.arrayBuffer()),
          mimeType: downloadResult.data.type || pattern.mimeType,
          label: buildArtworkReferenceLabel(
            pattern,
            index === 0 ? "primary" : "secondary"
          )
        }
      };
    })
  );
}

function buildReferenceLibraryImageInstruction(
  references: readonly ReferenceImageInput[]
): string {
  const roles = references.map(
    (reference, index) =>
      `Image ${index + 1}: ${compactReferenceRole(reference.label)}`
  );
  return [
    "ORIGINAL EXECUTION:",
    ...roles,
    "Study the attached Creative Compass artwork references directly. STYLE FIDELITY IS MANDATORY: the result must unmistakably remain in the primary artwork's mood, tone, and visual style family. Match its visual medium, realism level, palette relationships, contrast, lighting atmosphere, texture, material response, typography rhythm, density, layering, compositing depth, and production richness. Use the secondary artwork only for compatible craft and finish that does not create a competing style. Invent a new main visual, visual metaphor, subject, action, camera angle, background, environment, props, scene logic, and idea-specific arrangement from the approved concept. The execution must feel like the same art director and design system created a new campaign for this idea, not like a generic reskin or the model's default house style. Do not reconstruct, trace, or lightly reskin either reference's recognizable content or arrangement. Preserve attached official client assets exactly. Unless the brief or official brand system clearly requires darkness, use a bright off-white, pale neutral, or softly tinted background and keep dark brand color to accents or one contained zone. Protect 30–40% genuine low-detail negative space with one obvious quiet area; keep 8–10% outer margins; keep the main visual near 30–40% of the canvas and below half. Limit the composition to one headline, one compact proof/support group, one CTA, and one logo. Keep every generated element coherent in perspective, scale, lighting, shadows, color grade, depth, and material treatment."
  ].join("\n");
}

function compactReferenceRole(label: string | undefined): string {
  const normalized = label?.toLowerCase() ?? "";
  if (normalized.includes("creative compass artwork reference — primary")) {
    return "primary artwork reference";
  }
  if (normalized.includes("creative compass artwork reference — secondary")) {
    return "secondary artwork reference";
  }
  if (normalized.includes("past work style reference")) {
    return "past-work brand style reference";
  }
  if (/logo|โลโก้/.test(normalized)) return "official logo";
  if (/product|packshot|สินค้า/.test(normalized)) return "official product";
  if (/main object|hero object|source object/.test(normalized)) {
    return "supplied hero object";
  }
  if (/supporting component/.test(normalized)) {
    return "supplied supporting component";
  }
  return "client reference";
}

// async function buildDirectDesignSystemPrompt({
//   input,
//   hook,
//   references,
//   canvasRatio,
//   albumFormat,
//   strategy
// }: {
//   input: ArtworkGenerationRequest;
//   hook: SelectedHook;
//   references: readonly ReferenceImageInput[];
//   canvasRatio: string;
//   albumFormat: AlbumFormat;
//   strategy?: CreativeStrategyEnrichment;
// }): Promise<string> {
//   const artifactMap = references.map((reference, index) => ({
//     image: index + 1,
//     role: compactPromptText(reference.label ?? "Reference image", 180)
//   }));
//   const supportingCopy = hook.supportingPoints?.length
//     ? hook.supportingPoints
//     : ["None supplied; do not add filler copy merely to occupy space."];
//   const additionalRequirements = input.textInputs.length
//     ? input.textInputs
//     : ["None supplied."];
//   const editableGuidelineItems = input.brandLibrary.docs.filter(
//     isEditableBrandGuidelineItem
//   );
//   const derivedGuidelineItems = input.brandLibrary.brand.filter(
//     isBrandGuidelineItem
//   );
//   const guidelineItems = editableGuidelineItems.length
//     ? editableGuidelineItems
//     : derivedGuidelineItems;
//   const otherBrandItems = input.brandLibrary.brand.filter(
//     (item) => !isBrandGuidelineItem(item)
//   );
//   const otherDocumentItems = input.brandLibrary.docs.filter(
//     (item) => !isEditableBrandGuidelineItem(item)
//   );
//   const thickContext = {
//     brand: input.brand
//       ? {
//           id: compactPromptText(input.brand.id, 120),
//           name: compactPromptText(input.brand.name, 180),
//           category: compactPromptText(input.brand.category, 180),
//           personality: compactPromptList(input.brand.personality, 8, 120),
//           colors: compactPromptList(input.brand.colors, 12, 40)
//         }
//       : null,
//     brandMemory: {
//       // working: compactPromptList(input.brandMemory.working, 8, 240),
//       // avoid: compactPromptList(input.brandMemory.avoid, 8, 240)
//     },
//     brandLibrary: {
//       guidelines: compactPromptLibrary(guidelineItems, 3, 4_000),
//       brand: compactPromptLibrary(otherBrandItems, 6, 400),
//       products: compactPromptLibrary(input.brandLibrary.products, 8, 500),
//       docs: compactPromptLibrary(otherDocumentItems, 4, 280),
//       refs: compactPromptLibrary(input.brandLibrary.refs, 6, 280)
//     // },
//     // campaignContext: {
//     //   workingBrief: compactPromptText(input.brief, 1_500),
//     //   rationale: compactPromptText(hook.why, 1_000),
//     //   caption: compactPromptText(hook.caption, 1_500)
//     },
//     attachedArtifacts: artifactMap.slice(0, 16)
//   };

//   const contextJson = JSON.stringify(thickContext, null, 2);
//   const prompt = renderDesignSystemPromptTemplate(
//     await loadDesignSystemPrompt(),
//     {
//       "{{COMMERCIAL_STYLE}}": compactPromptText(
//         strategy?.commercialStyle ?? "select from the brief and brand context",
//         300
//       ),
//       "{{TREATMENT}}": compactPromptText(
//         designSystemTreatmentFor(strategy?.commercialStyle),
//         500
//       ),
//       "{{SELLING_MECHANISM}}": compactPromptText(
//         strategy?.sellingMechanism ??
//           "select the clearest approach for the message",
//         300
//       ),
//       "{{HUMAN_PRESENCE}}": compactPromptText(
//         strategy?.humanPresence ?? "avoid",
//         40
//       ),
//       "{{AUDIENCE_MOMENT}}": compactPromptText(
//         strategy?.audienceMoment ??
//           "infer conservatively from the supplied context",
//         500
//       ),
//       "{{BRAND_FIT_REASON}}": compactPromptText(
//         strategy?.reasonToBelieve ??
//           "Use the supplied brand context and artifacts as evidence.",
//         500
//       ),
//       "{{BRAND_NAME_AND_CATEGORY}}": compactPromptText(
//         `${input.brand?.name ?? "Not supplied"}${input.brand?.category ? ` — ${input.brand.category}` : ""}`,
//         360
//       ),
//       "{{OBJECTIVE}}": compactPromptText(input.brief || hook.why, 1_500),
//       "{{MAIN_MESSAGE}}": compactPromptText(hook.concept, 800),
//       "{{EXACT_HEADLINE}}": compactPromptText(hook.hook, 500),
//       "{{SUPPORTING_COPY}}": compactPromptText(
//         supportingCopy.join(" | "),
//         1_200
//       ),
//       "{{CTA}}": compactPromptText(hook.cta, 300),
//       "{{SERVICE_TYPE}}":
//         input.service === "album-post" ? "Album" : "Static",
//       "{{CANVAS}}": compactPromptText(`${canvasRatio} ${input.service}`, 120),
//       "{{ON_ARTWORK_COPY_PRIORITY}}": buildDesignSystemCopyPriority(
//         input.service,
//         hook,
//         albumFormat
//       ),
//       "{{CAPTION_CONTEXT}}": compactPromptText(
//         hook.caption || "None supplied.",
//         1_500
//       ),
//       "{{IDEA_RATIONALE}}": compactPromptText(hook.why, 1_000),
//       "{{VISUAL_DIRECTION}}": compactPromptText(hook.visual, 1_000),
//       "{{ADDITIONAL_REQUIREMENTS}}": additionalRequirements
//         .slice(0, 5)
//         .map((requirement) => `* ${compactPromptText(requirement, 500)}`)
//         .join("\n"),
//       "{{ALBUM_PANEL_COUNT}}": String(
//         albumFormat.startsWith("three-") ? 3 : 4
//       ),
//       "{{FORMAT_BEATS}}": compactPromptText(
//         hook.formatBeats?.length
//           ? hook.formatBeats.join(" | ")
//           : "Not applicable.",
//         1_000
//       ),
//       "{{THICK_CONTEXT_JSON}}": contextJson
//     }
//   );

//   return prompt;
// }
async function buildDirectDesignSystemPrompt({
  input,
  hook,
  references,
  canvasRatio,
  albumFormat,
  strategy,
  creativeProvocation,
  setDirection,
  shotOpportunity
}: {
  input: ArtworkGenerationRequest;
  hook: SelectedHook;
  references: readonly ReferenceImageInput[];
  canvasRatio: string;
  albumFormat: AlbumFormat;
  strategy?: CreativeStrategyEnrichment;
  creativeProvocation?: string;
  setDirection?: string;
  shotOpportunity?: string;
}): Promise<string> {
  /**
   * Describe only the role of each image.
   * GPT Image 2 can inspect the actual image itself, so avoid repeating
   * detailed visual descriptions that may over-bias the generation.
   */
  const artifactMap = references
    .slice(0, 16)
    .map((reference, index) => buildCampaignArtifactRole(reference, index));

  /**
   * The strategy agent has already evaluated the evidence against this idea.
   * Preserve its semantic choices instead of taking the first N hook details.
   * The final art director still decides whether any candidate belongs on-art.
   */
  const selectedSupportingCopy = strategyOptionalCopyCandidates(strategy);

  const latestCorrection =
    input.textInputs
    .map((requirement) => requirement.trim())
    .filter(Boolean)
    .at(-1);

  /**
   * Prefer editable guidelines when they exist.
   * Do not send older brand artwork as general brand context because it
   * can anchor GPT Image 2 to previous layouts and visual formulas.
   */
  const editableGuidelineItems = input.brandLibrary.docs.filter(
    isEditableBrandGuidelineItem
  );

  const derivedGuidelineItems = input.brandLibrary.brand.filter(
    isBrandGuidelineItem
  );

  const guidelineItems = editableGuidelineItems.length
    ? editableGuidelineItems
    : derivedGuidelineItems;

  /**
   * Keep only non-guideline documents as possible factual evidence.
   * Campaign brief, caption, rationale, and visual direction are not
   * duplicated inside this context.
   */
  const factualDocumentItems = input.brandLibrary.docs.filter(
    (item) =>
      !isEditableBrandGuidelineItem(item) &&
      !isRepeatedCampaignDirectionItem(item)
  );
  const relevantProductOrService = selectRelevantProductOrServiceTruth({
    input,
    hook,
    references
  });
  const workingBrief = compileNeutralWorkingBrief({
    brief: input.brief || hook.why,
    references,
    relevantProductOrService
  });

  /**
   * This is now an Image Truth Context rather than a Thick Creative Context.
   *
   * It contains:
   * - verified brand identity
   * - relevant restrictions
   * - official guidelines
   * - product truth
   * - factual documents
   * - attached-image roles
   *
   * It intentionally excludes:
   * - campaign brief duplication
   * - caption
   * - rationale
   * - AI-generated visual direction
   * - previous brand artwork
   * - brandMemory.working visual patterns
   */
  const imageTruthContext = {
    brand: input.brand
      ? {
          name: compactPromptText(input.brand.name, 180),
          personality: compactPromptList(
            input.brand.personality,
            2,
            60
          ),
          colors: compactPromptList(
            input.brand.colors,
            6,
            40
          )
        }
      : null,

    brandLibrary: {
      /**
       * Keep guidelines concise. Sending several thousand characters per
       * file can introduce unrelated history, voice, examples, and layout
       * references into the image prompt.
       */
      guidelines: compactPromptLibrary(
        guidelineItems,
        2,
        800
      ),

      /**
       * Ideally input.brandLibrary.products should already contain only
       * the products selected for this campaign.
       *
       * This cap prevents GPT Image 2 from turning a single-product
       * campaign into a product-lineup or marketplace layout.
       */
      relevantProductOrService: compactPromptLibrary(
        relevantProductOrService,
        relevantProductOrService.length,
        320
      ),

      /**
       * Keep documents only as concise factual support.
       */
      verifiedFacts: compactPromptLibrary(
        factualDocumentItems,
        2,
        180
      )
    }
  };

  const contextJson = JSON.stringify(
    imageTruthContext,
    null,
    2
  );

  const legacyCompiledCampaignContext = [
    "### Strategic intent",
    [
      "Selling mechanism:",
      compactPromptText(
        strategy?.sellingMechanism ??
          "Select the clearest selling approach from the campaign message.",
        180
      )
    ].join("\n"),
    [
      "Audience moment:",
      compactPromptText(
        strategy?.audienceMoment ??
          "Infer conservatively from the campaign brief and audience context.",
        260
      )
    ].join("\n"),
    "These strategic inputs describe intent only. They do not prescribe the visual solution.",
    ...(setDirection
      ? [
          "### Campaign set direction",
          compactPromptText(setDirection, 1_200),
          "Keep this shared campaign grammar while allowing this idea to use a genuinely distinct execution."
        ]
      : []),
    ...(shotOpportunity
      ? [
          "### Per-idea shot opportunity",
          compactPromptText(shotOpportunity, 1_200),
          "Treat this as the strongest opening to explore, not as fixed coordinates or a rigid layout blueprint."
        ]
      : []),
    "### Creative provocation",
    creativeProvocation?.trim() ||
      "No creative provocation was supplied. Infer conservatively from the authoritative campaign context.",
    "Use this as an imaginative starting point, not a prescribed layout or production blueprint. Freely transform it when a stronger visual execution communicates the campaign more effectively. It does not authorize invented facts, copy, products, or claims.",
    "### Brand",
    [
      `- Name: ${compactPromptText(input.brand?.name ?? "Not supplied", 180)}`,
      `- Category: ${compactPromptText(input.brand?.category ?? "Not supplied", 180)}`
    ].join("\n"),
    "### Working Brief",
    [
      "Business problem and communication objective:",
      workingBrief
    ].join("\n"),
    ["Main message:", compactPromptText(hook.concept, 600)].join("\n"),
    [
      "Offer and product handling:",
      "Make the core offer or value proposition clear. When a supplied physical product matters to the campaign, preserve and use it accurately. For services, express the value through a campaign-specific idea without presenting an invented interface or object as a factual product."
    ].join("\n"),
    "### Mandatory on-artwork copy",
    `- Exact headline: “${compactPromptText(hook.hook, 500)}”`,
    hook.cta.trim()
      ? `- Mandatory CTA: “${compactPromptText(hook.cta, 300)}”`
      : "- Mandatory CTA: None supplied.",
    artifactMap.some((artifact) => artifact.kind === "official-logo")
      ? "- Official brand identification: use the supplied official logo once and preserve it exactly."
      : "- Official brand identification: preserve supplied brand identity; do not invent a logo.",
    "- Other mandatory legal, promotional, event, price, date, or contact details: only those explicitly required by the Working Brief or latest user correction.",
    "### Approved optional content pool",
    [
      selectedSupportingCopy.length
        ? selectedSupportingCopy
            .map(({ role, text }) =>
              [
                `- Strategy-selected ${role} candidate:`,
                `  “${compactPromptText(
                  text,
                  input.service === "album-post" ? 800 : 400
                )}”`
              ].join("\n")
            )
            .join("\n")
        : "- None supplied.",
      "",
      "Role labels above are instructions and must never be rendered as artwork copy.",
      "The strategy agent selected these candidates; the final art director must still decide whether each one materially improves the artwork.",
      "Choose a coherent information structure: no supporting copy, one plain supporting sentence, or a genuine list of at least two distinct items.",
      "Never give a single supporting sentence a checkbox, bullet, divider, numbered-step, or list-row treatment.",
      "Omit redundant information when the visual already communicates it.",
      "Omit any candidate that merely repeats the headline or CTA.",
      "Supporting content is optional unless explicitly marked mandatory."
    ].join("\n"),
    "### Information density intent",
    "infer from the Working Brief",
    "This controls how much approved information may be useful. It does not prescribe layout, zones, hero placement, typography placement, visual metaphor, or composition.",
    [
      "Canvas:",
      compactPromptText(`${canvasRatio} ${input.service}`, 120)
    ].join("\n"),
    [
      "Campaign content rules:",
      buildDesignSystemCopyPriority()
    ].join("\n"),
    [
      "Latest user correction:",
      latestCorrection
        ? compactPromptText(latestCorrection, 4_000)
        : "None supplied."
    ].join("\n"),
    "### Brand and relevant product or service truth",
    contextJson,
    "Use the JSON only as factual context. Do not display it in the artwork.",
    "### Attached artifact roles",
    artifactMap.length
      ? JSON.stringify(artifactMap, null, 2)
      : "No artifacts supplied."
  ].join("\n\n");

  const prompt = renderDesignSystemPromptTemplate(
    await loadDesignSystemV62JudgmentPrompt(),
    {
      "{{COMPILED_CAMPAIGN_CONTEXT}}": legacyCompiledCampaignContext,
      "{{ACTIVE_HUMAN_PRESENCE_RULES}}":
        buildActiveHumanPresenceRules(undefined),
      "{{ACTIVE_INFORMATION_DENSITY_RULES}}":
        buildActiveInformationDensityRules(undefined),
      "{{ACTIVE_OUTPUT_MODE_RULES}}": buildActiveOutputModeRules(
        input.service,
        hook,
        albumFormat
      )
    }
  );

  return prompt;
}

async function buildDirectFinalArtworkPrompt({
  input,
  hook,
  references,
  albumFormat
}: {
  input: ArtworkGenerationRequest;
  hook: SelectedHook;
  references: readonly ReferenceImageInput[];
  albumFormat: AlbumFormat;
}): Promise<string> {
  const ideaJson = JSON.stringify(
    {
      Hook: hook.hook.trim(),
      subheadline: (hook.subheadline === undefined
        ? hook.concept
        : hook.subheadline
      ).trim(),
      "Supporting points (one per line)": (hook.supportingPoints ?? [])
        .map((point) => point.trim())
        .filter(Boolean),
      CTA: hook.cta.trim()
    },
    null,
    2
  );
  const guidelineItems = [
    ...input.brandLibrary.docs.filter(isEditableBrandGuidelineItem),
    ...input.brandLibrary.brand.filter(isBrandGuidelineItem)
  ];
  const guidelineIds = new Set(
    guidelineItems.map((item) => item.id).filter(Boolean)
  );
  const brandContext = {
    brand: input.brand
      ? {
          name: input.brand.name,
          category: input.brand.category,
          personality: input.brand.personality,
          colors: input.brand.colors
        }
      : null,
    guidelines: guidelineItems.map((item) => ({
      ...(item.id ? { id: item.id } : {}),
      title: item.title,
      description: item.description
    })),
    brandRules: input.brandLibrary.brand
      .filter(
        (item) =>
          !isBrandGuidelineItem(item) &&
          (!item.id || !guidelineIds.has(item.id))
      )
      .map((item) => ({
        ...(item.id ? { id: item.id } : {}),
        title: item.title,
        description: item.description
      })),
    selectedProductOrService: selectRelevantProductOrServiceTruth({
      input,
      hook,
      references
    }),
    brandMemory: input.brandMemory
  };
  const artworkBrief = input.textInputs
    .map((requirement) => requirement.trim())
    .filter(Boolean)
    .join("\n\n");
  const artifactMap = references
    .slice(0, 16)
    .map((reference, index) => buildCampaignArtifactRole(reference, index));

  return renderDesignSystemPromptTemplate(
    await loadDirectFinalArtworkPrompt(),
    {
      "{{DIRECT_IDEA_JSON}}": ideaJson,
      // Keep the complete context, but avoid spending the provider's prompt
      // budget on JSON indentation. The mandatory artwork brief is positioned
      // before this larger block in the template so prompt fitting cannot
      // remove it with lower-priority context.
      "{{BRAND_CONTEXT_JSON}}": JSON.stringify(brandContext),
      "{{ARTWORK_BRIEF}}": artworkBrief || "None supplied.",
      "{{ATTACHED_ARTIFACT_ROLES}}": artifactMap.length
        ? JSON.stringify(artifactMap)
        : "No artifacts supplied.",
      "{{ACTIVE_OUTPUT_MODE_RULES}}": buildActiveOutputModeRules(
        input.service,
        hook,
        albumFormat
      )
    }
  );
}

function strategyOptionalCopyCandidates(
  strategy: CreativeStrategyEnrichment | undefined
): readonly {
  role: "proof" | "differentiator" | "offer";
  text: string;
}[] {
  if (!strategy) return [];

  const candidates = [
    ...strategy.proof.map((claim) => ({
      role: "proof" as const,
      text: claim.text
    })),
    {
      role: "differentiator" as const,
      text: strategy.differentiator.text
    },
    { role: "offer" as const, text: strategy.offer.text }
  ];
  const seen = new Set<string>();

  return candidates
    .map((candidate) => ({ ...candidate, text: candidate.text.trim() }))
    .filter((candidate) => {
      const key = candidate.text.toLocaleLowerCase();
      if (!candidate.text || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function buildActiveHumanPresenceRules(
  mode: CreativeStrategyEnrichment["humanPresence"] | undefined
): string {
  switch (mode) {
    case "avoid":
      return "Do not use people, faces, bodies, portraits, or hands. Build the concept through products, objects, typography, materials, architecture, environments, or graphic systems.";
    case "supporting":
      return "People may provide context, scale, interaction, or emotion, but they must remain clearly subordinate to the dominant message and hero system.";
    case "essential":
      return "Human presence is essential to the campaign. A person may become the hero when the message depends on human emotion, care, treatment, hospitality, teaching, physical experience, lifestyle, or interpersonal service.";
    default:
      return "Infer whether human presence materially improves the campaign message. Do not add people merely as decoration, but do not prohibit people by default.";
  }
}

export function buildActiveInformationDensityRules(
  density: "low" | "medium" | "high" | undefined
): string {
  const shared = [
    "Information density is a ceiling, never a target. Do not fill available space simply because more verified facts exist.",
    "Maintain one obvious first read, one dominant hero, and at least one genuine quiet zone.",
    "Never repeat the same claim, price, compatibility statement, benefit, or CTA."
  ];

  switch (density) {
    case "low":
      return [
        "Low information-density rules:",
        ...shared,
        "Show the mandatory headline, brand identification, and supplied CTA. Add at most one short supporting point only when it materially improves comprehension.",
        "Do not add feature grids, icon rows, compatibility lists, service bars, or multiple badges."
      ].join("\n");
    case "high":
      return [
        "High information-density rules:",
        ...shared,
        "Use no more than two compact supporting modules and no more than three distinct supporting facts across the entire artwork.",
        "High density permits required information; it does not require every verified fact to appear. Group mandatory utility copy quietly and keep the CTA secondary."
      ].join("\n");
    case "medium":
    default:
      return [
        "Medium information-density rules:",
        ...shared,
        "Use at most one compact supporting group containing no more than two distinct supporting points.",
        "Prefer omission over shrinking text, adding another badge, or building a bottom utility strip."
      ].join("\n");
  }
}

function buildActiveOutputModeRules(
  service: ArtworkGenerationRequest["service"],
  hook: SelectedHook,
  albumFormat: AlbumFormat
): string {
  if (service !== "album-post") {
    return [
      "Static artwork rules:",
      "- Create one complete artwork in the requested canvas.",
      "- Make the message clear at mobile-feed size.",
      "- Use one dominant visual idea and a deliberate reading order.",
      "- Deliver one finished composition without alternate layouts or multiple design options."
    ].join("\n");
  }

  const panelCount = albumFormat.startsWith("three-") ? 3 : 4;
  const formatBeats = hook.formatBeats?.length
    ? compactPromptText(hook.formatBeats.join(" | "), 1_000)
    : "Not supplied.";
  return [
    "Album master rules:",
    "- Create one master artwork at 2048 × 2048.",
    `- Use the selected ${albumFormat} structure with ${panelCount} clearly separated panels.`,
    "- Treat every panel as part of one consistent campaign world.",
    "- Place the primary headline on the cover panel.",
    "- Use the CTA once, on the closing panel.",
    "- Keep important text, faces, logos, products, and focal objects away from panel seams.",
    "- Make every panel independently readable while preserving visual continuity across the master.",
    "- Keep typography, color logic, lighting, materials, and image treatment consistent.",
    "- Do not add page numbers, step numbers, or decorative sequence labels.",
    `- Distribute these story beats across the panels: ${formatBeats}`
  ].join("\n");
}

interface CampaignArtifactRole {
  image: number;
  kind: "official-logo" | "official-product" | "style-reference" | "reference";
  role: string;
  instruction: string;
}

function buildCampaignArtifactRole(
  reference: ReferenceImageInput,
  index: number
): CampaignArtifactRole {
  const role = compactPromptText(reference.label ?? "Reference image", 180);
  const normalized = role.toLowerCase();
  if (/logo|โลโก้/.test(normalized)) {
    return {
      image: index + 1,
      kind: "official-logo",
      role,
      instruction:
        "This is an official logo asset only. Preserve its identity. Do not use it as a style, composition, lighting, spatial-density, or visual-treatment reference."
    };
  }
  if (/product|packshot|สินค้า/.test(normalized)) {
    return {
      image: index + 1,
      kind: "official-product",
      role,
      instruction:
        "This is an official product asset. Preserve its visible identity and use it only for the product role stated in the label."
    };
  }
  if (/· style ·|style reference|past work style/.test(normalized)) {
    return {
      image: index + 1,
      kind: "style-reference",
      role,
      instruction:
        "Use this image only for its stated style-reference role. Do not copy its campaign content."
    };
  }
  return {
    image: index + 1,
    kind: "reference",
    role,
    instruction:
      "Use this image only for the role stated in its label. Do not infer unrelated style or campaign facts."
  };
}

function selectRelevantProductOrServiceTruth({
  input,
  hook,
  references
}: {
  input: ArtworkGenerationRequest;
  hook: SelectedHook;
  references: readonly ReferenceImageInput[];
}): readonly ArtworkGenerationRequest["brandLibrary"]["products"][number][] {
  const products = input.brandLibrary.products;
  if (input.selectedProductIds !== undefined) {
    const selectedIds = new Set(input.selectedProductIds);
    return products.filter(
      (product) => product.id && selectedIds.has(product.id)
    );
  }
  if (products.length <= 1) return products;

  const productArtifactText = references
    .filter((reference) =>
      /product|packshot|สินค้า/i.test(reference.label ?? "")
    )
    .map((reference) => reference.label ?? "")
    .join(" ");
  const campaignTokens = meaningfulCampaignTokens(
    [
      input.brief,
      hook.hook,
      hook.concept,
      hook.cta,
      ...(hook.supportingPoints ?? []),
      productArtifactText
    ].join(" ")
  );
  const ranked = products
    .map((product, index) => ({
      product,
      index,
      score:
        overlapScore(meaningfulCampaignTokens(product.title), campaignTokens, 4) +
        overlapScore(
          meaningfulCampaignTokens(product.description),
          campaignTokens,
          1
        )
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const best = ranked[0];
  if (!best || best.score < 4) return [];
  if (ranked[1]?.score === best.score) return [];
  return [best.product];
}

const CAMPAIGN_RELEVANCE_STOP_WORDS = new Set([
  "about",
  "actual",
  "advertising",
  "agency",
  "brand",
  "campaign",
  "client",
  "create",
  "from",
  "into",
  "marketing",
  "offer",
  "product",
  "service",
  "that",
  "their",
  "this",
  "through",
  "with",
  "และ",
  "การ",
  "ของ",
  "ให้",
  "ที่",
  "ใน"
]);

function meaningfulCampaignTokens(value: string): ReadonlySet<string> {
  const tokens = value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(
    tokens
      .map(normalizeCampaignToken)
      .filter(
        (token) =>
          token.length >= 3 && !CAMPAIGN_RELEVANCE_STOP_WORDS.has(token)
      )
  );
}

function normalizeCampaignToken(token: string): string {
  if (!/^[a-z]+$/.test(token) || token.length < 5) return token;
  if (token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

function overlapScore(
  candidates: ReadonlySet<string>,
  campaignTokens: ReadonlySet<string>,
  weight: number
): number {
  let score = 0;
  for (const token of candidates) {
    if (campaignTokens.has(token)) score += weight;
  }
  return score;
}

function compileNeutralWorkingBrief({
  brief,
  references,
  relevantProductOrService
}: {
  brief: string;
  references: readonly ReferenceImageInput[];
  relevantProductOrService: readonly ArtworkGenerationRequest["brandLibrary"]["products"][number][];
}): string {
  const hasPhysicalProductArtifact = references.some((reference) =>
    /product|packshot|สินค้า/i.test(reference.label ?? "")
  );
  const hasServiceTruth = relevantProductOrService.some((item) =>
    /agency|consult|service|workshop|บริการ|เอเจนซี่/i.test(
      `${item.title} ${item.description}`
    )
  );
  if (hasPhysicalProductArtifact || (!hasServiceTruth && relevantProductOrService.length)) {
    return compactPromptText(brief, 1_200);
  }

  return compactPromptText(
    brief
      .replace(
        /\bshow the product in the first visual beat\b/gi,
        "make the core offer or value proposition visually clear in the first visual beat"
      )
      .replace(
        /\bshow the product early\b/gi,
        "make the core offer or value proposition visually clear early"
      )
      .replace(
        /\bprove the product difference\b/gi,
        "make the core offer or value proposition credible"
      ),
    1_200
  );
}

function isBrandGuidelineItem(item: { title: string }): boolean {
  return item.title.toLowerCase().replace(/[^a-z0-9]+/g, "") ===
    "brandciguideline";
}

function isEditableBrandGuidelineItem(item: { title: string }): boolean {
  return item.title.toLowerCase().replace(/[^a-z0-9]+/g, "") ===
    "brandguideline";
}

function isRepeatedCampaignDirectionItem(item: { title: string }): boolean {
  const title = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return [
    "campaignbrief",
    "caption",
    "rationale",
    "idearationale",
    "visualdirection"
  ].includes(title);
}

function buildDesignSystemCopyPriority(): string {
  return [
    "Render mandatory on-artwork copy once.",
    "Treat optional content as source material and include only what materially improves understanding, persuasion, or required execution.",
    "Let the visual earn first attention; use copy to confirm and sharpen the message.",
    "Choose the information architecture freely for the campaign's actual communication job.",
    "Rank and group information so the intended reading order is clear.",
    "Every visible element must earn its place. Never invent unsupported facts, claims, statistics, offers, certifications, partners, or product functions."
  ].join("\n");
}

function compactPromptLibrary(
  items: readonly { id?: string; title: string; description: string }[],
  maxItems: number,
  maxDescriptionCharacters: number
) {
  return items.slice(0, maxItems).map((item) => ({
    ...(item.id ? { id: item.id } : {}),
    title: compactPromptText(item.title, 140),
    description: compactPromptText(
      item.description,
      maxDescriptionCharacters
    )
  }));
}

function compactPromptList(
  values: readonly string[],
  maxItems: number,
  maxCharacters: number
): readonly string[] {
  return values
    .slice(0, maxItems)
    .map((value) => compactPromptText(value, maxCharacters));
}

function compactPromptText(value: string, maxCharacters: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxCharacters) return clean;
  return `${clean.slice(0, Math.max(0, maxCharacters - 1)).trimEnd()}…`;
}

function composeImagePrompt(
  parts: readonly (string | null | undefined)[],
  protectedSuffix?: string
): string {
  const body = parts.filter(Boolean).join("\n\n");
  const suffix = protectedSuffix?.trim();
  const separator = suffix ? "\n\n" : "";
  const fullPrompt = `${body}${separator}${suffix ?? ""}`;
  if (fullPrompt.length <= IMAGE_PROMPT_TARGET_CHARACTERS) {
    return fullPrompt;
  }

  const bodyBudget =
    IMAGE_PROMPT_TARGET_CHARACTERS -
    separator.length -
    (suffix?.length ?? 0);
  if (bodyBudget < 1_000) {
    throw new Error(
      `Required image instructions exceed the provider prompt limit (${fullPrompt.length}/${IMAGE_PROMPT_MAX_CHARACTERS}).`
    );
  }
  return `${truncatePromptPreservingEnds(body, bodyBudget)}${separator}${suffix ?? ""}`;
}

function truncatePromptPreservingEnds(
  prompt: string,
  maxCharacters: number
): string {
  if (prompt.length <= maxCharacters) return prompt;
  const marker =
    "\n\n[Lower-priority reference context was shortened to fit the image provider limit. Preserve the working brief, exact approved copy, official assets, and final requirements.]\n\n";
  const available = Math.max(0, maxCharacters - marker.length);
  const prefixLength = Math.floor(available * 0.64);
  const suffixLength = available - prefixLength;
  return `${prompt.slice(0, prefixLength).trimEnd()}${marker}${prompt
    .slice(prompt.length - suffixLength)
    .trimStart()}`;
}

function loadDesignSystemV62JudgmentPrompt(): Promise<string> {
  return readFile(
    join(
      process.cwd(),
      "agent_prompt",
      "versions",
      "2026-07-30-design-system-v6.2-judgment",
      "prompts",
      "03-design-system-v6.2-judgment.md"
    ),
    "utf8"
  );
}

function loadDirectFinalArtworkPrompt(): Promise<string> {
  return readFile(
    join(
      process.cwd(),
      "agent_prompt",
      "versions",
      "2026-07-30-direct-final-artwork-v1",
      "prompts",
      "01-direct-final-artwork-v1.md"
    ),
    "utf8"
  );
}

function loadDesignSystemV6StrategyPrompt(): Promise<string> {
  return readFile(
    join(
      process.cwd(),
      "agent_prompt",
      "versions",
      "2026-07-28-chol-static-03-v6",
      "prompts",
      "01-strategy-enrichment.exact.md"
    ),
    "utf8"
  );
}

function renderDesignSystemPromptTemplate(
  source: string,
  replacements: Readonly<Record<string, string>>
): string {
  const template = source.trim();
  if (!template) {
    throw new Error("The active Design System prompt is empty.");
  }

  const missingMarkers = Object.keys(replacements).filter(
    (marker) => !template.includes(marker)
  );
  if (missingMarkers.length) {
    throw new Error(
      `The active Design System prompt is missing required markers: ${missingMarkers.join(", ")}`
    );
  }

  let rendered = template;
  for (const [marker, content] of Object.entries(replacements)) {
    rendered = rendered.replaceAll(marker, content);
  }

  const unresolvedMarker = rendered.match(
    /\{\{[^{}]+\}\}|\{(?:brand|hook)\.[^{}]+\}|\{(?:commercialStyle|sellingMechanism|audienceMoment|reasonToBelieve|canvasRatio|service|additional user requirements)[^{}]*\}/
  )?.[0];
  if (unresolvedMarker) {
    throw new Error(
      `The active Design System prompt contains an unresolved marker: ${unresolvedMarker}`
    );
  }

  return rendered;
}

function buildImageRequestDebugBundle({
  model,
  runId,
  hook,
  prompt,
  size,
  quality,
  references
}: {
  model: string;
  runId: string;
  hook: { id: string };
  prompt: string;
  size: ArtworkOutputSize;
  quality?: "medium";
  references: readonly ReferenceImageInput[];
}): {
  entry: ImageRequestDebugLog;
  assets: readonly ArtworkGenerationDebugAsset[];
} {
  const createdAt = new Date().toISOString();

  return {
    entry: {
      createdAt,
      model,
      runId,
      directionId: hook.id,
      request:
        references.length
          ? {
              endpoint: "/v1/images/edits",
              multipartFields: {
                model,
                prompt,
                size,
                ...(quality ? { quality } : {}),
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
    },
    assets: []
  };
}

function buildImageOutputDebugBundle({
  model,
  runId,
  hook,
  imageBytes,
  mimeType,
  assetStoragePath
}: {
  model: string;
  runId: string;
  hook: { id: string };
  imageBytes: Buffer;
  mimeType: string;
  assetStoragePath: string;
}): {
  entry: ImageOutputDebugLog;
  assets: readonly ArtworkGenerationDebugAsset[];
} {
  const createdAt = new Date().toISOString();
  const filename = `${debugFileStem(createdAt, runId, hook.id)}-output.${extensionFromMimeType(mimeType)}`;
  return {
    entry: {
      kind: "image-output",
      createdAt,
      model,
      runId,
      directionId: hook.id,
      response: {
        mimeType,
        bytes: imageBytes.length,
        localFile: filename,
        assetBucket: ARTWORK_BUCKET,
        assetStoragePath
      }
    },
    assets: [{ filename, bytes: imageBytes }]
  };
}

function debugFileStem(
  createdAt: string,
  runId: string,
  directionId: string
): string {
  return [
    createdAt.replaceAll(/[:.]/g, "-"),
    safePathSegment(runId),
    safePathSegment(directionId)
  ].join("-");
}

function extensionFromMimeType(mimeType: string): "jpg" | "webp" | "png" {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function debugLogSuffix(entry: ArtworkGenerationDebugLog): string {
  if (!("kind" in entry)) return "";
  if (entry.kind === "creative-strategy-agent") return "-strategy-agent";
  if (entry.kind === "design-system-flow-agent") {
    return `-${entry.stage}`;
  }
  if (
    entry.kind === "image-prompt-agent" &&
    entry.stage === "production-brief"
  ) {
    return "-production-brief-agent";
  }
  return entry.kind === "image-prompt-agent" ? "-image-agent" : "-image-output";
}

async function writeImageRequestDebugLog(
  directory: string | undefined,
  entry: ArtworkGenerationDebugLog,
  assets: readonly ArtworkGenerationDebugAsset[] = []
): Promise<void> {
  if (!directory) return;

  try {
    const logDirectory = join(process.cwd(), directory);
    await mkdir(logDirectory, { recursive: true });
    const filename = `${debugFileStem(entry.createdAt, entry.runId, entry.directionId)}${debugLogSuffix(entry)}.json`;
    await Promise.all([
      writeFile(
        join(logDirectory, filename),
        `${JSON.stringify(entry, null, 2)}\n`,
        "utf8"
      ),
      ...assets.map((asset) =>
        writeFile(join(logDirectory, asset.filename), asset.bytes)
      )
    ]);
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
  const resolved = await Promise.all(
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

  return Promise.all(resolved.map(normalizeReferenceImageForOpenAI));
}

export async function normalizeReferenceImageForOpenAI(
  reference: ReferenceImageInput
): Promise<ReferenceImageInput> {
  const mimeType = reference.mimeType.toLowerCase();
  if (mimeType !== "image/jpeg" && mimeType !== "image/jpg") return reference;

  try {
    return {
      ...reference,
      bytes: await sharp(reference.bytes, { failOn: "error" })
        .rotate()
        .toColourspace("srgb")
        .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
        .toBuffer(),
      mimeType: "image/jpeg"
    };
  } catch {
    throw new Error(
      `Reference image "${reference.label ?? "Untitled"}" is not a valid JPEG. Re-export it as an RGB JPEG or PNG and try again.`
    );
  }
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
  artworkReferences,
  strategy,
  setDirection,
  shotOpportunity,
  canvasRatio,
  albumFormat,
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
  artworkReferences: readonly StoredArtworkReference[];
  strategy?: CreativeStrategyEnrichment;
  setDirection?: string;
  shotOpportunity?: string;
  canvasRatio: string;
  albumFormat: AlbumFormat;
  fetchImpl: FetchLike;
}): Promise<string> {
  const imagePromptInput = {
    brand: input.brand,
    service: input.service,
    albumFormat,
    brief: input.brief,
    hook,
    textInputs: input.textInputs,
    referenceImageLabels: references.map(
      (reference) => reference.label ?? "Reference image"
    ),
    referenceImages: references.map((reference, index) => ({
      imageUrl:
        artworkReferences.find(({ image }) => image === reference)?.signedUrl ??
        `data:${reference.mimeType};base64,${reference.bytes.toString("base64")}`,
      label:
        reference.label ??
        input.referenceImages[index]?.label ??
        "Reference image"
    })),
    canvasRatio,
    strategy,
    setDirection,
    shotOpportunity,
    brandLibrary: {
      brand: input.brandLibrary.brand,
      products: input.brandLibrary.products,
      docs: input.brandLibrary.docs,
      refs: input.brandLibrary.refs
    },
    selectedProductIds: input.selectedProductIds
  };

  if (input.artworkMode === "standard") {
    return buildStandardImagePrompt(imagePromptInput);
  }

  return generateImagePrompt({
    apiKey: promptApiKey,
    model: promptModel,
    provider: promptProvider,
    mode: input.artworkMode,
    fetchImpl,
    writeTrace: async (trace) => {
      await writeDebugLog(
        debugLogDirectory,
        buildImagePromptAgentDebugLog(
          trace,
          input.runId,
          hook.id,
          references
        )
      );
    },
    input: imagePromptInput
  });
}

function buildCreativeStrategyAgentDebugLog(
  trace: CreativeStrategyEnrichmentTrace,
  runId: string,
  directionId: string
): CreativeStrategyAgentDebugLog {
  return {
    kind: "creative-strategy-agent",
    createdAt: trace.createdAt,
    provider: trace.provider,
    model: trace.model,
    runId,
    directionId,
    status: trace.status,
    request: {
      endpoint: trace.endpoint,
      store: false,
      inputText: trace.inputText,
      responseFormat: {
        type: "json_schema",
        name: "moons_creative_strategy_enrichment",
        strict: true
      }
    },
    ...(trace.response ? { response: trace.response } : {}),
    ...(trace.error ? { error: trace.error } : {})
  };
}

function buildDesignSystemFlowAgentDebugLog(
  trace: DesignSystemFlowTrace,
  runId: string,
  directionId: string
): DesignSystemFlowAgentDebugLog {
  return {
    kind: "design-system-flow-agent",
    createdAt: trace.createdAt,
    provider: trace.provider,
    model: trace.model,
    runId,
    directionId,
    stage: trace.stage,
    status: trace.status,
    request: {
      endpoint: trace.endpoint,
      store: false,
      inputText: trace.inputText,
      referenceImages: trace.referenceImages.map((reference) => ({
        ...reference,
        detail: "high"
      })),
      responseFormat: {
        type: "json_schema",
        name:
          trace.stage === "set-creative-direction"
            ? "moons_creative_set_direction"
            : "moons_visual_quality_review",
        strict: true
      }
    },
    ...(trace.response ? { response: trace.response } : {}),
    ...(trace.error ? { error: trace.error } : {})
  };
}

function buildImagePromptAgentDebugLog(
  trace: ImagePromptAgentTrace,
  runId: string,
  directionId: string,
  references: readonly ReferenceImageInput[]
): ImagePromptAgentDebugLog {
  return {
    kind: "image-prompt-agent",
    createdAt: trace.createdAt,
    provider: trace.provider,
    model: trace.model,
    runId,
    directionId,
    mode: trace.mode,
    ...(trace.stage ? { stage: trace.stage } : {}),
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
        name:
          trace.mode === "design-system" ||
          trace.mode === "design-system-new"
              ? "moons_creative_visual_concept"
            : "moons_image_generation_prompt",
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
  directionId,
  assetVersion = 1
}: {
  clientId: string;
  runId: string;
  directionId: string;
  assetVersion?: number;
}): string {
  return [
    safePathSegment(clientId),
    safePathSegment(runId),
    "outputs",
    `${safePathSegment(directionId)}-v${assetVersion}.png`
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

function isArtworkRevisionRequest(
  value: unknown
): value is Record<string, unknown> {
  return isRecord(value) && value.requestType === "artwork-revision";
}

function parseRevisionRequestBody(value: unknown): ArtworkRevisionRequest {
  if (!isArtworkRevisionRequest(value)) {
    throw new Error("Invalid artwork revision request.");
  }

  const output = readRecord(value.output, "output");
  const outputSize = readString(output.size, "output.size");
  if (!artworkOutputSizes.includes(outputSize as ArtworkOutputSize)) {
    throw new Error("output.size is not supported.");
  }
  if (readString(output.format, "output.format") !== "png") {
    throw new Error("output.format must be png.");
  }

  const instructions = readString(value.instructions, "instructions").trim();
  if (!instructions) {
    throw new Error("Revision instructions are required.");
  }

  return {
    requestType: "artwork-revision",
    model: readString(value.model, "model") as ArtworkRevisionRequest["model"],
    clientId: readString(value.clientId, "clientId"),
    runId: readString(value.runId, "runId"),
    outputId: readString(value.outputId, "outputId"),
    directionId: readString(value.directionId, "directionId"),
    assetVersion:
      value.assetVersion === undefined
        ? 2
        : readPositiveInteger(value.assetVersion, "assetVersion"),
    format: readString(value.format, "format"),
    sourceImageUrl: readString(value.sourceImageUrl, "sourceImageUrl"),
    instructions,
    output: { size: outputSize as ArtworkOutputSize, format: "png" }
  };
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
      "artworkMode must be standard, design-system, design-system-new, direct-final-artwork, or reference-library."
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
  const albumFormat =
    value.albumFormat === undefined
      ? defaultAlbumFormatPreference
      : readString(value.albumFormat, "albumFormat");
  if (
    !albumFormatPreferences.includes(
      albumFormat as (typeof albumFormatPreferences)[number]
    )
  ) {
    throw new Error("albumFormat is not supported.");
  }
  const runId = readString(value.runId, "runId");
  const assetVersion =
    value.assetVersion === undefined
      ? 1
      : readPositiveInteger(value.assetVersion, "assetVersion");
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
    albumFormat: albumFormat as ArtworkGenerationRequest["albumFormat"],
    runId,
    assetVersion,
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
    ...(value.selectedProductIds === undefined
      ? {}
      : {
          selectedProductIds: readStringArray(
            value.selectedProductIds,
            "selectedProductIds"
          )
        }),
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

function parseBrandMemory(
  value: unknown
): ArtworkGenerationRequest["brandMemory"] {
  if (!isRecord(value)) return { working: [], avoid: [] };
  return {
    working: readOptionalStringArray(value.working, "brandMemory.working"),
    avoid: readOptionalStringArray(value.avoid, "brandMemory.avoid")
  };
}

function canvasRatioFromSize(size: ArtworkOutputSize): string {
  const [widthText, heightText] = size.split("x") as [string, string];
  const width = Number(widthText);
  const height = Number(heightText);
  const divisor = greatestCommonDivisor(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function referenceCanvasRatioFromSize(
  size: ArtworkOutputSize
): "1:1" | "4:5" | "16:9" {
  if (size === "1024x1024") return "1:1";
  return size === "1024x1536" || size === "1088x1360" ? "4:5" : "16:9";
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
): readonly { id?: string; title: string; description: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .filter(
      (item) =>
        typeof item.title === "string" && typeof item.description === "string"
    )
    .map((item) => ({
      ...(typeof item.id === "string" ? { id: item.id } : {}),
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
    ...(typeof hook.subheadline === "string"
      ? { subheadline: hook.subheadline }
      : {}),
    concept: readString(hook.concept, `selectedHooks[${index}].concept`),
    why: readString(hook.why, `selectedHooks[${index}].why`),
    visual: readString(hook.visual, `selectedHooks[${index}].visual`),
    cta: readString(hook.cta, `selectedHooks[${index}].cta`),
    supportingPoints: readOptionalStringArray(
      hook.supportingPoints,
      `selectedHooks[${index}].supportingPoints`
    ),
    formatBeats: readOptionalStringArray(
      hook.formatBeats,
      `selectedHooks[${index}].formatBeats`
    ),
    ...(hook.albumFormat === undefined
      ? {}
      : {
          albumFormat: readConcreteAlbumFormat(
            hook.albumFormat,
            `selectedHooks[${index}].albumFormat`
          )
        }),
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

function readConcreteAlbumFormat(
  value: unknown,
  field: string
): AlbumFormat {
  if (
    typeof value !== "string" ||
    !albumFormats.includes(value as AlbumFormat)
  ) {
    throw new Error(`${field} is invalid.`);
  }
  return value as AlbumFormat;
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

function readPositiveInteger(value: unknown, field: string): number {
  const number = readNumber(value, field);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return number;
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
