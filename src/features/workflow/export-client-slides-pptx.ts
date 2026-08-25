import type PptxGenJS from "pptxgenjs";
import {
  resolveAlbumFormat,
  type AlbumFormat,
  type CreativeDirection,
  type CreativeOutput,
  type UgcScriptDocument,
  type UgcScriptSpeaker,
  type UgcVideoBrief,
  type UgcVideoScene
} from "../../domain/creative-run";
import { directionSubheadline } from "../../domain/subheadline-highlight";
import type { WorkflowState } from "./model";
import { approvalRolesForOutput } from "./rules";
import {
  captureUgcTemplatePreviewImages,
  type UgcPreviewImageMap
} from "./review/creative-previews";
import {
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
const UGC_LEFT_COLUMN_X = 0.38;
const UGC_LEFT_COLUMN_WIDTH = 2.52;
const UGC_PREVIEW_X = 3.02;
const UGC_PREVIEW_Y = 1.18;
const UGC_PREVIEW_WIDTH = 4.24;
const UGC_PREVIEW_HEIGHT = 5.3;
const UGC_SCRIPT_BODY_FONT_SIZE = 10;
const UGC_SCRIPT_COLUMN_X = 7.48;
const UGC_SCRIPT_COLUMN_WIDTH = 5.45;
const UGC_SCRIPT_COLUMN_TOP = 1.2;
const UGC_SCRIPT_COLUMN_BOTTOM = 7.0;
const UGC_SCRIPT_CONTINUATION_X = 0.54;
const UGC_SCRIPT_CONTINUATION_WIDTH = 12.26;
const UGC_SCRIPT_CONTINUATION_TOP = 1.1;
const UGC_SCRIPT_CONTINUATION_BOTTOM = 7.15;
const UGC_SCRIPT_CONTINUATION_COLUMN_GAP = 0.4;
const UGC_SCRIPT_CONTINUATION_COLUMN_WIDTH =
  (UGC_SCRIPT_CONTINUATION_WIDTH - UGC_SCRIPT_CONTINUATION_COLUMN_GAP) / 2;
const UGC_SCRIPT_CONTINUATION_RIGHT_COLUMN_X =
  UGC_SCRIPT_CONTINUATION_X +
  UGC_SCRIPT_CONTINUATION_COLUMN_WIDTH +
  UGC_SCRIPT_CONTINUATION_COLUMN_GAP;
const UGC_SCRIPT_LINE_HEIGHT_FACTOR = 1.3;

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
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
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

/**
 * estimatedWrappedLines is calibrated for continuous Thai prose (Concept
 * Idea, Mood and Tone) and assumes Latin characters are roughly as wide as
 * Thai ones. Storyline bullets mix short English beat titles ("Hook",
 * "Product Intro", "Misconception #1") with a Thai description, so that
 * assumption over-counts wraps and inflates the section's height. Use a
 * narrower per-character width tuned for this Latin-heavy short-line content
 * instead.
 */
function estimatedStorylineLines(
  value: string,
  widthInches: number,
  fontSize: number
): number {
  const charactersPerLine = Math.max(
    18,
    Math.floor((widthInches * 72) / (fontSize * 0.44))
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
  slide.addText("CAPTION", {
    x: options.x,
    y: options.y,
    w: options.w,
    h: 0.2,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 9,
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
    fontSize: 9,
    color: COLORS.ink,
    breakLine: false,
    valign: "top",
    fit: "shrink",
    lineSpacing: 10.35,
    paraSpaceAfter: 4
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
      scenes: [
        {
          title: "HOOK",
          duration: "0–5 วินาที",
          scriptLines: [cleanText(direction?.hook)],
          visual: cleanText(direction?.visual),
          textOverlay: cleanText(direction?.hook)
        },
        {
          title: "DEVELOPMENT",
          duration: "5–15 วินาที",
          scriptLines: [cleanText(direction?.concept)],
          visual: cleanText(direction?.visual),
          textOverlay: cleanText(beats[1], direction?.concept)
        },
        {
          title: "PROOF / BENEFIT",
          duration: "15–25 วินาที",
          scriptLines: [cleanText(direction?.why)],
          visual: cleanText(direction?.visual),
          textOverlay: cleanText(direction?.why)
        },
        {
          title: "CTA",
          duration: "25–30 วินาที",
          scriptLines: [cleanText(direction?.cta)],
          visual: cleanText(direction?.visual),
          textOverlay: cleanText(direction?.cta)
        }
      ]
    }
  );
}

function addUgcScriptScene(
  slide: PptxGenJS.Slide,
  index: number,
  scene: UgcVideoScene,
  y: number,
  h: number
) {
  const sceneTitle = `Scene ${index}: ${scene.title}`;
  slide.addText(sceneTitle, {
    x: 7.48,
    y,
    w: 5.45,
    h: 0.22,
    margin: 0,
    ...localizedTextStyle(sceneTitle),
    fontSize: UGC_SCRIPT_BODY_FONT_SIZE,
    bold: true,
    color: COLORS.ink,
    breakLine: false
  });
  slide.addText(scene.duration, {
    x: 11.9,
    y,
    w: 1.03,
    h: 0.22,
    margin: 0,
    ...localizedTextStyle(scene.duration),
    fontSize: UGC_SCRIPT_BODY_FONT_SIZE,
    color: COLORS.muted,
    align: "right",
    breakLine: false,
  });
  const script = clampText(
    scene.scriptLines.map((line) => `• ${line}`).join("\n"),
    190
  );
  slide.addText(script, {
    x: 7.48,
    y: y + 0.27,
    w: 5.45,
    h: Math.max(0.4, h - 0.94),
    margin: 0,
    ...localizedTextStyle(script),
    fontSize: UGC_SCRIPT_BODY_FONT_SIZE,
    color: COLORS.ink,
    valign: "top",
    breakLine: false
  });
  const visual = clampText(scene.visual, 115);
  slide.addText(
    [
      { text: "Visual: ", options: { bold: true, color: COLORS.violet } },
      { text: visual, options: { color: COLORS.ink } }
    ],
    {
      x: 7.48,
      y: y + h - 0.64,
      w: 5.45,
      h: 0.3,
      margin: 0,
      ...localizedTextStyle(visual),
      fontSize: UGC_SCRIPT_BODY_FONT_SIZE,
      breakLine: false
    }
  );
  const overlay = clampText(scene.textOverlay || "ไม่ใช้ข้อความบนจอ", 90);
  slide.addText(
    [
      {
        text: "Text Overlay: ",
        options: { bold: true, color: COLORS.violet }
      },
      { text: overlay, options: { color: COLORS.ink } }
    ],
    {
      x: 7.48,
      y: y + h - 0.31,
      w: 5.45,
      h: 0.3,
      margin: 0,
      ...localizedTextStyle(overlay),
      fontSize: UGC_SCRIPT_BODY_FONT_SIZE,
      breakLine: false
    }
  );
}

export interface UgcScriptRow {
  text: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color: string;
  gapBeforeInches: number;
  isLegalFooter?: boolean;
}

function defaultUgcSpeakerLabel(speaker: UgcScriptSpeaker): string {
  switch (speaker) {
    case "staff":
      return "พนักงาน";
    case "customer":
      return "ลูกค้า";
    case "narrator":
      return "เสียงบรรยาย";
    default:
      return "ข้อความบนจอ";
  }
}

/**
 * Flattens a rich UGC script into an ordered list of text rows a renderer can
 * lay out top-to-bottom. Beat/line count is flexible (AI-decided), unlike the
 * fixed 4-scene ugcBrief fallback, so this feeds a flowing layout rather than
 * fixed per-scene slots.
 */
export function buildUgcScriptRows(script: UgcScriptDocument): readonly UgcScriptRow[] {
  const rows: UgcScriptRow[] = [];
  script.beats.forEach((beat) => {
    const heading = beat.timecode
      ? `${cleanText(beat.title)} (${beat.timecode})`
      : cleanText(beat.title);
    rows.push({
      text: heading,
      fontSize: 11,
      bold: true,
      italic: false,
      color: COLORS.violet,
      gapBeforeInches: rows.length ? 0.14 : 0
    });
    beat.lines.forEach((line) => {
      const label = line.speakerLabel || defaultUgcSpeakerLabel(line.speaker);
      rows.push({
        text: `${label}: ${line.line}`,
        fontSize: 9.5,
        bold: false,
        italic: false,
        color: COLORS.ink,
        gapBeforeInches: 0.04
      });
      const noteParts = [
        line.direction,
        line.sfx ? `SFX: ${line.sfx}` : undefined
      ].filter((part): part is string => Boolean(part));
      if (noteParts.length) {
        rows.push({
          text: noteParts.join(" · "),
          fontSize: 8,
          bold: false,
          italic: true,
          color: COLORS.muted,
          gapBeforeInches: 0.01
        });
      }
    });
    if (beat.cameraNotes) {
      rows.push({
        text: `Camera: ${beat.cameraNotes}`,
        fontSize: 8,
        bold: false,
        italic: false,
        color: COLORS.muted,
        gapBeforeInches: 0.05
      });
    }
    if (beat.editingNotes) {
      rows.push({
        text: `Editing: ${beat.editingNotes}`,
        fontSize: 8,
        bold: false,
        italic: false,
        color: COLORS.muted,
        gapBeforeInches: 0.02
      });
    }
    if (beat.legalFlag) {
      rows.push({
        text: `Legal review: ${beat.legalFlag}`,
        fontSize: 8,
        bold: false,
        italic: false,
        color: COLORS.muted,
        gapBeforeInches: 0.02
      });
    }
  });

  if (script.shotList.length) {
    rows.push({
      text: "Shot list",
      fontSize: 11,
      bold: true,
      italic: false,
      color: COLORS.violet,
      gapBeforeInches: 0.18
    });
    script.shotList.forEach((item) => {
      rows.push({
        text: `• ${item}`,
        fontSize: 9,
        bold: false,
        italic: false,
        color: COLORS.ink,
        gapBeforeInches: 0.02
      });
    });
  }
  if (script.editingNotes.length) {
    rows.push({
      text: "Editing notes",
      fontSize: 11,
      bold: true,
      italic: false,
      color: COLORS.violet,
      gapBeforeInches: 0.18
    });
    script.editingNotes.forEach((item) => {
      rows.push({
        text: `• ${item}`,
        fontSize: 9,
        bold: false,
        italic: false,
        color: COLORS.ink,
        gapBeforeInches: 0.02
      });
    });
  }
  if (script.legalFooter) {
    rows.push({
      text: script.legalFooter,
      fontSize: 8.5,
      bold: true,
      italic: false,
      color: COLORS.ink,
      gapBeforeInches: 0.2,
      isLegalFooter: true
    });
  }

  return rows;
}

function ugcScriptRowLineCount(row: UgcScriptRow, widthInches: number): number {
  return estimatedWrappedLines(row.text, widthInches, row.fontSize);
}

function ugcScriptRowHeightInches(lineCount: number, fontSize: number): number {
  return (lineCount * fontSize * UGC_SCRIPT_LINE_HEIGHT_FACTOR) / 72;
}

type UgcScriptLayoutState = "primary" | "continuation-left" | "continuation-right";

/**
 * Renders a flexible-length UGC script starting in the slide's script column.
 * When content would overflow, it moves to the right half of a full-width
 * "Script (cont'd)" slide, and only starts a genuinely new slide once both
 * halves of that slide are full — beat count is AI-decided per brand, so the
 * layout has to flex (and use the page efficiently) rather than the content.
 */
export function addUgcScriptRows(
  pptx: PptxGenJS,
  firstSlide: PptxGenJS.Slide,
  rows: readonly UgcScriptRow[],
  hook: string
): void {
  let slide = firstSlide;
  let columnX = UGC_SCRIPT_COLUMN_X;
  let columnWidth = UGC_SCRIPT_COLUMN_WIDTH;
  let bottomLimit = UGC_SCRIPT_COLUMN_BOTTOM;
  let cursorY = UGC_SCRIPT_COLUMN_TOP;
  let layoutState: UgcScriptLayoutState = "primary";

  const startContinuationSlide = () => {
    slide = pptx.addSlide();
    slide.background = { color: COLORS.paper };
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.36,
      y: 0.28,
      w: 0.08,
      h: 0.3,
      fill: { color: COLORS.violet },
      line: { color: COLORS.violet }
    });
    slide.addText("SCRIPT (CONT'D)", {
      x: 0.54,
      y: 0.25,
      w: 8,
      h: 0.36,
      margin: 0,
      fontFace: SLIDE_FONT_FACE,
      fontSize: 18,
      bold: true,
      color: COLORS.ink,
      breakLine: false
    });
    const subtitle = clampText(hook, 140);
    slide.addText(subtitle, {
      x: 0.54,
      y: 0.62,
      w: UGC_SCRIPT_CONTINUATION_WIDTH,
      h: 0.24,
      margin: 0,
      ...localizedTextStyle(subtitle),
      fontSize: 10,
      color: COLORS.muted,
      breakLine: false
    });
    slide.addShape(pptx.ShapeType.line, {
      x: 0.35,
      y: 0.94,
      w: 12.63,
      h: 0,
      line: { color: COLORS.line, width: 1 }
    });
    slide.addShape(pptx.ShapeType.line, {
      x: UGC_SCRIPT_CONTINUATION_RIGHT_COLUMN_X - UGC_SCRIPT_CONTINUATION_COLUMN_GAP / 2,
      y: UGC_SCRIPT_CONTINUATION_TOP,
      w: 0,
      h: UGC_SCRIPT_CONTINUATION_BOTTOM - UGC_SCRIPT_CONTINUATION_TOP,
      line: { color: COLORS.line, width: 0.75 }
    });
    columnX = UGC_SCRIPT_CONTINUATION_X;
    columnWidth = UGC_SCRIPT_CONTINUATION_COLUMN_WIDTH;
    bottomLimit = UGC_SCRIPT_CONTINUATION_BOTTOM;
    cursorY = UGC_SCRIPT_CONTINUATION_TOP;
    layoutState = "continuation-left";
  };

  const advance = () => {
    if (layoutState === "continuation-left") {
      columnX = UGC_SCRIPT_CONTINUATION_RIGHT_COLUMN_X;
      cursorY = UGC_SCRIPT_CONTINUATION_TOP;
      layoutState = "continuation-right";
      return;
    }
    startContinuationSlide();
  };

  for (const row of rows) {
    let lineCount = ugcScriptRowLineCount(row, columnWidth);
    let rowHeight = ugcScriptRowHeightInches(lineCount, row.fontSize);
    if (cursorY + row.gapBeforeInches + rowHeight > bottomLimit) {
      advance();
      lineCount = ugcScriptRowLineCount(row, columnWidth);
      rowHeight = ugcScriptRowHeightInches(lineCount, row.fontSize);
    }
    cursorY += row.gapBeforeInches;
    if (row.isLegalFooter) {
      slide.addShape(pptx.ShapeType.line, {
        x: columnX,
        y: cursorY,
        w: columnWidth,
        h: 0,
        line: { color: COLORS.line, width: 0.75 }
      });
      cursorY += 0.07;
    }
    slide.addText(row.text, {
      x: columnX,
      y: cursorY,
      w: columnWidth,
      h: rowHeight,
      margin: 0,
      ...localizedTextStyle(row.text),
      fontSize: row.fontSize,
      bold: row.bold,
      italic: row.italic,
      color: row.color,
      valign: "top",
      breakLine: false
    });
    cursorY += rowHeight;
  }
}

