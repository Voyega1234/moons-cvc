import { createClient } from "@supabase/supabase-js";
import {
  buildAlbumMasterInstruction,
  splitAlbumMaster
} from "./album-master.js";
import {
  resolveReferenceImages,
  type StoredArtworkReference
} from "./reference-images.js";
import {
  canvasRatioFromSize,
  isArtworkRevisionRequest,
  parseRequestBody,
  parseRevisionRequestBody,
  referenceCanvasRatioFromSize
} from "./artwork-request-parser.js";
import {
  compactPromptLibrary,
  compactPromptList,
  compactPromptText,
  composeImagePrompt,
  loadDesignSystemV62JudgmentPrompt,
  loadDesignSystemV6StrategyPrompt,
  loadDirectFinalArtworkPrompt,
  renderDesignSystemPromptTemplate
} from "./prompt-runtime.js";
import {
  buildActiveHumanPresenceRules,
  buildActiveInformationDensityRules,
  buildActiveOutputModeRules,
  buildCampaignArtifactRole,
  buildDesignSystemCopyPriority,
  compileNeutralWorkingBrief,
  isBrandGuidelineItem,
  isEditableBrandGuidelineItem,
  isRepeatedCampaignDirectionItem,
  selectRelevantProductOrServiceTruth,
  strategyOptionalCopyCandidates
} from "./prompt-context.js";
import {
  defaultAlbumFormatPreference,
  outputFormatForService,
  resolveAlbumFormat,
  type AlbumFormat,
  type ArtworkOutputSize
} from "../../domain/creative-run.js";
import type { Database } from "../../lib/supabase/database.types.js";
import type {
  ArtworkGenerationRequest,
  ArtworkGenerationResponse
} from "../../services/artwork-generation/openai-image-generation.js";
import { resolveConvertCakeAuthorization } from "../shared/convert-cake-auth.js";
import {
  buildStandardImagePrompt,
  generateImagePrompt,
  type ImagePromptProvider
} from "./image-prompt-agent.js";
import {
  enrichCreativeStrategy,
  type CreativeStrategyEnrichment
} from "./creative-strategy-enrichment-agent.js";
import {
  directCreativeSet,
  reviewGeneratedArtwork,
  type CreativeSetDirection
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
import {
  ARTWORK_SIGNED_URL_EXPIRES_IN_SECONDS,
  type ArtworkStorageClient
} from "./artwork-generation-types.js";
import {
  buildCreativeStrategyAgentDebugLog,
  buildDesignSystemFlowAgentDebugLog,
  buildImagePromptAgentDebugLog,
  buildImageRequestDebugBundle,
  writeImageRequestDebugLog,
  type ArtworkGenerationDebugLogger
} from "./artwork-debug-log.js";
import { persistArtworkOutput } from "./artwork-persistence.js";
import { reviseArtworkOutput } from "./artwork-revision.js";

export { buildArtworkRevisionPrompt } from "./artwork-revision.js";

export type { ArtworkStorageClient } from "./artwork-generation-types.js";

type FetchLike = typeof fetch;
type SelectedHook = ArtworkGenerationRequest["selectedHooks"][number];
type ArtworkOutput = ArtworkGenerationResponse["outputs"][number];

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

const ARTWORK_GENERATION_CONCURRENCY = 2;

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
    const imageBytes = Buffer.from(image.base64, "base64");
    const masterOutput = await persistArtworkOutput({
      input,
      hook: masterHook,
      outputId: `${hook.id}-album-master-v${assetVersion}`,
      directionId: hook.id,
      assetVersion,
      format,
      model,
      imageBytes,
      mimeType: image.mimeType,
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
          ARTWORK_SIGNED_URL_EXPIRES_IN_SECONDS
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
      subheadline: (hook.subheadline || hook.concept).trim(),
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
