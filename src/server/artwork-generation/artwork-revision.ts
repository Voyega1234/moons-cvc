import type {
  ArtworkGenerationResponse,
  ArtworkRevisionRequest
} from "../../services/artwork-generation/openai-image-generation.js";
import {
  buildImageRequestDebugBundle,
  type ArtworkGenerationDebugLogger
} from "./artwork-debug-log.js";
import type { ArtworkStorageClient } from "./artwork-generation-types.js";
import { persistArtworkOutput } from "./artwork-persistence.js";
import { composeImagePrompt } from "./prompt-runtime.js";
import { resolveReferenceImages } from "./reference-images.js";
import { editImage } from "./openai-images-client.js";
import { splitAlbumMaster } from "./album-master.js";
import { planArtworkRevision } from "./design-system-flow-agent.js";

const REVISION_PLANNING_MODEL = "openai/gpt-5.6-sol";

type ArtworkOutput = ArtworkGenerationResponse["outputs"][number];

export async function reviseArtworkOutput({
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
  fetchImpl: typeof fetch;
}): Promise<{ output: ArtworkOutput; effectiveInstructions: string }> {
  const { image, effectiveInstructions } = await generateRevisedArtwork({
    input,
    apiKey,
    model,
    debugLogDirectory,
    writeDebugLog,
    storage,
    supabaseUrl,
    fetchImpl
  });
  const hook = { id: input.directionId };
  const output = await persistArtworkOutput({
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
  return { output, effectiveInstructions };
}

export async function reviseAlbumArtworkOutputs(
  options: Parameters<typeof reviseArtworkOutput>[0]
): Promise<{
  outputs: readonly ArtworkOutput[];
  effectiveInstructions: string;
}> {
  const { input, model, storage, debugLogDirectory, writeDebugLog } = options;
  if (!input.album) throw new Error("Album revision details are required.");
  const album = input.album;
  const { image, effectiveInstructions } = await generateRevisedArtwork(
    options
  );
  const imageBytes = Buffer.from(image.base64, "base64");
  const panels = await splitAlbumMaster(imageBytes, album.format);
  const persistenceInput = {
    runId: input.runId,
    brand: { id: input.clientId }
  };
  const masterOutput = await persistArtworkOutput({
    input: persistenceInput,
    hook: { id: `${input.directionId}-album-master` },
    outputId: `${input.directionId}-album-master-v${input.assetVersion}`,
    directionId: input.directionId,
    assetVersion: input.assetVersion,
    format: input.format,
    model,
    imageBytes,
    mimeType: image.mimeType,
    storage,
    debugLogDirectory,
    writeDebugLog
  });
  const outputs = await Promise.all(
    panels.map(async (panel, index) => ({
      ...(await persistArtworkOutput({
        input: persistenceInput,
        hook: { id: `${input.directionId}-album-${panel.index}` },
        outputId:
          album.outputIds[index] ??
          `${input.directionId}-album-${panel.index}`,
        directionId: input.directionId,
        assetVersion: input.assetVersion,
        format: input.format,
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
  return { outputs, effectiveInstructions };
}

async function generateRevisedArtwork({
  input,
  apiKey,
  model,
  debugLogDirectory,
  writeDebugLog,
  storage,
  supabaseUrl,
  fetchImpl
}: Parameters<typeof reviseArtworkOutput>[0]) {
  const [sourceImage, ...additionalReferences] = await resolveReferenceImages(
    [
      {
        kind: "url",
        url: input.sourceImageUrl,
        label: "Image 1 — current artwork"
      },
      ...(input.referenceImages ?? [])
    ],
    fetchImpl,
    storage,
    supabaseUrl
  );
  if (!sourceImage) {
    throw new Error("Could not load the current artwork for revision.");
  }
  const revisionReferences = [sourceImage, ...additionalReferences];

  let effectiveInstructions = input.instructions;
  try {
    const plan = await planArtworkRevision({
      apiKey,
      model: REVISION_PLANNING_MODEL,
      provider: "openrouter",
      fetchImpl,
      image: { bytes: sourceImage.bytes, mimeType: sourceImage.mimeType },
      instructions: input.instructions
    });
    effectiveInstructions = plan.refinedInstruction;
  } catch (error) {
    console.warn(
      "Could not plan artwork revision; using the raw instructions.",
      error
    );
  }

  const prompt = composeImagePrompt([
    buildArtworkRevisionPrompt(effectiveInstructions)
  ]);
  const hook = { id: input.directionId };
  const imageRequestDebug = buildImageRequestDebugBundle({
    model,
    runId: input.runId,
    hook,
    prompt,
    size: input.output.size,
    quality: "medium",
    references: revisionReferences
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
    referenceImages: revisionReferences,
    fetchImpl
  });
  return { image, effectiveInstructions };
}
export function buildArtworkRevisionPrompt(instructions: string): string {
  const trimmed = instructions.trim();

  return [
    "Follow the user's editing request exactly.",
    "Make only the changes necessary to achieve what the user wants.",
    "Do not add, remove, or modify anything the user did not ask for.",
    "Preserve the rest of Image 1 as closely as possible.",
    "",
    `USER REQUEST:\n${trimmed}`
  ].join("\n");
}