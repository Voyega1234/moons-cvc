import sharp from "sharp";
import type { AlbumFormat } from "../../domain/creative-run.js";
import type { ArtworkGenerationRequest } from "../../services/artwork-generation/openai-image-generation.js";
import { albumCropRegions } from "./album-master.js";
import { editImage, type GeneratedImage, type ImageGenerationSize, type ReferenceImageInput } from "./openai-images-client.js";
import { buildImageRequestDebugBundle, type ArtworkGenerationDebugLogger } from "./artwork-debug-log.js";

type Hook = ArtworkGenerationRequest["selectedHooks"][number];

export interface AlbumArtDirection {
  sharedStyle: string;
  panels: readonly {
    index: number;
    message: string;
    scene: string;
    composition: string;
  }[];
}

export function albumPanelPlan(hook: Hook, format: AlbumFormat, usePlaceholderCopy = false) {
  const count = format.startsWith("three-") ? 3 : 4;
  if ((hook.formatBeats?.length ?? 0) < count - 1) {
    throw new Error(`Album requires ${count - 1} supporting content beats.`);
  }
  return Array.from({ length: count }, (_, index) => {
    const size: ImageGenerationSize = index > 0 || format === "four-grid"
      ? "1024x1024"
      : format === "three-horizontal" ? "2048x1024"
      : format === "three-vertical" ? "1024x2048" : "1024x1536";
    return {
      index: index + 1,
      size,
      copy: usePlaceholderCopy ? (index === 0 ? "HEADLINE\nSUBHEADLINE" : "BODY") : index === 0
        ? [hook.hook, hook.subheadline].filter(Boolean).join("\n")
        : hook.formatBeats![index - 1],
      cta: index === count - 1 ? (usePlaceholderCopy ? "CTA" : hook.cta) : ""
    };
  });
}

/** Compose a preview only. Full-resolution panel assets never come from this image. */
export async function composeAlbumPreview(panels: readonly { bytes: Buffer }[], format: AlbumFormat) {
  const regions = albumCropRegions({ left: 0, top: 0, side: 2046, format, boundaries: {} });
  if (panels.length !== regions.length) throw new Error("Incomplete Album panel set.");
  const overlays = await Promise.all(regions.map(async (region, index) => ({
    input: await sharp(panels[index]!.bytes).resize(region.width, region.height, {
      fit: "contain", background: "#ffffff"
    }).png().toBuffer(),
    left: region.left,
    top: region.top
  })));
  return sharp({ create: { width: 2046, height: 2046, channels: 3, background: "#ffffff" } })
    .composite(overlays).png().toBuffer();
}

export async function generateIndependentAlbumPanels({
  hook, format, prompt, references, apiKey, model, runId, fetchImpl, debugLogDirectory, writeDebugLog, reviewPanel, usePlaceholderCopy, artDirection
}: {
  reviewPanel?: (image: GeneratedImage, size: ImageGenerationSize, index: number) => Promise<GeneratedImage>;
  usePlaceholderCopy?: boolean;
  artDirection?: AlbumArtDirection;
  hook: Hook;
  format: AlbumFormat;
  prompt: string;
  references: readonly ReferenceImageInput[];
  apiKey: string;
  model: string;
  runId: string;
  fetchImpl: typeof fetch;
  debugLogDirectory?: string;
  writeDebugLog: ArtworkGenerationDebugLogger;
}) {
  const plan = albumPanelPlan(hook, format, usePlaceholderCopy);
  if (artDirection && (!artDirection.sharedStyle.trim() ||
    artDirection.panels.length !== plan.length ||
    plan.some(panel => {
      const matches = artDirection.panels.filter(shot => shot.index === panel.index);
      return matches.length !== 1 || !matches[0]?.message.trim() ||
        !matches[0]?.scene.trim() || !matches[0]?.composition.trim();
    }))) {
    throw new Error("Album art direction requires one complete shot per panel and a shared style.");
  }
  const panels: { index: number; bytes: Buffer }[] = [];
  const shared = [
    prompt,
    "INDEPENDENT ALBUM PANELS — overrides earlier grid, canvas, copy-placement and CTA instructions.",
    "Plan one coherent campaign across this sequence. Use one palette, typography hierarchy, lighting, materials and visual language. Give each panel a distinct composition and its assigned message.",
    JSON.stringify(plan),
    "The sequence is context only. Render exactly ONE complete standalone panel per request, never a grid, collage, divider or multiple pages. Keep all text, logos and essential subjects comfortably inside the canvas. Do not print panel numbers or planning labels."
  ].join("\n\n");
  for (const panel of plan) {
    const cover = artDirection ? undefined : panels[0];
    const shot = artDirection?.panels.find(item => item.index === panel.index);
    const panelReferences = cover ? [...references, {
      bytes: cover.bytes, mimeType: "image/png",
      label: "Album cover — shared style reference only; do not copy its headline or layout."
    }] : references;
    const panelPrompt = [shared,
      artDirection && shot ? [
        "APPROVED ALBUM STORYBOARD — the following shot replaces earlier generic scene suggestions. Maintain style through these written rules, not by repeating another panel's scene.",
        `Shared style for every panel: ${artDirection.sharedStyle}`,
        `This panel's visual message (planning only, not printed copy): ${shot.message}`,
        `This panel's scene: ${shot.scene}`,
        `This panel's composition: ${shot.composition}`,
        "Every panel must add a new visual argument. A crop, camera shift, added prop or changed headline alone is not a new visual idea.",
        `Scenes reserved for OTHER panels; do not depict these here: ${artDirection.panels.filter(item => item.index !== panel.index).map(item => item.scene).join(" | ")}`
      ].join("\n\n") : cover ? `The last attached image is the generated cover. Match its palette, typography, lighting and rendering style; create a new composition for this panel.` : "Establish the visual style for the entire sequence in this cover.",
      `Render panel ${panel.index} only, canvas ${panel.size}. Approved content for THIS panel: ${panel.copy}`,
      panel.cta ? `Include exactly one CTA: ${panel.cta}` : "Do not render any CTA, action button or copy assigned to other panels.",
      `Attachment roles in order: ${panelReferences.map((r, i) => `${i + 1}: ${r.label ?? "approved campaign asset"}`).join("; ")}`
    ].join("\n\n");
    const debug = buildImageRequestDebugBundle({ model, runId,
      hook: { id: `${hook.id}-album-${panel.index}` }, prompt: panelPrompt,
      size: panel.size, quality: "medium", references: panelReferences });
    await writeDebugLog(debugLogDirectory, debug.entry, debug.assets);
    const image = await editImage({ apiKey, model, prompt: panelPrompt, size: panel.size,
      referenceImages: panelReferences, quality: "medium", fetchImpl });
    const reviewed = reviewPanel ? await reviewPanel(image, panel.size, panel.index) : image;
    const bytes = Buffer.from(reviewed.base64, "base64");
    const metadata = await sharp(bytes).metadata();
    const [width, height] = panel.size.split("x").map(Number);
    if (!metadata.width || !metadata.height || !width || !height || Math.abs(metadata.width / metadata.height - width / height) > 0.02) {
      throw new Error(`Album panel ${panel.index} returned an incorrect aspect ratio; refusing to crop its content.`);
    }
    panels.push({ index: panel.index, bytes });
  }
  return { panels, masterBytes: await composeAlbumPreview(panels, format) };
}
