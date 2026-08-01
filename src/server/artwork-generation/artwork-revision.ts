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
    buildArtworkRevisionPrompt(
      input.instructions,
      additionalReferences.length
    )
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

export function buildArtworkRevisionPrompt(
  instructions: string,
  additionalReferenceCount = 0
): string {
  return [
    "Act as a Senior Art Director performing a meaningful enhancement of Image 1.",
    "Image 1 is the source of truth for the core advertising idea and recognizable hero visual, but its current layout and styling are not locked. The result must look visibly more considered, persuasive, and production-ready—not like the same artwork with one small patch.",
    "Treat the following creative review direction as the minimum required improvement, not the limit of what you may enhance:",
    instructions.trim(),
    ...(additionalReferenceCount > 0
      ? [
          `Images 2–${additionalReferenceCount + 1} are user-supplied visual references for this revision. Use their relevant composition, mood, camera, material, styling, or finish as direction while preserving the current artwork's campaign intent and official brand assets.`
        ]
      : []),
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
