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
  // Direction IDs can be reused across a run (e.g. after hooks are
  // regenerated), which can make two unrelated generations land on the same
  // {directionId}-v{assetVersion}.png storage path. Upsert then overwrites
  // that file with new bytes, but the URL is unchanged, so the browser (and
  // any CDN) keeps serving whatever it cached for that exact URL earlier in
  // the same session. A cache-busting query param forces a fresh fetch every
  // time regardless of whether the path collided.
  const assetUrl = `${publicUrlResult.publicUrl}?v=${Date.now()}`;

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
    assetUrl,
    assetStoragePath,
    assetBucket: ARTWORK_BUCKET,
    provider: "openai",
    model,
    revisionCount: Math.max(0, assetVersion - 1),
    approval: emptyApprovalGate,
    approvalComments: emptyApprovalComments
  };
}
