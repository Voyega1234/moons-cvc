import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArtworkOutputSize } from "../../domain/creative-run.js";
import type { ArtworkGenerationRequest } from "../../services/artwork-generation/openai-image-generation.js";
import type {
  CreativeStrategyEnrichment,
  CreativeStrategyEnrichmentTrace
} from "./creative-strategy-enrichment-agent.js";
import type { DesignSystemFlowTrace } from "./design-system-flow-agent.js";
import type {
  ImagePromptAgentTrace,
  ImagePromptProvider
} from "./image-prompt-agent.js";
import type { ReferenceImageInput } from "./openai-images-client.js";
import { safePathSegment } from "./artwork-paths.js";
import { ARTWORK_BUCKET } from "./artwork-generation-types.js";

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
  stage?: "campaign-input-preflight" | "production-brief";
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
        | "moons_creative_visual_concept"
        | "moons_campaign_input_preflight";
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
      name:
        | "moons_creative_set_direction"
        | "moons_visual_quality_review"
        | "moons_album_panel_separation_review";
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

export interface ArtworkGenerationDebugAsset {
  filename: string;
  bytes: Buffer;
}

export type ArtworkGenerationDebugLog =
  | ImageRequestDebugLog
  | CreativeStrategyAgentDebugLog
  | DesignSystemFlowAgentDebugLog
  | ImagePromptAgentDebugLog
  | ImageOutputDebugLog;

export type ArtworkGenerationDebugLogger = (
  directory: string | undefined,
  entry: ArtworkGenerationDebugLog,
  assets?: readonly ArtworkGenerationDebugAsset[]
) => Promise<void>;

export function buildImageRequestDebugBundle({
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

export function buildImageOutputDebugBundle({
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

export async function writeImageRequestDebugLog(
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

export function buildCreativeStrategyAgentDebugLog(
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

export function buildDesignSystemFlowAgentDebugLog(
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
            : trace.stage === "album-panel-qc"
              ? "moons_album_panel_separation_review"
              : "moons_visual_quality_review",
        strict: true
      }
    },
    ...(trace.response ? { response: trace.response } : {}),
    ...(trace.error ? { error: trace.error } : {})
  };
}

export function buildImagePromptAgentDebugLog(
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
          trace.stage === "campaign-input-preflight"
            ? "moons_campaign_input_preflight"
            : trace.mode === "design-system" ||
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
  if (
    entry.kind === "image-prompt-agent" &&
    entry.stage === "campaign-input-preflight"
  ) {
    return "-campaign-input-preflight-agent";
  }
  return entry.kind === "image-prompt-agent" ? "-image-agent" : "-image-output";
}
