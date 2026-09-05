import {
  emptyApprovalComments,
  emptyApprovalGate
} from "../../domain/creative-run.js";
import type { ArtworkGenerationResponse } from "../../services/artwork-generation/openai-image-generation.js";
import {
  buildImageOutputDebugBundle,
  type ArtworkGenerationDebugLogger
} from "./artwork-debug-log.js";
import { buildStoragePath } from "./artwork-paths.js";
import {
  ARTWORK_BUCKET,
  type ArtworkStorageClient
} from "./artwork-generation-types.js";

type ArtworkOutput = ArtworkGenerationResponse["outputs"][number];

export async function persistArtworkOutput({
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

  const { data: publicUrlResult } = storage.storage
    .from(ARTWORK_BUCKET)
    .getPublicUrl(assetStoragePath);

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
    assetUrl: publicUrlResult.publicUrl,
    assetStoragePath,
    assetBucket: ARTWORK_BUCKET,
    provider: "openai",
    model,
    revisionCount: Math.max(0, assetVersion - 1),
    approval: emptyApprovalGate,
    approvalComments: emptyApprovalComments
  };
}