function addUgcSectionHeading(
  slide: PptxGenJS.Slide,
  text: string,
  y: number
) {
  slide.addText(text, {
    x: UGC_LEFT_COLUMN_X,
    y,
    w: UGC_LEFT_COLUMN_WIDTH,
    h: 0.26,
    margin: 0,
    ...localizedTextStyle(text),
    fontSize: 15.5,
    bold: true,
    color: COLORS.violet,
    breakLine: false
  });
}

function addCapturedUgcPreview(
  slide: PptxGenJS.Slide,
  brandName: string,
  previewImage: string | undefined
) {
  if (!previewImage) {
    throw new Error(
      "The UGC preview image was not captured from Create. Keep the Create page open and retry."
    );
  }
  slide.addImage({
    data: previewImage,
    x: UGC_PREVIEW_X,
    y: UGC_PREVIEW_Y,
    w: UGC_PREVIEW_WIDTH,
    h: UGC_PREVIEW_HEIGHT,
    altText: `${brandName} UGC preview captured from Create`
  });
}

function addHookReferencePreview(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  data: readonly string[],
  x: number,
  y: number
) {
  if (!data.length) return;
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w: 1.16,
    h: 1.27,
    rectRadius: 0.08,
    fill: { color: COLORS.paper, transparency: 3 },
    line: { color: COLORS.line, width: 1 }
  });
  slide.addText("REFERENCE", {
    x: x + 0.08,
    y: y + 0.06,
    w: 1,
    h: 0.13,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 5.8,
    bold: true,
    color: COLORS.muted,
    charSpacing: 0.7,
    align: "center"
  });
  const columns = data.length === 1 ? 1 : 2;
  const rows = Math.ceil(data.length / columns);
  const gap = 0.04;
  const cellWidth = (1 - gap * (columns - 1)) / columns;
  const cellHeight = (0.96 - gap * (rows - 1)) / rows;
  data.forEach((image, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    slide.addImage({
      data: image,
      x: x + 0.08 + column * (cellWidth + gap),
      y: y + 0.23 + row * (cellHeight + gap),
      w: cellWidth,
      h: cellHeight,
      altText: `Hook reference image ${index + 1}`
    });
  });
}

