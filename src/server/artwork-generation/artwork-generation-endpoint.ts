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
  ARTWORK_REFERENCE_BUCKET,
  buildArtworkReferenceLabel,
  isArtworkPatternReference,
  selectArtworkReferencePatterns
} from "./artwork-reference-library.js";
import {
  editImage,
  generateImage,
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
            localFile: string;
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

interface CreativeStrategyAgentDebugLog {
  kind: "creative-strategy-agent";
  createdAt: string;
  model: string;
  runId: string;
  directionId: string;
  status: "succeeded" | "failed";
  request: {
    endpoint: "/v1/responses";
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
    const usesImagePromptAgent = input.artworkMode !== "design-system";
    const promptApiKey =
      promptProvider === "openrouter"
        ? env.OPENROUTER_API_KEY?.trim()
        : apiKey;
    if (usesImagePromptAgent && !promptApiKey) {
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
      env.OPENAI_CREATIVE_STRATEGY_MODEL?.trim() || undefined;

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
        format,
        storage,
        fetchImpl
      })
  );
  return outputGroups.flat();
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
  const strategy =
    input.artworkMode === "reference-library" ||
    input.artworkMode === "design-system"
      ? await resolveCreativeStrategy({
          input,
          hook,
          apiKey,
          model: creativeStrategyModel,
          debugLogDirectory,
          writeDebugLog,
          fetchImpl
        })
      : undefined;
  const artworkReferences =
    input.artworkMode === "reference-library"
      ? await resolveStoredArtworkReferences({ input, hook, strategy, storage })
      : [];
  const promptReferences = [
    ...references,
    ...artworkReferences.map(({ image }) => image)
  ];
  const generationReferences = promptReferences;
  const prompt =
    input.artworkMode === "design-system"
      ? await buildDirectDesignSystemPrompt({
          input,
          hook,
          references: promptReferences,
          canvasRatio,
          albumFormat,
          strategy
        })
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
          canvasRatio,
          albumFormat,
          fetchImpl
        });
  const promptParts =
    input.artworkMode === "design-system"
      ? [prompt]
      : input.artworkMode === "reference-library"
        ? [prompt, buildReferenceLibraryImageInstruction(generationReferences)]
        : [
            buildReferenceFidelityInstruction(promptReferences, "standard"),
            buildConceptAlignmentInstruction(hook),
            prompt
          ];
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
    const image =
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
  const image =
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
          fit: "inside"
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
  debugLogDirectory,
  writeDebugLog,
  fetchImpl
}: {
  input: ArtworkGenerationRequest;
  hook: SelectedHook;
  apiKey: string;
  model?: string;
  debugLogDirectory?: string;
  writeDebugLog: ArtworkGenerationDebugLogger;
  fetchImpl: FetchLike;
}): Promise<CreativeStrategyEnrichment> {
  return enrichCreativeStrategy({
    apiKey,
    model,
    fetchImpl,
    input: {
      brand: input.brand,
      service: input.service,
      brief: input.brief,
      hook,
      brandMemory: input.brandMemory,
      brandLibrary: input.brandLibrary
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

function buildReferenceFidelityInstruction(
  references: readonly ReferenceImageInput[],
  mode: ArtworkGenerationRequest["artworkMode"]
): string | null {
  if (!references.length) return null;

  const artworkPatternReferences = references.filter(
    isArtworkPatternReference
  );
  const clientReferences = references.filter(
    (reference) => !isArtworkPatternReference(reference)
  );
  const pastWorkStyleReferences = clientReferences.filter((reference) =>
    reference.label?.toLowerCase().includes("past work style reference")
  );
  const selectedStyleReferences = clientReferences.filter((reference) => {
    const label = reference.label?.toLowerCase() ?? "";
    return label.includes("· style ·") ||
      label.includes("style reference") ||
      label.includes("past work style reference");
  });
  const referenceMap = references.map(
    (reference, index) =>
      `Image ${index + 1} — ${reference.label ?? "Reference image"}`
  );
  const hasUploadedSourceMaterials = clientReferences.some((reference) =>
    reference.label?.startsWith("Uploaded ")
  );
  const hasRevisionBase = clientReferences.some((reference) =>
    reference.label?.toLowerCase().includes("current artwork to revise")
  );

  return [
    "REFERENCE-INFORMED DESIGN — highest priority:",
    ...referenceMap,
    ...(clientReferences.length
      ? [
          "Use supplied client references as that account's design system. Carry forward their typography hierarchy and line-break rhythm, logo and CTA discipline, composition and whitespace rhythm, color relationships, material quality, and publishable level of finish."
        ]
      : []),
    ...(selectedStyleReferences.length
      ? [
          "STYLE FIDELITY IS MANDATORY: the finished artwork must unmistakably belong to the same mood, tone, and visual style family as the primary selected style reference. Match its visual medium and realism level, emotional temperature, palette relationships, contrast, lighting atmosphere, material response, texture, typography rhythm, density, negative-space behavior, layering, compositing depth, graphic-device language, and production richness. Supporting style references may refine only compatible details; never average them into a different generic style. Adapt the subject, hero action, visual metaphor, setting, and composition to the approved idea while keeping the reference's recognizable style system. The result should feel like the same art director created a new campaign execution for this idea, not like the model returned to its default house style."
        ]
      : []),
    ...(pastWorkStyleReferences.length
      ? [
          "PAST-WORK VISUAL DNA: The images labeled Past work style reference are approved examples of this brand's own visual language. Inspect the actual images and infer recurring traits: minimal versus dense composition, premium versus playful mood, photographic/CGI/illustrative medium, font genre and perceived luxury, type width and weight, headline scale and line-break rhythm, preferred Thai/English/mixed language behavior, casing, spacing, grid, palette roles, lighting, material treatment, graphic devices, CTA behavior, and finish. Apply the compatible visual DNA to the new idea so it feels designed by the same brand. Exact approved headline and CTA language still win; use the learned language behavior mainly for supporting copy and typographic styling. Do not copy the past work's main visual, people, products, background, props, readable copy, campaign identity, or recognizable layout."
        ]
      : []),
    ...(artworkPatternReferences.length
      ? [
          "The image labeled as a Creative Compass artwork reference is the selected primary execution blueprint from the complete 72-artwork catalog and the minimum visible craft standard. Faithfully carry forward its zone geometry, layout engine, hierarchy, visual medium, hero share and crop, lighting logic, density, layering, texture, compositing depth, CTA/logo behavior, and finish. Treat typography conditionally: preserve compatible font genre, width, weight, scale ratios, line-break rhythm, alignment, containers, emphasis, and effects while using a brand-appropriate typeface. Replace the source brand, product, people, readable copy, offer, and campaign identity with the approved runtime content."
        ]
      : []),
    mode !== "standard"
      ? "The dominant visual medium and compatible construction shown by the selected reference are authoritative. If it is photographic, editorial, collage, cinematic, or typography-led, stay in that same medium family and comparable production richness. A new execution means a faithful content-and-brand adaptation inside that design construction—not an unrelated composition, simplified isometric 3D, toy-like objects, miniature SaaS scene, generic UI cards, or sterile product render."
      : hasRevisionBase
        ? "The image labeled Current artwork to revise is the revision base. Preserve its verified product identity, brand identity, approved message, and strongest working elements. Apply the supplied revision instructions precisely to the diagnosed areas, improving composition, hierarchy, retouching, copy, CTA, and finish where requested. Do not repeat diagnosed defects and do not invent unsupported claims, prices, offers, logos, or product details."
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
    "The hero visual and every meaningful detail must demonstrate this exact concept. Do not substitute a generic adjacent AI, SEO, paid-media, workshop, or growth idea. When a Creative Compass artwork reference is supplied, use it as the execution blueprint while mapping this approved concept into its structural roles. Uploaded source materials must be used for the role stated in their label."
  ].join("\n");
}

async function buildDirectDesignSystemPrompt({
  input,
  hook,
  references,
  canvasRatio,
  albumFormat,
  strategy
}: {
  input: ArtworkGenerationRequest;
  hook: SelectedHook;
  references: readonly ReferenceImageInput[];
  canvasRatio: string;
  albumFormat: AlbumFormat;
  strategy?: CreativeStrategyEnrichment;
}): Promise<string> {
  const artifactMap = references.map((reference, index) => ({
    image: index + 1,
    role: compactPromptText(reference.label ?? "Reference image", 180)
  }));
  const supportingCopy = hook.supportingPoints?.length
    ? hook.supportingPoints
    : ["None supplied; do not add filler copy merely to occupy space."];
  const additionalRequirements = input.textInputs.length
    ? input.textInputs
    : ["None supplied."];
  const editableGuidelineItems = input.brandLibrary.docs.filter(
    isEditableBrandGuidelineItem
  );
  const derivedGuidelineItems = input.brandLibrary.brand.filter(
    isBrandGuidelineItem
  );
  const guidelineItems = editableGuidelineItems.length
    ? editableGuidelineItems
    : derivedGuidelineItems;
  const otherBrandItems = input.brandLibrary.brand.filter(
    (item) => !isBrandGuidelineItem(item)
  );
  const otherDocumentItems = input.brandLibrary.docs.filter(
    (item) => !isEditableBrandGuidelineItem(item)
  );
  const thickContext = {
    brand: input.brand
      ? {
          id: compactPromptText(input.brand.id, 120),
          name: compactPromptText(input.brand.name, 180),
          category: compactPromptText(input.brand.category, 180),
          personality: compactPromptList(input.brand.personality, 8, 120),
          colors: compactPromptList(input.brand.colors, 12, 40)
        }
      : null,
    brandMemory: {
      working: compactPromptList(input.brandMemory.working, 8, 240),
      avoid: compactPromptList(input.brandMemory.avoid, 8, 240)
    },
    brandLibrary: {
      guidelines: compactPromptLibrary(guidelineItems, 3, 4_000),
      brand: compactPromptLibrary(otherBrandItems, 6, 400),
      products: compactPromptLibrary(input.brandLibrary.products, 8, 500),
      docs: compactPromptLibrary(otherDocumentItems, 4, 280),
      refs: compactPromptLibrary(input.brandLibrary.refs, 6, 280)
    },
    campaignContext: {
      workingBrief: compactPromptText(input.brief, 1_500),
      rationale: compactPromptText(hook.why, 1_000),
      caption: compactPromptText(hook.caption, 1_500)
    },
    attachedArtifacts: artifactMap.slice(0, 16)
  };

  const contextJson = JSON.stringify(thickContext, null, 2);
  const prompt = renderDesignSystemPromptTemplate(
    await loadDesignSystemPrompt(),
    {
      "{{COMMERCIAL_STYLE}}": compactPromptText(
        strategy?.commercialStyle ?? "select from the brief and brand context",
        300
      ),
      "{{TREATMENT}}": compactPromptText(
        designSystemTreatmentFor(strategy?.commercialStyle),
        500
      ),
      "{{SELLING_MECHANISM}}": compactPromptText(
        strategy?.sellingMechanism ??
          "select the clearest approach for the message",
        300
      ),
      "{{HUMAN_PRESENCE}}": compactPromptText(
        strategy?.humanPresence ?? "avoid",
        40
      ),
      "{{AUDIENCE_MOMENT}}": compactPromptText(
        strategy?.audienceMoment ??
          "infer conservatively from the supplied context",
        500
      ),
      "{{BRAND_FIT_REASON}}": compactPromptText(
        strategy?.reasonToBelieve ??
          "Use the supplied brand context and artifacts as evidence.",
        500
      ),
      "{{BRAND_NAME_AND_CATEGORY}}": compactPromptText(
        `${input.brand?.name ?? "Not supplied"}${input.brand?.category ? ` — ${input.brand.category}` : ""}`,
        360
      ),
      "{{OBJECTIVE}}": compactPromptText(input.brief || hook.why, 1_500),
      "{{MAIN_MESSAGE}}": compactPromptText(hook.concept, 800),
      "{{EXACT_HEADLINE}}": compactPromptText(hook.hook, 500),
      "{{SUPPORTING_COPY}}": compactPromptText(
        supportingCopy.join(" | "),
        1_200
      ),
      "{{CTA}}": compactPromptText(hook.cta, 300),
      "{{CANVAS}}": compactPromptText(`${canvasRatio} ${input.service}`, 120),
      "{{ON_ARTWORK_COPY_PRIORITY}}": buildDesignSystemCopyPriority(
        input.service,
        hook,
        albumFormat
      ),
      "{{ADDITIONAL_REQUIREMENTS}}": additionalRequirements
        .slice(0, 5)
        .map((requirement) => `* ${compactPromptText(requirement, 500)}`)
        .join("\n"),
      "{{THICK_CONTEXT_JSON}}": contextJson
    }
  );

  return prompt;
}

function isBrandGuidelineItem(item: { title: string }): boolean {
  return item.title.toLowerCase().replace(/[^a-z0-9]+/g, "") ===
    "brandciguideline";
}

function isEditableBrandGuidelineItem(item: { title: string }): boolean {
  return item.title.toLowerCase().replace(/[^a-z0-9]+/g, "") ===
    "brandguideline";
}

function buildDesignSystemCopyPriority(
  service: ArtworkGenerationRequest["service"],
  hook: SelectedHook,
  albumFormat: AlbumFormat
): string {
  const supportingOptions =
    hook.supportingPoints?.filter((point) => point.trim()) ?? [];
  const lines = [
    `Render the exact headline once: “${compactPromptText(hook.hook, 500)}”`,
    supportingOptions.length
      ? `Select the smallest useful combination from these evidence-backed supporting options. You may use multiple short items when they make the artwork more complete, but omit anything redundant with the visual: ${compactPromptText(supportingOptions.join(" | "), 1_000)}`
      : "Create concise supporting or offer copy only when it closes a product-recognition, persuasion, trust, or action gap.",
    `Use the supplied logo and the CTA “${compactPromptText(hook.cta, 300)}”.`,
    "Build a cohesive secondary-information group that feels complete without becoming dense. It may combine a product or service descriptor, relevant benefits or proof, and a useful action detail.",
    "Complete the ad unit rather than filling the image like a standalone poster. Check Identification, Persuasion, and Action; count information already supplied by the visual and surrounding platform UI.",
    "For paid social or Meta, do not repeat page identity or contact merely because space is available. For standalone, organic, downloadable, or reshared artwork, a compact self-contained contact path may be useful.",
    "You may add plausible editable mockup details such as a date, price, discount, page name, LINE handle, URL, phone number, urgency note, or contact line when they genuinely complete this ad. Use brand-derived, obviously replaceable contact formats rather than invented real personal details."
  ];
  if (service === "album-post" && hook.formatBeats?.length) {
    lines.push(
      `Album story beats must be distributed across the ${albumFormat.startsWith("three-") ? "three" : "four"} clearly separated panels in the selected ${albumFormat} master grid: ${compactPromptText(hook.formatBeats.join(" | "), 1_000)}. Keep every panel independently readable and keep all essential content away from the separators.`
    );
  }
  return lines.join("\n");
}

function compactPromptLibrary(
  items: readonly { title: string; description: string }[],
  maxItems: number,
  maxDescriptionCharacters: number
) {
  return items.slice(0, maxItems).map((item) => ({
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

function loadDesignSystemPrompt(): Promise<string> {
  return readFile(
    join(process.cwd(), "agent_prompt", "agent_design_system.md"),
    "utf8"
  );
}

function renderDesignSystemPromptTemplate(
  source: string,
  replacements: Readonly<Record<string, string>>
): string {
  const template = source.trim();
  if (!template) {
    throw new Error("agent_design_system.md is empty.");
  }

  const missingMarkers = Object.keys(replacements).filter(
    (marker) => !template.includes(marker)
  );
  if (missingMarkers.length) {
    throw new Error(
      `agent_design_system.md is missing required markers: ${missingMarkers.join(", ")}`
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
      `agent_design_system.md contains an unresolved marker: ${unresolvedMarker}`
    );
  }

  return rendered;
}

function designSystemTreatmentFor(
  style: CreativeStrategyEnrichment["commercialStyle"] | undefined
): string {
  switch (style) {
    case "minimal":
      return "Restrained and immediately clear; let one strong real visual and disciplined typography carry the message.";
    case "lifestyle":
      return "Human, natural, and relatable; show the product or benefit inside a believable lived moment.";
    case "premium":
      return "Refined and desirable through art direction, material quality, crop, lighting, and restraint—not a generic black-and-gold treatment.";
    case "promotion":
      return "Energetic, urgent, and exciting with decisive contrast and a clearly visible offer, while keeping mobile hierarchy controlled rather than crowded.";
    case "infographic":
      return "Explain the idea visually through one clear diagram, comparison, or evidence structure; remain image-led and avoid turning the artwork into a dense slide.";
    case "social-proof":
      return "Build trust through supplied evidence, authentic human context, or recognizable proof; never invent a real reviewer or certification.";
    case "story":
      return "Create one specific, visually legible tension or transformation that the viewer understands without reading a paragraph. Do not assume that the story needs a human protagonist.";
    case "playful":
      return "Use expressive color, scale, rhythm, and surprise appropriate to the brand while keeping the focal message unmistakable.";
    default:
      return "Choose the content behavior and emotional energy that best fit this specific message and brand.";
  }
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
  const fileStem = debugFileStem(createdAt, runId, hook.id);
  const assets = references.map((reference, index) => ({
    filename: `${fileStem}-input-${String(index + 1).padStart(2, "0")}.${extensionFromMimeType(reference.mimeType)}`,
    bytes: reference.bytes
  }));

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
                images: references.map((reference, index) => ({
                  ...(reference.label ? { label: reference.label } : {}),
                  mimeType: reference.mimeType,
                  bytes: reference.bytes.length,
                  localFile: assets[index]!.filename
                }))
              }
            }
          : {
              endpoint: "/v1/images/generations",
              body: { model, prompt, n: 1, size, quality: "medium" }
            }
    },
    assets
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
  artworkReferences,
  strategy,
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
  canvasRatio: string;
  albumFormat: AlbumFormat;
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
        buildImagePromptAgentDebugLog(
          trace,
          input.runId,
          hook.id,
          references
        )
      );
    },
    input: {
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
      brandLibrary: {
        brand: input.brandLibrary.brand,
        products: input.brandLibrary.products,
        docs: input.brandLibrary.docs,
        refs: input.brandLibrary.refs
      }
    }
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
    model: trace.model,
    runId,
    directionId,
    status: trace.status,
    request: {
      endpoint: "/v1/responses",
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
  return size === "1024x1536" ? "4:5" : "16:9";
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
