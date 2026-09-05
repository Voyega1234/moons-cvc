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
}): Promise<ArtworkOutput> {
  const image = await generateRevisedArtwork({
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

export async function reviseAlbumArtworkOutputs(
  options: Parameters<typeof reviseArtworkOutput>[0]
): Promise<readonly ArtworkOutput[]> {
  const { input, model, storage, debugLogDirectory, writeDebugLog } = options;
  if (!input.album) throw new Error("Album revision details are required.");
  const album = input.album;
  const image = await generateRevisedArtwork(options);
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
  return Promise.all(
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
    references: revisionReferences
  });
  await writeDebugLog(
    debugLogDirectory,
    imageRequestDebug.entry,
    imageRequestDebug.assets
  );

  return editImage({
    apiKey,
    model,
    prompt,
    size: input.output.size,
    quality: "medium",
    referenceImages: revisionReferences,
    fetchImpl
  });
}

export function buildArtworkRevisionPrompt(instructions: string): string {
  const trimmed = instructions.trim();
  return [
    "IMPORTANT RULE — STRICT EDIT ONLY: Apply ONLY the change(s) described below to Image 1 (the current artwork). Do not add, remove, restyle, recolor, or move any other element. Every part of Image 1 not explicitly mentioned in the instructions — layout, text, logo, colors, background, product, and composition — must remain pixel-identical to the original.",
    `Requested change: ${trimmed}`
  ].join("\n\n");
}