function addHookReferencePanel(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  data: readonly string[],
  box: { x: number; y: number; w: number; h: number }
) {
  if (!data.length) return;
  slide.addShape(pptx.ShapeType.roundRect, {
    ...box,
    rectRadius: 0.16,
    fill: { color: COLORS.paper },
    line: { color: COLORS.line, width: 1 }
  });
  slide.addText("REFERENCE", {
    x: box.x + 0.19,
    y: box.y + 0.15,
    w: box.w - 0.38,
    h: 0.18,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 8,
    bold: true,
    color: COLORS.muted,
    charSpacing: 1.1
  });

  const imageWidth = 1.7;
  const imageHeight = 1.86;
  const gap = 0.45;
  const totalWidth = imageWidth * data.length + gap * (data.length - 1);
  const startX = box.x + (box.w - totalWidth) / 2;
  data.forEach((image, index) => {
    slide.addImage({
      data: image,
      x: startX + index * (imageWidth + gap),
      y: box.y + 0.53,
      w: imageWidth,
      h: imageHeight,
      altText: `Hook reference image ${index + 1}`
    });
  });
}

function addUgcClientSlide(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  direction: CreativeDirection | undefined,
  brandName: string,
  previewImage?: string,
  referenceImages: readonly string[] = []
) {
  const brief = resolvedUgcBrief(direction, brandName);
  slide.background = { color: COLORS.paper };
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.36,
    y: 0.28,
    w: 0.08,
    h: 0.3,
    fill: { color: COLORS.violet },
    line: { color: COLORS.violet }
  });
  slide.addText("SHORT VIDEO STORYLINE", {
    x: 0.54,
    y: 0.25,
    w: 4.3,
    h: 0.36,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 18,
    bold: true,
    color: COLORS.ink,
    breakLine: false
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 0.35,
    y: 0.69,
    w: 12.63,
    h: 0,
    line: { color: COLORS.line, width: 1 }
  });

  addCapturedUgcPreview(slide, brandName, previewImage);
  addHookReferencePreview(pptx, slide, referenceImages, 5.94, 5.64);

  const headline = clampText(direction?.hook, 125);
  slide.addText(
    [
      { text: "Headline: ", options: { bold: true, color: COLORS.violet } },
      { text: headline, options: { color: COLORS.ink } }
    ],
    {
      x: UGC_LEFT_COLUMN_X,
      y: 0.92,
      w: UGC_LEFT_COLUMN_WIDTH,
      h: 0.72,
      margin: 0,
      ...localizedTextStyle(headline),
      fontSize: 10.2,
      breakLine: false,
      valign: "top",
      fit: "shrink"
    }
  );
  slide.addText(
    [
      { text: "Time: ", options: { bold: true, color: COLORS.ink } },
      { text: brief.duration, options: { color: COLORS.ink } }
    ],
    {
      x: UGC_LEFT_COLUMN_X,
      y: 1.73,
      w: UGC_LEFT_COLUMN_WIDTH,
      h: 0.22,
      margin: 0,
      ...localizedTextStyle(brief.duration),
      fontSize: 10,
      breakLine: false
    }
  );
  // The whole left column below the headline flows top-to-bottom: each
  // section's actual wrapped height (not a size tuned for the old fixed
  // 4-item Storyline list) pushes the next section's divider/heading/text,
  // so short content pulls everything up and long content pushes it down —
  // no fixed y-value can overlap or leave a gap for the section above it.
  const CONCEPT_HEADING_Y = 2.08;
  const CONCEPT_TEXT_Y = 2.48;
  const CONCEPT_TEXT_MAX_HEIGHT = 1.12;
  const CONCEPT_TO_DIVIDER_GAP = 0.12;
  const DIVIDER_TO_STORYLINE_HEADING_GAP = 0.26;
  const STORYLINE_HEADING_TO_TEXT_GAP = 0.38;
  const STORYLINE_MIN_HEIGHT = 0.92;
  const STORYLINE_TO_DIVIDER_GAP = 0.1;
  const DIVIDER_TO_MOOD_HEADING_GAP = 0.24;
  const MOOD_HEADING_TO_TEXT_GAP = 0.4;
  // fontSizeForFixedTextBox/estimatedWrappedLines use a 1.28 line-height
  // factor tuned as a safety margin for picking a font size that fits a
  // *fixed* box — harmless there since leftover space was never visible.
  // Reusing that factor to size a *dynamic* box makes the margin visible as
  // dead space above the next section, so this cascade uses a tighter
  // factor instead (still >1 to keep some buffer against underestimating).
  const LEFT_COLUMN_CASCADE_LINE_HEIGHT_FACTOR = 1.15;

  addUgcSectionHeading(slide, "Concept Idea:", CONCEPT_HEADING_Y);
  const concept = clampText(direction?.concept, 285);
  const conceptFontSize = fontSizeForFixedTextBox(
    concept,
    UGC_LEFT_COLUMN_WIDTH,
    CONCEPT_TEXT_MAX_HEIGHT,
    [10, 9, 8]
  );
  const conceptHeight = Math.min(
    CONCEPT_TEXT_MAX_HEIGHT,
    Math.max(
      0.3,
      (estimatedWrappedLines(concept, UGC_LEFT_COLUMN_WIDTH, conceptFontSize) *
        conceptFontSize *
        LEFT_COLUMN_CASCADE_LINE_HEIGHT_FACTOR) /
        72
    )
  );
  slide.addText(concept, {
    x: UGC_LEFT_COLUMN_X,
    y: CONCEPT_TEXT_Y,
    w: UGC_LEFT_COLUMN_WIDTH,
    h: conceptHeight,
    margin: 0,
    ...localizedTextStyle(concept),
    fontSize: conceptFontSize,
    color: COLORS.ink,
    valign: "top",
    breakLine: false
  });
  const conceptDividerY = CONCEPT_TEXT_Y + conceptHeight + CONCEPT_TO_DIVIDER_GAP;
  slide.addShape(pptx.ShapeType.line, {
    x: UGC_LEFT_COLUMN_X,
    y: conceptDividerY,
    w: UGC_LEFT_COLUMN_WIDTH,
    h: 0,
    line: { color: COLORS.muted, width: 0.8 }
  });

  const storylineHeadingY = conceptDividerY + DIVIDER_TO_STORYLINE_HEADING_GAP;
  const storylineTextY = storylineHeadingY + STORYLINE_HEADING_TO_TEXT_GAP;
  addUgcSectionHeading(slide, "Storyline:", storylineHeadingY);
  const storyline = (
    direction?.ugcScript?.beats.length
      ? direction.ugcScript.beats.map((beat) => `• ${beat.title}`)
      : brief.scenes.map((scene) => `• ${scene.title}`)
  ).join("\n");
  const storylineLines = estimatedStorylineLines(
    storyline,
    UGC_LEFT_COLUMN_WIDTH - 0.1,
    9.6
  );
  const storylineHeight = Math.max(
    STORYLINE_MIN_HEIGHT,
    (storylineLines * 9.6 * LEFT_COLUMN_CASCADE_LINE_HEIGHT_FACTOR) / 72
  );
  const storylineDividerY =
    storylineTextY + storylineHeight + STORYLINE_TO_DIVIDER_GAP;
  const moodHeadingY = storylineDividerY + DIVIDER_TO_MOOD_HEADING_GAP;
  const moodTextY = moodHeadingY + MOOD_HEADING_TO_TEXT_GAP;

  slide.addText(storyline, {
    x: UGC_LEFT_COLUMN_X + 0.04,
    y: storylineTextY,
    w: UGC_LEFT_COLUMN_WIDTH - 0.1,
    h: storylineHeight,
    margin: 0,
    ...localizedTextStyle(storyline),
    fontSize: 9.6,
    color: COLORS.ink,
    breakLine: false,
    valign: "top"
  });
  slide.addShape(pptx.ShapeType.line, {
    x: UGC_LEFT_COLUMN_X,
    y: storylineDividerY,
    w: UGC_LEFT_COLUMN_WIDTH,
    h: 0,
    line: { color: COLORS.muted, width: 0.8 }
  });
  addUgcSectionHeading(slide, "Mood and Tone:", moodHeadingY);
  const mood = clampText(
    `${brief.moodAndTone} ${brief.productionStyle}`,
    220
  );
  const MOOD_TEXT_HEIGHT = 1.1;
  slide.addText(mood, {
    x: UGC_LEFT_COLUMN_X,
    y: moodTextY,
    w: UGC_LEFT_COLUMN_WIDTH,
    h: MOOD_TEXT_HEIGHT,
    margin: 0,
    ...localizedTextStyle(mood),
    fontSize: fontSizeForFixedTextBox(
      mood,
      UGC_LEFT_COLUMN_WIDTH,
      MOOD_TEXT_HEIGHT,
      [10.5, 9.5, 8.5]
    ),
    color: COLORS.ink,
    breakLine: false,
    valign: "top"
  });

  slide.addText("Script:", {
    x: 7.48,
    y: 0.82,
    w: 2,
    h: 0.34,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 16,
    bold: true,
    color: COLORS.violet,
    breakLine: false
  });
  if (direction?.ugcScript?.beats.length) {
    addUgcScriptRows(
      pptx,
      slide,
      buildUgcScriptRows(direction.ugcScript),
      direction.hook
    );
  } else {
    brief.scenes.forEach((scene, index) => {
      addUgcScriptScene(slide, index + 1, scene, 1.2 + index * 1.44, 1.38);
    });
  }

  slide.addText("Prepared by Convert Cake", {
    x: 7.48,
    y: 7.12,
    w: 2.5,
    h: 0.14,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 6.8,
    bold: true,
    color: COLORS.muted
  });
  slide.addNotes(
    `[Sources]\n- Creative direction and caption: confirmed workflow data for ${brandName}.\n- Visual reference: UGC preview captured from the Create stage and embedded as one PNG image.`
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
  const side = Math.min(box.w, box.h);
  const placements = albumSlidePlacements(
    {
      x: box.x + (box.w - side) / 2,
      y: box.y + (box.h - side) / 2,
      w: side,
      h: side
    },
    format
  );

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
  outputSize: WorkflowState["outputSize"],
  albumFormat: AlbumFormat,
  imageData: readonly string[],
  albumMasterData?: string,
  referenceImageData: readonly string[] = []
) {
  const { output, direction } = item;
  const albumLayout =
    isAlbumOutput(output) && (Boolean(albumMasterData) || imageData.length > 1);
  const hasReferenceLayout = referenceImageData.length > 0;
  const artworkPanel = hasReferenceLayout
    ? { x: 3.85, y: 0.45, w: 5.44, h: 4.04 }
    : albumLayout
      ? { x: 3.85, y: 0.45, w: 6, h: 6.6 }
      : { x: 3.85, y: 0.45, w: 4.72, h: 6.6 };
  const artworkBox = hasReferenceLayout
    ? { x: 4.04, y: 0.87, w: 5.06, h: 3.45 }
    : albumLayout
      ? { x: 4.04, y: 0.68, w: 5.62, h: 6.14 }
      : { x: 4.04, y: 0.68, w: 4.34, h: 6.14 };
  const captionPanel = hasReferenceLayout
    ? { x: 9.52, y: 0.45, w: 3.36, h: 6.6 }
    : albumLayout
      ? { x: 10.08, y: 0.45, w: 2.8, h: 6.6 }
      : { x: 8.8, y: 0.45, w: 4.08, h: 6.6 };
  const captionBox = hasReferenceLayout
    ? { x: 9.82, y: 0.74, w: 2.76, h: 5.9 }
    : albumLayout
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
  if (hasReferenceLayout) {
    slide.addText("CREATIVE DRAFT", {
      x: artworkPanel.x + 0.19,
      y: artworkPanel.y + 0.15,
      w: artworkPanel.w - 0.38,
      h: 0.18,
      margin: 0,
      fontFace: SLIDE_FONT_FACE,
      fontSize: 8,
      bold: true,
      color: COLORS.muted,
      charSpacing: 1.1
    });
  }
  slide.addShape(pptx.ShapeType.roundRect, {
    ...captionPanel,
    rectRadius: 0.16,
    fill: { color: COLORS.paper },
    line: { color: COLORS.line, width: 1 }
  });
  if (albumLayout) {
    if (albumMasterData) {
      addArtworkPreview(
        slide,
        albumMasterData,
        "2048x2048",
        `${brandName} album master grid`,
        artworkBox
      );
    } else {
      addAlbumArtworkPreview(
        slide,
        imageData,
        brandName,
        albumFormat,
        artworkBox
      );
    }
  } else if (imageData[0]) {
    addArtworkPreview(
      slide,
      imageData[0],
      outputSize,
      `${brandName} ${output.format} creative artwork`,
      artworkBox
    );
  }
  if (hasReferenceLayout) {
    addHookReferencePanel(pptx, slide, referenceImageData, {
      x: 3.85,
      y: 4.59,
      w: 5.44,
      h: 2.76
    });
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
  const subheadline = direction
    ? directionSubheadline(direction as CreativeDirection)
    : "";
  if (subheadline) {
    addTextBlock(slide, "Sub-headline", subheadline, {
      x: 0.55,
      y: 2.93,
      w: 2.84,
      h: 0.86,
      maxLength: 260,
      fontSize: 11.5
    });
  }
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
  slide.addNotes(
    `[Sources]\n- Headline, sub-headline, creative concept, CTA, and caption: confirmed workflow data for ${brandName}.\n- Artwork: generated creative asset attached to this output.`
  );
}

function addClientSlide(
  pptx: PptxGenJS,
  item: ClientSlideItem,
  brandName: string,
  outputSize: WorkflowState["outputSize"],
  albumFormat: AlbumFormat,
  imageData: readonly string[] = [],
  albumMasterData?: string,
  referenceImageData: readonly string[] = []
) {
  const { output, direction } = item;
  const slide = pptx.addSlide();
  if (isUgcOutput(output)) {
    addUgcClientSlide(
      pptx,
      slide,
      direction,
      brandName,
      imageData[0],
      referenceImageData
    );
    return;
  }
  addSinglePageArtworkSlide(
    pptx,
    slide,
    item,
    brandName,
    outputSize,
    albumFormat,
    imageData,
    albumMasterData,
    referenceImageData
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
  const subheadline = clampText(
    direction ? directionSubheadline(direction as CreativeDirection) : undefined,
    300
  );
  if (subheadline) {
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
  }

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
  slide.addNotes(
    `[Sources]\n- Concept, key message, visual direction, and CTA: confirmed workflow data for ${brandName}.\n- Creative draft: generated artwork attached to this output.`
  );
}

function addCaptionSlide(
  pptx: PptxGenJS,
  item: ClientSlideItem,
  brandName: string,
  captionChunk: string,
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
  slide.addText("ARTWORK & CAPTION", {
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
  slide.addNotes(
    `[Sources]\n- Full caption and CTA: confirmed workflow data for ${brandName}.\n- Visual: generated creative asset or selected UGC reference attached to this output.`
  );
}

// Retained for backward-compatible deck variants; the restored client export
// intentionally emits one artwork-and-brief slide per creative.
void addCaptionSlide;

export async function buildPmApprovedClientSlidesPptx(
  state: ClientSlidesState,
  resolveImage: ClientSlideImageResolver = fetchClientSlideImage,
  ugcPreviewImages: UgcPreviewImageMap = {}
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
    "client slides",
    ugcPreviewImages
  );
}

export async function buildCreateStageSlidesPptx(
  state: ClientSlidesState,
  resolveImage: ClientSlideImageResolver = fetchClientSlideImage,
  ugcPreviewImages: UgcPreviewImageMap = {}
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
    "creative slides",
    ugcPreviewImages
  );
}

async function buildClientSlidesPptx(
  state: ClientSlidesState,
  items: readonly ClientSlideItem[],
  resolveImage: ClientSlideImageResolver,
  subject: string,
  title: string,
  ugcPreviewImages: UgcPreviewImageMap
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
  for (const [index, item] of items.entries()) {
    let imageData: readonly string[] = [];
    let albumMasterData: string | undefined;
    const referenceImageData = await Promise.all(
      (item.direction?.referenceImages ?? []).map((reference) =>
        resolveImage(reference.url)
      )
    );
    if (isUgcOutput(item.output)) {
      const previewImage = ugcPreviewImages[item.output.id];
      if (!previewImage) {
        throw new Error(
          `The UGC preview for creative ${index + 1} was not captured from Create. Keep the page open and retry.`
        );
      }
      imageData = [previewImage];
    } else if (!isUgcOutput(item.output)) {
      const albumMasterUrl = isAlbumOutput(item.output)
        ? item.outputs.find((output) => output.albumMasterAssetUrl)
            ?.albumMasterAssetUrl
        : undefined;
      if (albumMasterUrl) {
        albumMasterData = await resolveImage(albumMasterUrl);
      } else {
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
    }
    const albumFormat = resolveAlbumFormat(
      state.albumFormat,
      item.direction?.albumFormat
    );
    addClientSlide(
      pptx,
      item,
      brandName,
      state.outputSize,
      albumFormat,
      imageData,
      albumMasterData,
      referenceImageData
    );
  }

  return pptx;
}

async function captureClientUgcPreviewImages(
  items: readonly ClientSlideItem[]
): Promise<UgcPreviewImageMap> {
  return captureUgcTemplatePreviewImages(
    items
      .filter((item) => isUgcOutput(item.output))
      .map((item) => item.output.id)
  );
}

export async function downloadCreateStageSlides(
  state: ClientSlidesState
): Promise<void> {
  const ugcPreviewImages = await captureClientUgcPreviewImages(
    createStageClientSlideItems(state)
  );
  const pptx = await buildCreateStageSlidesPptx(
    state,
    fetchClientSlideImage,
    ugcPreviewImages
  );
  await pptx.writeFile({
    fileName: `${fileSlug(state.brand?.name ?? "creative")}-creative-slides.pptx`,
    compression: true
  });
}

export async function downloadPmApprovedClientSlides(
  state: ClientSlidesState
): Promise<void> {
  const ugcPreviewImages = await captureClientUgcPreviewImages(
    pmApprovedClientSlideItems(state)
  );
  const pptx = await buildPmApprovedClientSlidesPptx(
    state,
    fetchClientSlideImage,
    ugcPreviewImages
  );
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
  const pptx = await build();
  return uploadPptxToGoogleSlides({
    blob: await pptxBlob(pptx),
    name
  });
}

export async function openCreateStageSlidesInGoogleSlides(
  state: ClientSlidesState
): Promise<GoogleSlidesImportResult> {
  const ugcPreviewImages = await captureClientUgcPreviewImages(
    createStageClientSlideItems(state)
  );
  return openPptxInGoogleSlides(
    () =>
      buildCreateStageSlidesPptx(
        state,
        fetchClientSlideImage,
        ugcPreviewImages
      ),
    `${fileSlug(state.brand?.name ?? "creative")}-creative-slides`
  );
}

export async function openPmApprovedClientSlidesInGoogleSlides(
  state: ClientSlidesState
): Promise<GoogleSlidesImportResult> {
  const ugcPreviewImages = await captureClientUgcPreviewImages(
    pmApprovedClientSlideItems(state)
  );
  return openPptxInGoogleSlides(
    () =>
      buildPmApprovedClientSlidesPptx(
        state,
        fetchClientSlideImage,
        ugcPreviewImages
      ),
    `${fileSlug(state.brand?.name ?? "client")}-client-slides`
  );
}
