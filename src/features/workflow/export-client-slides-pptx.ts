import type PptxGenJS from "pptxgenjs";
import {
  resolveAlbumFormat,
  type AlbumFormat,
  type CreativeDirection,
  type CreativeOutput,
  type ReferenceImageSelection,
  type UgcVideoBrief
} from "../../domain/creative-run";
import { inferredReferenceImageRole } from "../../domain/creative-run";
import { directionSubheadline } from "../../domain/subheadline-highlight";
import type { WorkflowState } from "./model";
import { approvalRolesForOutput } from "./rules";
import {
  requestGoogleDriveAccessToken,
  uploadPptxToGoogleSlides,
  type GoogleSlidesImportResult
} from "../../services/google-slides/google-slides-import";

export interface ClientSlideItem {
  output: CreativeOutput;
  outputs: readonly CreativeOutput[];
  direction: CreativeDirection | undefined;
}

export type ClientSlideImageResolver = (url: string) => Promise<string>;
type ClientSlidesState = Pick<
  WorkflowState,
  | "brand"
  | "outputs"
  | "directions"
  | "outputSize"
  | "referenceImages"
  | "albumFormat"
>;

const COLORS = {
  ink: "191B27",
  muted: "707487",
  line: "E5E7EE",
  paper: "FFFFFF",
  canvas: "F5F6FA",
  violet: "625BFF",
  violetSoft: "EEEFFF",
  lime: "D7FF55",
  limeInk: "28330B"
} as const;

const THAI_TEXT_PATTERN = /[\u0E00-\u0E7F]/;
const SLIDE_FONT_FACE = "Sarabun";

function localizedTextStyle(value: string) {
  return {
    fontFace: SLIDE_FONT_FACE,
    lang: THAI_TEXT_PATTERN.test(value) ? "th-TH" : "en-US"
  };
}

export function pmApprovedClientSlideItems(
  state: Pick<WorkflowState, "outputs" | "directions">
): readonly ClientSlideItem[] {
  const approved = (output: CreativeOutput) =>
    approvalRolesForOutput(output).every(
      (role) => output.approval[role] === "approved"
    );
  return groupedClientSlideItems(state, approved);
}

export function createStageClientSlideItems(
  state: Pick<WorkflowState, "outputs" | "directions">
): readonly ClientSlideItem[] {
  return groupedClientSlideItems(
    state,
    (output) => isUgcOutput(output) || Boolean(output.assetUrl)
  );
}

function groupedClientSlideItems(
  state: Pick<WorkflowState, "outputs" | "directions">,
  include: (output: CreativeOutput) => boolean
): readonly ClientSlideItem[] {
  const albumGroups = new Map<string, CreativeOutput[]>();
  state.outputs.filter(isAlbumOutput).forEach((output) => {
    const group = albumGroups.get(output.directionId) ?? [];
    group.push(output);
    albumGroups.set(output.directionId, group);
  });
  const emittedAlbums = new Set<string>();

  return state.outputs.flatMap((output) => {
    const direction = state.directions.find(
      (candidate) => candidate.id === output.directionId
    );
    if (!isAlbumOutput(output)) {
      return include(output) ? [{ output, outputs: [output], direction }] : [];
    }
    if (emittedAlbums.has(output.directionId)) return [];
    emittedAlbums.add(output.directionId);
    const outputs = sortAlbumOutputs(
      albumGroups.get(output.directionId) ?? [output]
    );
    if (!outputs.every(include)) return [];
    return [{ output: outputs[0] ?? output, outputs, direction }];
  });
}

function isUgcOutput(output: CreativeOutput): boolean {
  return output.format.toUpperCase().includes("UGC");
}

function preferredUgcReference(
  references: readonly ReferenceImageSelection[]
): ReferenceImageSelection | undefined {
  return (
    references.find(
      (reference) =>
        reference.primary && inferredReferenceImageRole(reference) === "style"
    ) ??
    references.find(
      (reference) => inferredReferenceImageRole(reference) === "style"
    ) ??
    references.find(
      (reference) =>
        reference.primary && inferredReferenceImageRole(reference) !== "logo"
    ) ??
    references.find(
      (reference) => inferredReferenceImageRole(reference) !== "logo"
    )
  );
}

function isAlbumOutput(output: CreativeOutput): boolean {
  return output.format.trim().toLowerCase() === "album post";
}

function albumPanelIndex(output: CreativeOutput): number {
  const match = output.id.match(/-album-(\d+)-v\d+$/i);
  return match ? Number(match[1]) - 1 : Number.MAX_SAFE_INTEGER;
}

