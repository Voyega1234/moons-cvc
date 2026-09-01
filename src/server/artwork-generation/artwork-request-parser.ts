import {
  albumFormatPanelCount,
  albumFormatPreferences,
  albumFormats,
  artworkModes,
  artworkOutputSizes,
  ctaActionTypes,
  defaultAlbumFormatPreference,
  imagePromptModels,
  type AlbumFormat,
  type ArtworkOutputSize,
  type CtaActionType
} from "../../domain/creative-run.js";
import { activeBrandKitItems } from "../../domain/brand.js";
import type {
  ArtworkGenerationRequest,
  ArtworkRevisionRequest
} from "../../services/artwork-generation/openai-image-generation.js";

type SelectedHook = ArtworkGenerationRequest["selectedHooks"][number];
export function isArtworkRevisionRequest(
  value: unknown
): value is Record<string, unknown> {
  return isRecord(value) && value.requestType === "artwork-revision";
}

export function parseRevisionRequestBody(value: unknown): ArtworkRevisionRequest {
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

  const albumValue = value.album;
  let album: ArtworkRevisionRequest["album"];
  if (albumValue !== undefined) {
    const albumRecord = readRecord(albumValue, "album");
    const format = readString(albumRecord.format, "album.format") as AlbumFormat;
    if (!albumFormats.includes(format)) {
      throw new Error("album.format is not supported.");
    }
    const outputIds = readStringArray(albumRecord.outputIds, "album.outputIds");
    if (outputIds.length !== albumFormatPanelCount(format)) {
      throw new Error("album.outputIds must match the album panel count.");
    }
    album = { format, outputIds };
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
    referenceImages: Array.isArray(value.referenceImages)
      ? (value.referenceImages as ArtworkRevisionRequest["referenceImages"])
      : [],
    ...(album ? { album } : {}),
    output: { size: outputSize as ArtworkOutputSize, format: "png" }
  };
}

export function parseRequestBody(value: unknown): ArtworkGenerationRequest {
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
    ...(value.referenceLed === undefined
      ? {}
      : { referenceLed: readBoolean(value.referenceLed, "referenceLed") }),
    ...(value.usePlaceholderCopy === undefined
      ? {}
      : {
          usePlaceholderCopy: readBoolean(
            value.usePlaceholderCopy,
            "usePlaceholderCopy"
          )
        }),
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

export function canvasRatioFromSize(size: ArtworkOutputSize): string {
  const [widthText, heightText] = size.split("x") as [string, string];
  const width = Number(widthText);
  const height = Number(heightText);
  const divisor = greatestCommonDivisor(width, height);
  return `${width / divisor}:${height / divisor}`;
}

export function referenceCanvasRatioFromSize(
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
    brand: activeBrandKitItems(parseLibraryItems(value.brand)),
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

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean.`);
  return value;
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
