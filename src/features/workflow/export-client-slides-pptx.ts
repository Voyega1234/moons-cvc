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

function cleanSlideCaption(value: string | undefined): string {
  const clean = value
    ?.replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  return clean || "—";
}

function clampSlideCaption(value: string | undefined, maxLength = 900): string {
  const clean = cleanSlideCaption(value);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function estimatedWrappedLines(
  value: string,
  widthInches: number,
  fontSize: number
): number {
  const charactersPerLine = Math.max(
    18,
    Math.floor((widthInches * 72) / (fontSize * 0.68))
  );
  return value.split("\n").reduce((total, line) => {
    const weightedLength = Array.from(line).reduce(
      (length, character) =>
        length + (THAI_TEXT_PATTERN.test(character) ? 1.08 : 1),
      0
    );
    return total + Math.max(1, Math.ceil(weightedLength / charactersPerLine));
  }, 0);
}

function fontSizeForFixedTextBox(
  value: string,
  widthInches: number,
  heightInches: number,
  candidates: readonly number[]
): number {
  for (const fontSize of candidates) {
    const availableLines = Math.floor(
      (heightInches * 72) / (fontSize * 1.28)
    );
    if (
      estimatedWrappedLines(value, widthInches, fontSize) <= availableLines
    ) {
      return fontSize;
    }
  }
  return candidates[candidates.length - 1] ?? 10.5;
}

function captionFontSizeForSlide(value: string): number {
  const paragraphCount = value.split(/\n{2,}/).filter(Boolean).length;
  for (const fontSize of [15, 14, 13, 12, 11, 10, 9, 8]) {
    const wrappedLines = estimatedWrappedLines(value, 7.55, fontSize);
    const paragraphSpacing =
      Math.max(0, paragraphCount - 1) *
      (fontSize >= 13 ? 8 : fontSize >= 10 ? 5 : 3);
    const requiredHeightPoints =
      wrappedLines * fontSize * 1.55 + paragraphSpacing;
    if (requiredHeightPoints <= 4.2 * 72) return fontSize;
  }
  return 8;
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
  options: {
    x: number;
    y: number;
    w: number;
    h: number;
    maxLength: number;
    fontSize: number;
  }
) {
  const text = clampText(value, options.maxLength);
  slide.addText(label.toUpperCase(), {
    x: options.x,
    y: options.y,
    w: options.w,
    h: 0.2,
    margin: 0,
    ...localizedTextStyle(label),
    fontSize: 8,
    bold: true,
    color: COLORS.muted,
    charSpacing: 1.1
  });
  slide.addText(text, {
    x: options.x,
    y: options.y + 0.27,
    w: options.w,
    h: options.h - 0.27,
    margin: 0,
    ...localizedTextStyle(text),
    fontSize: options.fontSize,
    color: COLORS.ink,
    breakLine: false,
    valign: "top",
    fit: "shrink",
    paraSpaceAfter: 0
  });
}

function addCaptionBlock(
  slide: PptxGenJS.Slide,
  value: string | undefined,
  options: { x: number; y: number; w: number; h: number }
) {
  const text = clampSlideCaption(value);
  const characterCount = Array.from(text).length;
  const fontSize =
    characterCount <= 350 ? 14 : characterCount <= 650 ? 12.5 : 11;
  slide.addText("CAPTION", {
    x: options.x,
    y: options.y,
    w: options.w,
    h: 0.2,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 8,
    bold: true,
    color: COLORS.muted,
    charSpacing: 1.1
  });
  slide.addText(text, {
    x: options.x,
    y: options.y + 0.35,
    w: options.w,
    h: options.h - 0.35,
    margin: 0,
    ...localizedTextStyle(text),
    fontSize,
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
  direction: CreativeDirection | undefined,
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
    fill: { color: "20222B" },
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
  }
  slide.addShape(pptx.ShapeType.rect, {
    x: 1.48,
    y: 1.2,
    w: 2.43,
    h: 0.72,
    fill: { color: "111219", transparency: referenceImage ? 42 : 0 },
    line: { color: "111219", transparency: 100 }
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 1.48,
    y: 4.72,
    w: 2.43,
    h: 1.34,
    fill: { color: "111219", transparency: referenceImage ? 24 : 0 },
    line: { color: "111219", transparency: 100 }
  });
  slide.addText("9:41", {
    x: 1.63,
    y: 1.31,
    w: 0.43,
    h: 0.13,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 6.8,
    bold: true,
    color: "FFFFFF"
  });
  slide.addText("●  ⌑", {
    x: 3.33,
    y: 1.31,
    w: 0.42,
    h: 0.13,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 6.5,
    color: "FFFFFF",
    align: "right"
  });
  slide.addText("Following     For You", {
    x: 2.05,
    y: 1.55,
    w: 1.3,
    h: 0.16,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 7,
    bold: true,
    color: "FFFFFF",
    align: "center",
    fit: "shrink"
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 2.85,
    y: 1.76,
    w: 0.28,
    h: 0.025,
    fill: { color: "FFFFFF" },
    line: { color: "FFFFFF", transparency: 100 }
  });
  const hook = clampText(direction?.hook, 105);
  slide.addText(hook, {
    x: 1.69,
    y: 2.02,
    w: 1.82,
    h: 0.92,
    margin: 0,
    ...localizedTextStyle(hook),
    fontSize: 14.5,
    bold: true,
    color: "FFFFFF",
    align: "center",
    valign: "middle",
    fit: "shrink",
    shadow: {
      type: "outer",
      color: "000000",
      opacity: 0.55,
      blur: 1.5,
      angle: 45
    }
  });
  slide.addText("♡\n1.2K\n◯\n86\n↗\nShare", {
    x: 3.49,
    y: 3.34,
    w: 0.3,
    h: 1.24,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 6.2,
    bold: true,
    color: "FFFFFF",
    align: "center",
    valign: "bottom",
    breakLine: false,
    fit: "shrink"
  });
  const creatorHandle = brandName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 18) || "creativecompass";
  slide.addText(`@${creatorHandle}creator`, {
    x: 1.64,
    y: 4.82,
    w: 1.65,
    h: 0.16,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 7.2,
    bold: true,
    color: "FFFFFF",
    fit: "shrink"
  });
  const caption = clampText(direction?.caption || brief.referenceDirection, 125);
  slide.addText(caption, {
    x: 1.64,
    y: 5.05,
    w: 1.82,
    h: 0.37,
    margin: 0,
    ...localizedTextStyle(caption),
    fontSize: 6.8,
    color: "FFFFFF",
    valign: "top",
    fit: "shrink"
  });
  slide.addText(`♫ Original sound · ${brandName}`, {
    x: 1.64,
    y: 5.49,
    w: 1.84,
    h: 0.14,
    margin: 0,
    ...localizedTextStyle(brandName),
    fontSize: 6.2,
    color: "FFFFFF",
    fit: "shrink"
  });
  slide.addText("Home       Discover        +        Inbox       Profile", {
    x: 1.58,
    y: 5.77,
    w: 2.22,
    h: 0.12,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 4.8,
    bold: true,
    color: "FFFFFF",
    align: "center",
    fit: "shrink"
  });
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
  addUgcPhoneMockup(
    pptx,
    slide,
    brandName,
    brief,
    direction,
    referenceImage
  );

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
  slide.addText("UGC VIDEO", {
    x: 11.08,
    y: 0.64,
    w: 1.28,
    h: 0.22,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 8,
    bold: true,
    color: COLORS.limeInk,
    align: "right",
    charSpacing: 0.8
  });
  const hook = clampText(direction?.hook, 170);
  const hookFontSize = fontSizeForFixedTextBox(
    hook,
    6.86,
    0.72,
    [25, 22, 19]
  );
  slide.addText(hook, {
    x: 5.5,
    y: 1.04,
    w: 6.86,
    h: 0.72,
    margin: 0,
    ...localizedTextStyle(hook),
    fontSize: hookFontSize,
    bold: true,
    color: COLORS.ink,
    valign: "top",
    breakLine: false
  });

  const projectDetails = `${brief.product}  •  ${brief.duration}`;
  slide.addText(projectDetails, {
    x: 5.5,
    y: 1.88,
    w: 6.86,
    h: 0.22,
    margin: 0,
    ...localizedTextStyle(projectDetails),
    fontSize: 9.5,
    bold: true,
    color: COLORS.violet,
    fit: "shrink"
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 5.5,
    y: 2.28,
    w: 0.42,
    h: 0.04,
    fill: { color: COLORS.violet },
    line: { color: COLORS.violet }
  });
  slide.addText("CREATIVE OBJECTIVE", {
    x: 5.5,
    y: 2.48,
    w: 1.2,
    h: 0.16,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 7.5,
    bold: true,
    color: COLORS.muted,
    charSpacing: 1
  });
  const objective = clampText(brief.objective, 260);
  const objectiveFontSize = fontSizeForFixedTextBox(
    objective,
    6.86,
    0.72,
    [12.5, 11, 9.5]
  );
  slide.addText(objective, {
    x: 5.5,
    y: 2.73,
    w: 6.86,
    h: 0.72,
    margin: 0,
    ...localizedTextStyle(objective),
    fontSize: objectiveFontSize,
    color: COLORS.ink,
    valign: "top",
    breakLine: false,
    paraSpaceAfter: 5
  });

  slide.addText("VIDEO STORYLINE", {
    x: 5.5,
    y: 3.68,
    w: 2.1,
    h: 0.18,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 8,
    bold: true,
    color: COLORS.muted,
    charSpacing: 1.1
  });
  addUgcScriptRow(pptx, slide, 1, "OPEN / HOOK", brief.openingScript, 4.0);
  addUgcScriptRow(pptx, slide, 2, "SHOWCASE", brief.showcaseScript, 4.64);
  addUgcScriptRow(pptx, slide, 3, "END / CTA", brief.closingScript, 5.28);

  slide.addShape(pptx.ShapeType.line, {
    x: 5.5,
    y: 6.0,
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
    y: 6.16,
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
  slide.addNotes(
    `[Sources]\n- Creative direction and caption: confirmed workflow data for ${brandName}.\n- Visual reference: selected UGC reference image in the workflow.`
  );
}

function addArtworkPreview(
  slide: PptxGenJS.Slide,
  data: string,
  outputSize: WorkflowState["outputSize"],
  altText: string,
  box = { x: 0.52, y: 0.48, w: 5.84, h: 6.54 }
) {
  const [pixelWidth, pixelHeight] = outputSize.split("x").map(Number);
  const ratio = pixelWidth && pixelHeight ? pixelWidth / pixelHeight : 1;
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
  format: AlbumFormat,
  box = { x: 0.52, y: 0.68, w: 5.84, h: 6.14 }
) {
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

function addSinglePageArtworkSlide(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  item: ClientSlideItem,
  brandName: string,
  slideNumber: number,
  totalSlides: number,
  outputSize: WorkflowState["outputSize"],
  albumFormat: AlbumFormat,
  imageData: readonly string[]
) {
  const { output, direction } = item;
  const albumLayout = isAlbumOutput(output) && imageData.length > 1;
  const artworkPanel = albumLayout
    ? { x: 3.85, y: 0.45, w: 6, h: 6.6 }
    : { x: 3.85, y: 0.45, w: 4.72, h: 6.6 };
  const artworkBox = albumLayout
    ? { x: 4.04, y: 0.68, w: 5.62, h: 6.14 }
    : { x: 4.04, y: 0.68, w: 4.34, h: 6.14 };
  const captionPanel = albumLayout
    ? { x: 10.08, y: 0.45, w: 2.8, h: 6.6 }
    : { x: 8.8, y: 0.45, w: 4.08, h: 6.6 };
  const captionBox = albumLayout
    ? { x: 10.38, y: 0.74, w: 2.2, h: 5.9 }
    : { x: 9.15, y: 0.74, w: 3.38, h: 5.9 };
  slide.background = { color: COLORS.canvas };

  slide.addShape(pptx.ShapeType.line, {
    x: 3.62,
    y: 0.48,
    w: 0,
    h: 6.54,
    line: { color: COLORS.line, width: 1 }
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    ...artworkPanel,
    rectRadius: 0.16,
    fill: { color: COLORS.paper },
    line: { color: COLORS.line, width: 1 }
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    ...captionPanel,
    rectRadius: 0.16,
    fill: { color: COLORS.paper },
    line: { color: COLORS.line, width: 1 }
  });
  if (albumLayout) {
    addAlbumArtworkPreview(
      slide,
      imageData,
      brandName,
      albumFormat,
      artworkBox
    );
  } else if (imageData[0]) {
    addArtworkPreview(
      slide,
      imageData[0],
      outputSize,
      `${brandName} ${output.format} creative artwork`,
      artworkBox
    );
  }

  const displayBrandName = brandName.toUpperCase();
  slide.addText(displayBrandName, {
    x: 0.55,
    y: 0.6,
    w: 1.72,
    h: 0.22,
    margin: 0,
    ...localizedTextStyle(displayBrandName),
    fontSize: 8,
    bold: true,
    color: COLORS.violet,
    charSpacing: 1.2
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 2.35,
    y: 0.5,
    w: 1.04,
    h: 0.38,
    rectRadius: 0.08,
    fill: { color: COLORS.lime },
    line: { color: COLORS.lime }
  });
  const formatLabel = output.format.toUpperCase();
  slide.addText(formatLabel, {
    x: 2.43,
    y: 0.61,
    w: 0.88,
    h: 0.14,
    margin: 0,
    ...localizedTextStyle(formatLabel),
    fontSize: 7.5,
    bold: true,
    color: COLORS.limeInk,
    align: "center",
    fit: "shrink"
  });
  const hook = clampText(direction?.hook, 170);
  const hookFontSize = fontSizeForFixedTextBox(
    hook,
    2.84,
    1.58,
    [24, 22, 20, 18]
  );
  slide.addText(hook, {
    x: 0.55,
    y: 1.13,
    w: 2.84,
    h: 1.58,
    margin: 0,
    ...localizedTextStyle(hook),
    fontSize: hookFontSize,
    bold: true,
    color: COLORS.ink,
    valign: "top",
    fit: "shrink",
    breakLine: false
  });
  addTextBlock(
    slide,
    "Sub-headline",
    direction ? directionSubheadline(direction as CreativeDirection) : undefined,
    {
      x: 0.55,
      y: 2.93,
      w: 2.84,
      h: 0.86,
      maxLength: 260,
      fontSize: 11.5
    }
  );
  addTextBlock(slide, "Creative concept", direction?.concept, {
    x: 0.55,
    y: 4.03,
    w: 2.84,
    h: 1.22,
    maxLength: 260,
    fontSize: 10.5
  });

  slide.addText("CALL TO ACTION", {
    x: 0.55,
    y: 5.53,
    w: 2.84,
    h: 0.2,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 8,
    bold: true,
    color: COLORS.muted,
    charSpacing: 1.1
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.55,
    y: 5.86,
    w: 2.84,
    h: 0.62,
    rectRadius: 0.12,
    fill: { color: COLORS.ink },
    line: { color: COLORS.ink }
  });
  const callToAction = clampText(direction?.cta, 120);
  slide.addText(callToAction, {
    x: 0.76,
    y: 6.05,
    w: 2.42,
    h: 0.21,
    margin: 0,
    ...localizedTextStyle(callToAction),
    fontSize: 11,
    bold: true,
    color: COLORS.paper,
    align: "center",
    fit: "shrink"
  });

  addCaptionBlock(slide, direction?.caption, captionBox);

  slide.addShape(pptx.ShapeType.line, {
    x: captionBox.x,
    y: 6.64,
    w: captionBox.w,
    h: 0,
    line: { color: COLORS.line, width: 1 }
  });
  slide.addText(`${slideNumber} / ${totalSlides}`, {
    x: captionPanel.x + captionPanel.w - 1.03,
    y: 6.78,
    w: 0.68,
    h: 0.2,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 8,
    color: COLORS.muted,
    align: "right"
  });
  slide.addNotes(
    `[Sources]\n- Headline, sub-headline, creative concept, CTA, and caption: confirmed workflow data for ${brandName}.\n- Artwork: generated creative asset attached to this output.`
  );
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
  addSinglePageArtworkSlide(
    pptx,
    slide,
    item,
    brandName,
    slideNumber,
    totalSlides,
    outputSize,
    albumFormat,
    imageData
  );
  return;

  slide.background = { color: COLORS.paper };
  const displayBrandName = brandName.toUpperCase();
  slide.addText("CREATIVE DIRECTION", {
    x: 0.48,
    y: 0.38,
    w: 4.6,
    h: 0.38,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 24,
    bold: true,
    color: COLORS.ink
  });
  slide.addText(displayBrandName, {
    x: 8.62,
    y: 0.42,
    w: 4.1,
    h: 0.22,
    margin: 0,
    ...localizedTextStyle(displayBrandName),
    fontSize: 8,
    bold: true,
    color: COLORS.violet,
    charSpacing: 1.2,
    align: "right"
  });
  const formatMetadata = `${output.format.toUpperCase()}  ·  ${outputSize}`;
  slide.addText(formatMetadata, {
    x: 8.62,
    y: 0.72,
    w: 4.1,
    h: 0.22,
    margin: 0,
    ...localizedTextStyle(formatMetadata),
    fontSize: 8,
    bold: true,
    color: COLORS.muted,
    align: "right",
    charSpacing: 0.8
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 0.48,
    y: 1.06,
    w: 12.24,
    h: 0,
    line: { color: COLORS.line, width: 1 }
  });
  [3.34, 6.37, 9.4].forEach((x) => {
    slide.addShape(pptx.ShapeType.line, {
      x,
      y: 1.34,
      w: 0,
      h: 5.28,
      line: { color: COLORS.line, width: 1 }
    });
  });

  slide.addText("CONCEPT IDEA", {
    x: 0.48,
    y: 1.36,
    w: 2.65,
    h: 0.2,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 9,
    bold: true,
    color: COLORS.violet,
    charSpacing: 1
  });
  const concept = clampText(direction?.concept, 300);
  const conceptFontSize = fontSizeForFixedTextBox(
    concept,
    2.65,
    1.35,
    [17, 15, 13]
  );
  slide.addText(concept, {
    x: 0.48,
    y: 1.76,
    w: 2.65,
    h: 1.35,
    margin: 0,
    ...localizedTextStyle(concept),
    fontSize: conceptFontSize,
    bold: true,
    color: COLORS.ink,
    valign: "top",
    breakLine: false
  });
  slide.addText("WHY IT WORKS", {
    x: 0.48,
    y: 3.46,
    w: 2.65,
    h: 0.2,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 9,
    bold: true,
    color: COLORS.muted,
    charSpacing: 1
  });
  const why = clampText(direction?.why, 360);
  slide.addText(why, {
    x: 0.48,
    y: 3.82,
    w: 2.65,
    h: 1.72,
    margin: 0,
    ...localizedTextStyle(why),
    fontSize: 13,
    color: COLORS.ink,
    valign: "top",
    breakLine: false
  });

  slide.addText("KEY MESSAGE", {
    x: 3.57,
    y: 1.36,
    w: 2.58,
    h: 0.2,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 9,
    bold: true,
    color: COLORS.violet,
    charSpacing: 1
  });
  const hook = clampText(direction?.hook, 170);
  const hookFontSize = fontSizeForFixedTextBox(
    hook,
    2.58,
    1.72,
    [19, 17, 15]
  );
  slide.addText(hook, {
    x: 3.57,
    y: 1.76,
    w: 2.58,
    h: 1.72,
    margin: 0,
    ...localizedTextStyle(hook),
    fontSize: hookFontSize,
    bold: true,
    color: COLORS.ink,
    valign: "top",
    breakLine: false
  });
  slide.addText("SUPPORTING LINE", {
    x: 3.57,
    y: 3.72,
    w: 2.58,
    h: 0.2,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 9,
    bold: true,
    color: COLORS.muted,
    charSpacing: 1
  });
  const subheadline = clampText(
    direction ? directionSubheadline(direction as CreativeDirection) : undefined,
    300
  );
  slide.addText(subheadline, {
    x: 3.57,
    y: 4.08,
    w: 2.58,
    h: 1.46,
    margin: 0,
    ...localizedTextStyle(subheadline),
    fontSize: 13,
    color: COLORS.ink,
    valign: "top",
    breakLine: false
  });

  slide.addText("CREATIVE DRAFT", {
    x: 6.6,
    y: 1.36,
    w: 2.58,
    h: 0.2,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 9,
    bold: true,
    color: COLORS.violet,
    charSpacing: 1
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 6.6,
    y: 1.76,
    w: 2.58,
    h: 3.92,
    fill: { color: COLORS.canvas },
    line: { color: COLORS.line, width: 1 }
  });
  if (isAlbumOutput(output) && imageData.length > 1) {
    addAlbumArtworkPreview(
      slide,
      imageData,
      brandName,
      albumFormat,
      { x: 6.72, y: 1.9, w: 2.34, h: 3.64 }
    );
  } else if (imageData[0]) {
    addArtworkPreview(
      slide,
      imageData[0]!,
      outputSize,
      `${brandName} ${output.format} creative draft`,
      { x: 6.72, y: 1.9, w: 2.34, h: 3.64 }
    );
  }
  slide.addText(output.format, {
    x: 6.6,
    y: 5.92,
    w: 2.58,
    h: 0.24,
    margin: 0,
    ...localizedTextStyle(output.format),
    fontSize: 10,
    bold: true,
    color: COLORS.muted,
    align: "center"
  });

  slide.addText("CREATIVE BRIEF", {
    x: 9.64,
    y: 1.36,
    w: 3.08,
    h: 0.2,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 9,
    bold: true,
    color: COLORS.violet,
    charSpacing: 1
  });
  slide.addText("VISUAL DIRECTION", {
    x: 9.64,
    y: 1.82,
    w: 3.08,
    h: 0.18,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 8,
    bold: true,
    color: COLORS.muted,
    charSpacing: 0.9
  });
  const visualDirection = clampText(direction?.visual, 360);
  slide.addText(visualDirection, {
    x: 9.64,
    y: 2.12,
    w: 3.08,
    h: 1.38,
    margin: 0,
    ...localizedTextStyle(visualDirection),
    fontSize: 13,
    color: COLORS.ink,
    valign: "top",
    breakLine: false
  });
  slide.addText("PRIMARY CTA", {
    x: 9.64,
    y: 3.72,
    w: 3.08,
    h: 0.18,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 8,
    bold: true,
    color: COLORS.muted,
    charSpacing: 0.9
  });
  const callToAction = clampText(direction?.cta, 160);
  slide.addText(callToAction, {
    x: 9.64,
    y: 4.04,
    w: 3.08,
    h: 0.74,
    margin: 0,
    ...localizedTextStyle(callToAction),
    fontSize: 16,
    bold: true,
    color: COLORS.ink,
    valign: "top",
    breakLine: false
  });
  slide.addText("CONTENT PILLAR", {
    x: 9.64,
    y: 5.12,
    w: 3.08,
    h: 0.18,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 8,
    bold: true,
    color: COLORS.muted,
    charSpacing: 0.9
  });
  const pillar = clampText(
    direction?.pillar ?? direction?.objective ?? direction?.service,
    180
  );
  slide.addText(pillar, {
    x: 9.64,
    y: 5.42,
    w: 3.08,
    h: 0.56,
    margin: 0,
    ...localizedTextStyle(pillar),
    fontSize: 12.5,
    color: COLORS.ink,
    valign: "top",
    breakLine: false
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 0.48,
    y: 6.72,
    w: 12.24,
    h: 0,
    line: { color: COLORS.line, width: 1 }
  });
  slide.addText("Creative brief + draft", {
    x: 0.48,
    y: 6.88,
    w: 2.8,
    h: 0.18,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 8,
    bold: true,
    color: COLORS.muted
  });
  slide.addText(`${slideNumber} / ${totalSlides}`, {
    x: 12.02,
    y: 6.88,
    w: 0.68,
    h: 0.2,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 8,
    color: COLORS.muted,
    align: "right"
  });
  slide.addNotes(
    `[Sources]\n- Concept, key message, visual direction, and CTA: confirmed workflow data for ${brandName}.\n- Creative draft: generated artwork attached to this output.`
  );
}

function addCaptionSlide(
  pptx: PptxGenJS,
  item: ClientSlideItem,
  brandName: string,
  captionChunk: string,
  chunkIndex: number,
  chunkCount: number,
  slideNumber: number,
  totalSlides: number,
  outputSize: WorkflowState["outputSize"],
  albumFormat: AlbumFormat,
  imageData: readonly string[] = []
) {
  const { output, direction } = item;
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.canvas };

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.35,
    y: 0.35,
    w: 4.32,
    h: 6.8,
    rectRadius: 0.16,
    fill: { color: COLORS.paper },
    line: { color: COLORS.line, width: 1 }
  });
  const previewBox = { x: 0.62, y: 0.7, w: 3.78, h: 5.92 };
  if (isAlbumOutput(output) && imageData.length > 1) {
    addAlbumArtworkPreview(
      slide,
      imageData,
      brandName,
      albumFormat,
      { x: 0.62, y: 1.12, w: 3.78, h: 5.08 }
    );
  } else if (imageData[0] && !isUgcOutput(output)) {
    addArtworkPreview(
      slide,
      imageData[0],
      outputSize,
      `${brandName} ${output.format} caption reference`,
      previewBox
    );
  } else if (imageData[0]) {
    slide.addImage({
      data: imageData[0],
      ...previewBox,
      sizing: {
        type: "cover",
        x: previewBox.x,
        y: previewBox.y,
        w: previewBox.w,
        h: previewBox.h
      },
      altText: `${brandName} UGC caption reference`
    });
  } else {
    slide.addText(isUgcOutput(output) ? "UGC" : output.format.toUpperCase(), {
      x: previewBox.x,
      y: 2.8,
      w: previewBox.w,
      h: 0.6,
      margin: 0,
      fontFace: SLIDE_FONT_FACE,
      fontSize: 30,
      bold: true,
      color: COLORS.violet,
      align: "center"
    });
  }

  const displayBrandName = brandName.toUpperCase();
  slide.addText(displayBrandName, {
    x: 5.15,
    y: 0.48,
    w: 4.1,
    h: 0.22,
    margin: 0,
    ...localizedTextStyle(displayBrandName),
    fontSize: 8,
    bold: true,
    color: COLORS.violet,
    charSpacing: 1.2
  });
  const pageLabel =
    chunkCount > 1
      ? `ARTWORK & CAPTION · ${chunkIndex + 1}/${chunkCount}`
      : "ARTWORK & CAPTION";
  slide.addText(pageLabel, {
    x: 10.4,
    y: 0.48,
    w: 2.4,
    h: 0.22,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 8,
    bold: true,
    color: COLORS.limeInk,
    align: "right",
    charSpacing: 0.8
  });

  const hook = clampText(direction?.hook, 130);
  const hookFontSize = fontSizeForFixedTextBox(
    hook,
    7.55,
    0.74,
    [20, 18, 16]
  );
  slide.addText(hook, {
    x: 5.15,
    y: 0.98,
    w: 7.55,
    h: 0.74,
    margin: 0,
    ...localizedTextStyle(hook),
    fontSize: hookFontSize,
    bold: true,
    color: COLORS.ink,
    valign: "top",
    breakLine: false
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 5.15,
    y: 1.82,
    w: 0.46,
    h: 0.04,
    fill: { color: COLORS.violet },
    line: { color: COLORS.violet }
  });
  const captionFontSize = captionFontSizeForSlide(captionChunk);
  slide.addText(captionChunk, {
    x: 5.15,
    y: 2.0,
    w: 7.55,
    h: 4.45,
    margin: 0,
    ...localizedTextStyle(captionChunk),
    fontSize: captionFontSize,
    color: COLORS.ink,
    valign: "top",
    breakLine: false,
    paraSpaceAfter:
      captionFontSize >= 13 ? 8 : captionFontSize >= 10 ? 5 : 3
  });

  const callToAction = clampText(direction?.cta, 130);
  slide.addShape(pptx.ShapeType.line, {
    x: 5.15,
    y: 6.58,
    w: 7.55,
    h: 0,
    line: { color: COLORS.line, width: 1 }
  });
  slide.addText(`CTA · ${callToAction}`, {
    x: 5.15,
    y: 6.76,
    w: 6.6,
    h: 0.3,
    margin: 0,
    ...localizedTextStyle(callToAction),
    fontSize: 11,
    bold: true,
    color: COLORS.muted,
    breakLine: false
  });
  slide.addText(`${slideNumber} / ${totalSlides}`, {
    x: 12.02,
    y: 6.76,
    w: 0.68,
    h: 0.2,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 8,
    color: COLORS.muted,
    align: "right"
  });
  slide.addNotes(
    `[Sources]\n- Full caption and CTA: confirmed workflow data for ${brandName}.\n- Visual: generated creative asset or selected UGC reference attached to this output.`
  );
}

// Retained for backward-compatible deck variants; the restored client export
// intentionally emits one artwork-and-brief slide per creative.
void addCaptionSlide;

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
  const totalSlides = items.length;
  let slideNumber = 1;

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
    const albumFormat = resolveAlbumFormat(
      state.albumFormat,
      item.direction?.albumFormat
    );
    addClientSlide(
      pptx,
      item,
      brandName,
      slideNumber,
      totalSlides,
      state.outputSize,
      albumFormat,
      imageData
    );
    slideNumber += 1;
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