function sortAlbumOutputs(
  outputs: readonly CreativeOutput[]
): readonly CreativeOutput[] {
  return [...outputs].sort(
    (left, right) => albumPanelIndex(left) - albumPanelIndex(right)
  );
}

function cleanText(value: string | undefined, fallback = "—"): string {
  const clean = value?.replace(/\s+/g, " ").trim();
  return clean || fallback;
}

function clampText(value: string | undefined, maxLength: number): string {
  const clean = cleanText(value);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function fileSlug(value: string): string {
  const slug = value
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return slug || "client";
}

function imageMimeType(url: string, response: Response): string {
  const responseType = response.headers.get("content-type")?.split(";")[0]?.trim();
  if (responseType?.startsWith("image/")) return responseType;
  const pathname = new URL(url, window.location.href).pathname.toLowerCase();
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".webp")) return "image/webp";
  return "image/png";
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export async function fetchClientSlideImage(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load approved artwork (${response.status}).`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return `data:${imageMimeType(url, response)};base64,${bytesToBase64(bytes)}`;
}

function addTextBlock(
  slide: PptxGenJS.Slide,
  label: string,
  value: string | undefined,
  y: number,
  height: number,
  maxLength: number
) {
  const text = clampText(value, maxLength);
  slide.addText(label.toUpperCase(), {
    x: 7.35,
    y,
    w: 5.05,
    h: 0.2,
    margin: 0,
    ...localizedTextStyle(label),
    fontSize: 8,
    bold: true,
    color: COLORS.muted,
    charSpacing: 1.1
  });
  slide.addText(text, {
    x: 7.35,
    y: y + 0.25,
    w: 5.05,
    h: height - 0.25,
    margin: 0,
    ...localizedTextStyle(text),
    fontSize: 12.5,
    color: COLORS.ink,
    breakLine: false,
    valign: "top",
    fit: "shrink",
    paraSpaceAfter: 0
  });
}

function resolvedUgcBrief(
  direction: CreativeDirection | undefined,
  brandName: string
): UgcVideoBrief {
  const beats = direction?.formatBeats ?? [];
  return (
    direction?.ugcBrief ?? {
      product: brandName,
      duration: "15–30 วินาที",
      objective: cleanText(direction?.why, "สื่อสารแนวคิดให้เข้าใจและจดจำได้เร็ว"),
      moodAndTone: cleanText(direction?.visual, "เป็นธรรมชาติ กระชับ และน่าเชื่อถือ"),
      productionStyle: "Creator-led vertical video ถ่ายแบบเป็นธรรมชาติและตัดต่อกระชับ",
      referenceDirection: cleanText(
        direction?.visual,
        "ภาพแนวตั้งแบบ native social ที่ดูจริงและไม่จัดฉากเกินไป"
      ),
      openingScript: cleanText(beats[0], direction?.hook),
      showcaseScript: cleanText(beats[1], direction?.concept),
      closingScript: cleanText(beats[2], direction?.cta)
    }
  );
}

function addUgcScriptRow(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  index: number,
  label: string,
  value: string,
  y: number
) {
  slide.addShape(pptx.ShapeType.ellipse, {
    x: 5.5,
    y: y + 0.02,
    w: 0.32,
    h: 0.32,
    fill: { color: COLORS.violetSoft },
    line: { color: COLORS.violetSoft }
  });
  slide.addText(String(index).padStart(2, "0"), {
    x: 5.53,
    y: y + 0.105,
    w: 0.26,
    h: 0.1,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 6.8,
    bold: true,
    color: COLORS.violet,
    align: "center"
  });
  slide.addText(label, {
    x: 5.98,
    y,
    w: 1.42,
    h: 0.2,
    margin: 0,
    ...localizedTextStyle(label),
    fontSize: 9.5,
    bold: true,
    color: COLORS.violet,
    fit: "shrink"
  });
  const text = clampText(value, 520);
  slide.addText(text, {
    x: 7.45,
    y,
    w: 4.92,
    h: 0.58,
    margin: 0,
    ...localizedTextStyle(text),
    fontSize: 9.6,
    color: COLORS.ink,
    valign: "top",
    fit: "shrink",
    breakLine: false,
    paraSpaceAfter: 0
  });
}

function addUgcPhoneMockup(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  brandName: string,
  brief: UgcVideoBrief,
  referenceImage?: string
) {
  slide.addText("UGC VISUAL REFERENCE", {
    x: 0.78,
    y: 0.68,
    w: 3.8,
    h: 0.2,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 8,
    bold: true,
    color: COLORS.violet,
    charSpacing: 1.1
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 1.32,
    y: 1.02,
    w: 2.75,
    h: 5.22,
    rectRadius: 0.22,
    fill: { color: "161824" },
    line: { color: "161824", width: 1 }
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 1.45,
    y: 1.17,
    w: 2.49,
    h: 4.92,
    rectRadius: 0.17,
    fill: { color: "E9EAF0" },
    line: { color: "2A2D3D", width: 0.4 }
  });
  if (referenceImage) {
    slide.addImage({
      data: referenceImage,
      x: 1.48,
      y: 1.2,
      w: 2.43,
      h: 4.86,
      sizing: { type: "cover", w: 2.43, h: 4.86 },
      altText: `${brandName} UGC visual reference in phone mockup`
    });
  } else {
    const referenceText = clampText(brief.referenceDirection, 220);
    slide.addText("UGC", {
      x: 1.73,
      y: 2.0,
      w: 1.93,
      h: 0.45,
      margin: 0,
      fontFace: SLIDE_FONT_FACE,
      fontSize: 25,
      bold: true,
      color: COLORS.violet,
      align: "center"
    });
    slide.addText(referenceText, {
      x: 1.72,
      y: 2.62,
      w: 1.95,
      h: 1.72,
      margin: 0,
      ...localizedTextStyle(referenceText),
      fontSize: 11,
      color: COLORS.muted,
      align: "center",
      valign: "middle",
      fit: "shrink"
    });
  }
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 2.17,
    y: 1.12,
    w: 1.05,
    h: 0.18,
    rectRadius: 0.08,
    fill: { color: "161824" },
    line: { color: "161824" }
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 2.37,
    y: 5.91,
    w: 0.65,
    h: 0.05,
    rectRadius: 0.02,
    fill: { color: "FFFFFF", transparency: 15 },
    line: { color: "FFFFFF", transparency: 100 }
  });
  const referenceDirection = clampText(brief.referenceDirection, 150);
  slide.addText(referenceDirection, {
    x: 0.82,
    y: 6.43,
    w: 3.76,
    h: 0.36,
    margin: 0,
    ...localizedTextStyle(referenceDirection),
    fontSize: 8.8,
    italic: true,
    color: COLORS.muted,
    align: "center",
    fit: "shrink"
  });
}

function addUgcClientSlide(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  direction: CreativeDirection | undefined,
  brandName: string,
  slideNumber: number,
  totalSlides: number,
  referenceImage?: string
) {
  const brief = resolvedUgcBrief(direction, brandName);
  slide.background = { color: COLORS.canvas };
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.45,
    y: 0.45,
    w: 4.55,
    h: 6.6,
    rectRadius: 0.16,
    fill: { color: COLORS.paper },
    line: { color: COLORS.line, width: 1 }
  });
  addUgcPhoneMockup(pptx, slide, brandName, brief, referenceImage);

  const displayBrandName = brandName.toUpperCase();
  slide.addText(displayBrandName, {
    x: 5.5,
    y: 0.64,
    w: 3.6,
    h: 0.22,
    margin: 0,
    ...localizedTextStyle(displayBrandName),
    fontSize: 8,
    bold: true,
    color: COLORS.violet,
    charSpacing: 1.2
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 11.1,
    y: 0.56,
    w: 1.26,
    h: 0.38,
    rectRadius: 0.08,
    fill: { color: COLORS.lime },
    line: { color: COLORS.lime }
  });
  slide.addText("UGC VIDEO", {
    x: 11.2,
    y: 0.67,
    w: 1.06,
    h: 0.14,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 7.5,
    bold: true,
    color: COLORS.limeInk,
    align: "center"
  });
  const hook = clampText(direction?.hook, 170);
  slide.addText(hook, {
    x: 5.5,
    y: 1.12,
    w: 6.86,
    h: 0.78,
    margin: 0,
    ...localizedTextStyle(hook),
    fontSize: 25,
    bold: true,
    color: COLORS.ink,
    valign: "top",
    fit: "shrink",
    breakLine: false
  });

  const projectDetails = `${brief.product}  •  ${brief.duration}`;
  slide.addText(projectDetails, {
    x: 5.5,
    y: 2.03,
    w: 6.86,
    h: 0.22,
    margin: 0,
    ...localizedTextStyle(projectDetails),
    fontSize: 9.5,
    bold: true,
    color: COLORS.violet,
    fit: "shrink"
  });
  slide.addText("OBJECTIVE", {
    x: 5.5,
    y: 2.43,
    w: 1.2,
    h: 0.16,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 7.5,
    bold: true,
    color: COLORS.muted,
    charSpacing: 1
  });
  const objective = clampText(brief.objective, 200);
  slide.addText(objective, {
    x: 5.5,
    y: 2.68,
    w: 6.86,
    h: 0.5,
    margin: 0,
    ...localizedTextStyle(objective),
    fontSize: 11,
    color: COLORS.ink,
    fit: "shrink",
    valign: "top"
  });

  slide.addText("VIDEO STORYLINE", {
    x: 5.5,
    y: 3.37,
    w: 2.1,
    h: 0.18,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 8,
    bold: true,
    color: COLORS.muted,
    charSpacing: 1.1
  });
  addUgcScriptRow(pptx, slide, 1, "OPEN / HOOK", brief.openingScript, 3.72);
  addUgcScriptRow(pptx, slide, 2, "SHOWCASE", brief.showcaseScript, 4.47);
  addUgcScriptRow(pptx, slide, 3, "END / CTA", brief.closingScript, 5.22);

  slide.addShape(pptx.ShapeType.line, {
    x: 5.5,
    y: 6.02,
    w: 6.86,
    h: 0,
    line: { color: COLORS.line, width: 1 }
  });
  const production = clampText(
    `${brief.moodAndTone} • ${brief.productionStyle}`,
    240
  );
  slide.addText(production, {
    x: 5.5,
    y: 6.2,
    w: 6.86,
    h: 0.36,
    margin: 0,
    ...localizedTextStyle(production),
    fontSize: 8.8,
    italic: true,
    color: COLORS.muted,
    fit: "shrink",
    valign: "top"
  });
  slide.addText("Prepared by Convert Cake", {
    x: 5.5,
    y: 6.68,
    w: 2.5,
    h: 0.18,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 8,
    bold: true,
    color: COLORS.muted
  });
  slide.addText(`${slideNumber} / ${totalSlides}`, {
    x: 11.75,
    y: 6.68,
    w: 0.7,
    h: 0.18,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 8,
    color: COLORS.muted,
    align: "right"
  });
}

function addArtworkPreview(
  slide: PptxGenJS.Slide,
  data: string,
  outputSize: WorkflowState["outputSize"],
  altText: string
) {
  const [pixelWidth, pixelHeight] = outputSize.split("x").map(Number);
  const ratio = pixelWidth && pixelHeight ? pixelWidth / pixelHeight : 1;
  const box = { x: 0.65, y: 0.68, w: 5.85, h: 6.15 };
  let width = box.w;
  let height = width / ratio;
  if (height > box.h) {
    height = box.h;
    width = height * ratio;
  }
  slide.addImage({
    data,
    x: box.x + (box.w - width) / 2,
    y: box.y + (box.h - height) / 2,
    w: width,
    h: height,
    altText
  });
}

function addAlbumArtworkPreview(
  slide: PptxGenJS.Slide,
  imageData: readonly string[],
  brandName: string,
  format: AlbumFormat
) {
  const box = { x: 0.65, y: 0.83, w: 5.85, h: 5.85 };
  const placements = albumSlidePlacements(box, format);

  imageData.slice(0, placements.length).forEach((data, index) => {
    const placement = placements[index];
    if (!placement) return;
    slide.addImage({
      data,
      ...placement,
      altText: `${brandName} album panel ${index + 1}`
    });
  });
}

function albumSlidePlacements(
  box: { x: number; y: number; w: number; h: number },
  format: AlbumFormat
) {
  const halfWidth = box.w / 2;
  const halfHeight = box.h / 2;
  if (format === "three-vertical") {
    return [
      { x: box.x, y: box.y, w: halfWidth, h: box.h },
      { x: box.x + halfWidth, y: box.y, w: halfWidth, h: halfHeight },
      {
        x: box.x + halfWidth,
        y: box.y + halfHeight,
        w: halfWidth,
        h: halfHeight
      }
    ];
  }
  if (format === "three-horizontal") {
    return [
      { x: box.x, y: box.y, w: box.w, h: halfHeight },
      { x: box.x, y: box.y + halfHeight, w: halfWidth, h: halfHeight },
      {
        x: box.x + halfWidth,
        y: box.y + halfHeight,
        w: halfWidth,
        h: halfHeight
      }
    ];
  }
  if (format === "four-vertical") {
    const railWidth = box.w / 3;
    const leadWidth = box.w - railWidth;
    const rowHeight = box.h / 3;
    return [
      { x: box.x, y: box.y, w: leadWidth, h: box.h },
      { x: box.x + leadWidth, y: box.y, w: railWidth, h: rowHeight },
      {
        x: box.x + leadWidth,
        y: box.y + rowHeight,
        w: railWidth,
        h: rowHeight
      },
      {
        x: box.x + leadWidth,
        y: box.y + rowHeight * 2,
        w: railWidth,
        h: rowHeight
      }
    ];
  }
  return [
    { x: box.x, y: box.y, w: halfWidth, h: halfHeight },
    { x: box.x + halfWidth, y: box.y, w: halfWidth, h: halfHeight },
    { x: box.x, y: box.y + halfHeight, w: halfWidth, h: halfHeight },
    {
      x: box.x + halfWidth,
      y: box.y + halfHeight,
      w: halfWidth,
      h: halfHeight
    }
  ];
}

function addClientSlide(
  pptx: PptxGenJS,
  item: ClientSlideItem,
  brandName: string,
  slideNumber: number,
  totalSlides: number,
  outputSize: WorkflowState["outputSize"],
  albumFormat: AlbumFormat,
  imageData: readonly string[] = []
) {
  const { output, direction } = item;
  const slide = pptx.addSlide();
  if (isUgcOutput(output)) {
    addUgcClientSlide(
      pptx,
      slide,
      direction,
      brandName,
      slideNumber,
      totalSlides,
      imageData[0]
    );
    return;
  }
  slide.background = { color: COLORS.canvas };

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.45,
    y: 0.45,
    w: 6.28,
    h: 6.6,
    rectRadius: 0.16,
    fill: { color: COLORS.paper },
    line: { color: COLORS.line, width: 1 }
  });
  if (isAlbumOutput(output) && imageData.length > 1) {
    addAlbumArtworkPreview(slide, imageData, brandName, albumFormat);
  } else if (imageData[0]) {
    addArtworkPreview(
      slide,
      imageData[0],
      outputSize,
      `${brandName} ${output.format} creative artwork`
    );
  }

  const displayBrandName = brandName.toUpperCase();
  slide.addText(displayBrandName, {
    x: 7.35,
    y: 0.64,
    w: 3.6,
    h: 0.22,
    margin: 0,
    ...localizedTextStyle(displayBrandName),
    fontSize: 8,
    bold: true,
    color: COLORS.violet,
    charSpacing: 1.2
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 11.1,
    y: 0.56,
    w: 1.26,
    h: 0.38,
    rectRadius: 0.08,
    fill: { color: COLORS.lime },
    line: { color: COLORS.lime }
  });
  slide.addText(output.format.toUpperCase(), {
    x: 11.2,
    y: 0.67,
    w: 1.06,
    h: 0.14,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 7.5,
    bold: true,
    color: COLORS.limeInk,
    align: "center",
    fit: "shrink"
  });
  const hook = clampText(direction?.hook, 170);
  slide.addText(hook, {
    x: 7.35,
    y: 1.18,
    w: 5.05,
    h: 1.42,
    margin: 0,
    ...localizedTextStyle(hook),
    fontSize: 26,
    bold: true,
    color: COLORS.ink,
    valign: "top",
    fit: "shrink",
    breakLine: false
  });
  addTextBlock(
    slide,
    "Sub-headline",
    direction ? directionSubheadline(direction) : undefined,
    2.95,
    1.25,
    320
  );
  addTextBlock(slide, "Creative concept", direction?.concept, 4.38, 0.86, 180);
  addTextBlock(slide, "Call to action", direction?.cta, 5.48, 0.7, 130);

  slide.addShape(pptx.ShapeType.line, {
    x: 7.35,
    y: 6.47,
    w: 5.05,
    h: 0,
    line: { color: COLORS.line, width: 1 }
  });
  slide.addText(`${slideNumber} / ${totalSlides}`, {
    x: 11.72,
    y: 6.64,
    w: 0.68,
    h: 0.2,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 8,
    color: COLORS.muted,
    align: "right"
  });
}

export async function buildPmApprovedClientSlidesPptx(
  state: ClientSlidesState,
  resolveImage: ClientSlideImageResolver = fetchClientSlideImage
): Promise<PptxGenJS> {
  const items = pmApprovedClientSlideItems(state);
  if (!items.length) {
    throw new Error("No PM-approved assets are ready for client slides yet.");
  }

  return buildClientSlidesPptx(
    state,
    items,
    resolveImage,
    "approved creative concepts",
    "client slides"
  );
}

export async function buildCreateStageSlidesPptx(
  state: ClientSlidesState,
  resolveImage: ClientSlideImageResolver = fetchClientSlideImage
): Promise<PptxGenJS> {
  const items = createStageClientSlideItems(state);
  if (!items.length) {
    throw new Error("No generated artwork is ready for slides yet.");
  }

  return buildClientSlidesPptx(
    state,
    items,
    resolveImage,
    "creative concepts",
    "creative slides"
  );
}

async function buildClientSlidesPptx(
  state: ClientSlidesState,
  items: readonly ClientSlideItem[],
  resolveImage: ClientSlideImageResolver,
  subject: string,
  title: string
): Promise<PptxGenJS> {
  const { default: PptxGenJSConstructor } = await import("pptxgenjs");
  const pptx = new PptxGenJSConstructor();
  const brandName = cleanText(state.brand?.name, "Client");
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Creative Compass";
  pptx.company = "Creative Compass";
  pptx.subject = `${brandName} ${subject}`;
  pptx.title = `${brandName} ${title}`;
  pptx.theme = {
    headFontFace: SLIDE_FONT_FACE,
    bodyFontFace: SLIDE_FONT_FACE
  };
  const ugcReference = preferredUgcReference(state.referenceImages);
  let ugcReferenceData: string | null | undefined;

  for (const [index, item] of items.entries()) {
    let imageData: readonly string[] = [];
    if (isUgcOutput(item.output) && ugcReference) {
      if (ugcReferenceData === undefined) {
        try {
          ugcReferenceData = await resolveImage(ugcReference.url);
        } catch {
          ugcReferenceData = null;
        }
      }
      imageData = ugcReferenceData ? [ugcReferenceData] : [];
    } else if (!isUgcOutput(item.output)) {
      imageData = await Promise.all(
        item.outputs.map((output, panelIndex) => {
          if (!output.assetUrl) {
            throw new Error(
              `Creative asset ${index + 1}${item.outputs.length > 1 ? ` panel ${panelIndex + 1}` : ""} does not have an artwork file yet.`
            );
          }
          return resolveImage(output.assetUrl);
        })
      );
    }
    addClientSlide(
      pptx,
      item,
      brandName,
      index + 1,
      items.length,
      state.outputSize,
      resolveAlbumFormat(state.albumFormat, item.direction?.albumFormat),
      imageData
    );
  }

  return pptx;
}

export async function downloadCreateStageSlides(
  state: ClientSlidesState
): Promise<void> {
  const pptx = await buildCreateStageSlidesPptx(state);
  await pptx.writeFile({
    fileName: `${fileSlug(state.brand?.name ?? "creative")}-creative-slides.pptx`,
    compression: true
  });
}

export async function downloadPmApprovedClientSlides(
  state: ClientSlidesState
): Promise<void> {
  const pptx = await buildPmApprovedClientSlidesPptx(state);
  await pptx.writeFile({
    fileName: `${fileSlug(state.brand?.name ?? "client")}-client-slides.pptx`,
    compression: true
  });
}

async function pptxBlob(pptx: PptxGenJS): Promise<Blob> {
  const output = await pptx.write({ outputType: "blob", compression: true });
  if (!(output instanceof Blob)) {
    throw new Error("Could not prepare the slide deck for Google Drive.");
  }
  return output;
}

async function openPptxInGoogleSlides(
  build: () => Promise<PptxGenJS>,
  name: string
): Promise<GoogleSlidesImportResult> {
  const accessToken = await requestGoogleDriveAccessToken();
  const pptx = await build();
  return uploadPptxToGoogleSlides({
    blob: await pptxBlob(pptx),
    name,
    accessToken
  });
}

export async function openCreateStageSlidesInGoogleSlides(
  state: ClientSlidesState
): Promise<GoogleSlidesImportResult> {
  return openPptxInGoogleSlides(
    () => buildCreateStageSlidesPptx(state),
    `${fileSlug(state.brand?.name ?? "creative")}-creative-slides`
  );
}

export async function openPmApprovedClientSlidesInGoogleSlides(
  state: ClientSlidesState
): Promise<GoogleSlidesImportResult> {
  return openPptxInGoogleSlides(
    () => buildPmApprovedClientSlidesPptx(state),
    `${fileSlug(state.brand?.name ?? "client")}-client-slides`
  );
}
