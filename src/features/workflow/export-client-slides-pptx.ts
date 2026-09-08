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
  uploadPptxToGoogleSlides,
  type GoogleSlidesImportResult
} from "../../services/google-slides/google-slides-import";
import {
  extractArtworkCopy,
  type ExtractedArtworkCopy
} from "../../services/artwork-copy-extraction/extract-artwork-copy";

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

function addKeyMessageBlock(
  slide: PptxGenJS.Slide,
  points: readonly string[],
  options: { x: number; y: number; w: number; h: number; fontSize: number }
) {
  const lines = points.map((point) => clampText(point, 140)).filter(Boolean);
  if (lines.length === 0) return;
  const text = lines.join("\n");
  slide.addText("KEY MESSAGE", {
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
    y: options.y + 0.27,
    w: options.w,
    h: options.h - 0.27,
    margin: 0,
    ...localizedTextStyle(text),
    fontSize: options.fontSize,
    color: COLORS.ink,
    valign: "top",
    fit: "shrink",
    lineSpacing: options.fontSize * 1.35,
    paraSpaceAfter: 3,
    bullet: { code: "2022", indent: 12 }
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

export function resolvedUgcBrief(
  direction: CreativeDirection | undefined,
  brandName: string
): UgcVideoBrief {
  const beats = direction?.formatBeats ?? [];
  return (
    direction?.ugcBrief ?? {
      product: brandName,
      duration: "45–54 วินาที",
      objective: cleanText(direction?.why, "สื่อสารแนวคิดให้เข้าใจและจดจำได้เร็ว"),
      moodAndTone: cleanText(direction?.visual, "เป็นธรรมชาติ กระชับ และน่าเชื่อถือ"),
      dresscode: "ชุดลำลองทั่วไป เหมาะกับบริบทของ Direction",
      persona: cleanText(direction?.why, "กลุ่มเป้าหมายหลักของแบรนด์"),
      productionStyle: "Creator-led vertical video ถ่ายแบบเป็นธรรมชาติและตัดต่อกระชับ",
      referenceDirection: cleanText(
        direction?.visual,
        "ภาพแนวตั้งแบบ native social ที่ดูจริงและไม่จัดฉากเกินไป"
      ),
      topic: cleanText(direction?.concept, "แนวคิดหลักของ Direction นี้"),
      doGuidelines: [
        "เปิดด้วย Hook ที่ตรงประเด็นภายใน 6 วินาทีแรก",
        "ใช้น้ำเสียงเป็นธรรมชาติเหมือนเล่าสู่กันฟัง",
        "ปิดท้ายด้วย CTA ที่ชัดเจน"
      ],
      dontGuidelines: [
        "หลีกเลี่ยงคำพูดที่ฟังดูเกินจริงหรือรับประกันผลลัพธ์",
        "ห้ามเปิดคลิปด้วยภาพลักษณ์ที่ดูเป็นทางการเกินไป"
      ],
      scenes: [
        {
          title: "Hook",
          duration: "00:00-00:06",
          scriptLines: [cleanText(direction?.hook)],
          visual: cleanText(direction?.visual),
          textOverlay: cleanText(direction?.hook)
        },
        {
          title: "Relatable Problem",
          duration: "00:06-00:14",
          scriptLines: [cleanText(beats[0], direction?.concept)],
          visual: cleanText(direction?.visual),
          textOverlay: cleanText(beats[0], direction?.concept)
        },
        {
          title: "Product Discovery",
          duration: "00:14-00:24",
          scriptLines: [cleanText(direction?.concept)],
          visual: cleanText(direction?.visual),
          textOverlay: cleanText(beats[1], direction?.concept)
        },
        {
          title: "Offer & Proof",
          duration: "00:24-00:36",
          scriptLines: [cleanText(direction?.why)],
          visual: cleanText(direction?.visual),
          textOverlay: cleanText(direction?.why)
        },
        {
          title: "Conversion CTA",
          duration: "00:36-00:46",
          scriptLines: [cleanText(direction?.cta)],
          visual: cleanText(direction?.visual),
          textOverlay: cleanText(direction?.cta)
        },
        {
          title: "End Card & Disclaimer",
          duration: "00:46-00:54",
          scriptLines: [cleanText(direction?.contactLine, direction?.cta)],
          visual: cleanText(direction?.visual),
          textOverlay: cleanText(direction?.contactLine, direction?.cta)
        }
      ]
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

const UGC_BRIEF_MARGIN_X = 0.4;
const UGC_BRIEF_COLUMN_GAP = 0.28;
const UGC_BRIEF_COLUMN_WIDTH =
  (13.33 - UGC_BRIEF_MARGIN_X * 2 - UGC_BRIEF_COLUMN_GAP * 2) / 3;
const UGC_BRIEF_COLUMN_TOP = 1.12;
const UGC_BRIEF_COLUMN_BOTTOM = 7.05;

function addUgcSlideHeader(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  title: string
) {
  slide.background = { color: COLORS.paper };
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.36,
    y: 0.3,
    w: 0.08,
    h: 0.3,
    fill: { color: COLORS.violet },
    line: { color: COLORS.violet }
  });
  slide.addText(title, {
    x: 0.54,
    y: 0.27,
    w: 8.4,
    h: 0.36,
    margin: 0,
    ...localizedTextStyle(title),
    fontSize: 18,
    bold: true,
    color: COLORS.ink,
    breakLine: false,
    fit: "shrink"
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 0.35,
    y: 0.75,
    w: 12.63,
    h: 0,
    line: { color: COLORS.line, width: 1 }
  });
}

function addUgcBriefColumn(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  x: number,
  heading: string
): number {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y: UGC_BRIEF_COLUMN_TOP,
    w: UGC_BRIEF_COLUMN_WIDTH,
    h: UGC_BRIEF_COLUMN_BOTTOM - UGC_BRIEF_COLUMN_TOP,
    rectRadius: 0.1,
    fill: { color: COLORS.paper },
    line: { color: COLORS.line, width: 1 }
  });
  slide.addText(heading, {
    x: x + 0.22,
    y: UGC_BRIEF_COLUMN_TOP + 0.18,
    w: UGC_BRIEF_COLUMN_WIDTH - 0.44,
    h: 0.24,
    margin: 0,
    ...localizedTextStyle(heading),
    fontSize: 11.5,
    bold: true,
    color: COLORS.violet,
    breakLine: false
  });
  return UGC_BRIEF_COLUMN_TOP + 0.56;
}

function addUgcBriefField(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  w: number,
  label: string,
  value: string
): number {
  slide.addText(label, {
    x,
    y,
    w,
    h: 0.2,
    margin: 0,
    ...localizedTextStyle(label),
    fontSize: 9,
    bold: true,
    color: COLORS.ink,
    breakLine: false
  });
  const text = clampText(value, 220);
  const lineCount = estimatedWrappedLines(text, w, 9.5);
  const textHeight = Math.max(0.22, (lineCount * 9.5 * 1.3) / 72);
  slide.addText(text, {
    x,
    y: y + 0.22,
    w,
    h: textHeight,
    margin: 0,
    ...localizedTextStyle(text),
    fontSize: 9.5,
    color: COLORS.muted,
    valign: "top",
    breakLine: false
  });
  return y + 0.22 + textHeight + 0.14;
}

function addUgcGuidelineList(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  w: number,
  heading: string,
  headingColor: string,
  items: readonly string[]
): number {
  slide.addText(heading, {
    x,
    y,
    w,
    h: 0.2,
    margin: 0,
    ...localizedTextStyle(heading),
    fontSize: 10,
    bold: true,
    color: headingColor,
    breakLine: false
  });
  let cursorY = y + 0.26;
  items.forEach((item) => {
    const text = clampText(item, 160);
    const lineCount = estimatedWrappedLines(text, w - 0.16, 9);
    const itemHeight = Math.max(0.2, (lineCount * 9 * 1.3) / 72);
    slide.addText(`•  ${text}`, {
      x,
      y: cursorY,
      w,
      h: itemHeight,
      margin: 0,
      ...localizedTextStyle(text),
      fontSize: 9,
      color: COLORS.ink,
      valign: "top",
      breakLine: false
    });
    cursorY += itemHeight + 0.08;
  });
  return cursorY + 0.16;
}

function addUgcReferenceVideoPanel(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  w: number,
  brief: UgcVideoBrief
) {
  const boxHeight = w * 1.72;
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h: boxHeight,
    rectRadius: 0.1,
    fill: { color: COLORS.ink },
    line: { color: COLORS.ink }
  });
  slide.addText("▶", {
    x,
    y: y + boxHeight / 2 - 0.4,
    w,
    h: 0.8,
    margin: 0,
    fontSize: 30,
    color: COLORS.paper,
    align: "center",
    valign: "middle"
  });
  const url = brief.referenceVideoUrl;
  const linkText = url
    ? clampText(brief.referenceVideoLabel || url, 60)
    : "ยังไม่มีวิดีโออ้างอิง";
  slide.addText(linkText, {
    x,
    y: y + boxHeight + 0.14,
    w,
    h: 0.4,
    margin: 0,
    ...localizedTextStyle(linkText),
    fontSize: 9.5,
    color: url ? COLORS.violet : COLORS.muted,
    align: "center",
    valign: "top",
    breakLine: false,
    ...(url ? { hyperlink: { url } } : {})
  });
}

function addUgcClientSlide(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  direction: CreativeDirection | undefined,
  brandName: string
) {
  const brief = resolvedUgcBrief(direction, brandName);
  const personaLabel = clampText(brief.persona, 40) || "Persona";

  addUgcSlideHeader(pptx, slide, `UGC AD VIDEO | PERSONA: ${personaLabel}`);
  if (brief.referenceVideoUrl) {
    const label = `UGC: ${clampText(brief.referenceVideoUrl, 55)}`;
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 9.6,
      y: 0.24,
      w: 3.33,
      h: 0.42,
      rectRadius: 0.08,
      fill: { color: COLORS.lime },
      line: { color: COLORS.lime }
    });
    slide.addText(label, {
      x: 9.72,
      y: 0.24,
      w: 3.09,
      h: 0.42,
      margin: 0,
      ...localizedTextStyle(label),
      fontSize: 9,
      bold: true,
      color: COLORS.limeInk,
      align: "center",
      valign: "middle",
      fit: "shrink",
      hyperlink: { url: brief.referenceVideoUrl }
    });
  }

  const col1X = UGC_BRIEF_MARGIN_X;
  const col2X = col1X + UGC_BRIEF_COLUMN_WIDTH + UGC_BRIEF_COLUMN_GAP;
  const col3X = col2X + UGC_BRIEF_COLUMN_WIDTH + UGC_BRIEF_COLUMN_GAP;

  // Column 1 — Brief Overview
  let y = addUgcBriefColumn(pptx, slide, col1X, "BRIEF OVERVIEW");
  const fieldX = col1X + 0.22;
  const fieldW = UGC_BRIEF_COLUMN_WIDTH - 0.44;
  y = addUgcBriefField(slide, fieldX, y, fieldW, "Brand", brief.product);
  y = addUgcBriefField(
    slide,
    fieldX,
    y,
    fieldW,
    "Topic",
    clampText(brief.topic, 220)
  );
  y = addUgcBriefField(slide, fieldX, y, fieldW, "Objective", brief.objective);
  y = addUgcBriefField(
    slide,
    fieldX,
    y,
    fieldW,
    "Mood & Tone",
    brief.moodAndTone
  );
  y = addUgcBriefField(
    slide,
    fieldX,
    y,
    fieldW,
    "Dresscode",
    clampText(brief.dresscode, 220)
  );
  addUgcBriefField(slide, fieldX, y, fieldW, "Persona", clampText(brief.persona, 220));

  // Column 2 — DO & DON'T Guidelines
  const col2HeadingY = addUgcBriefColumn(pptx, slide, col2X, "DO & DON'T GUIDELINES");
  const listX = col2X + 0.22;
  const listW = UGC_BRIEF_COLUMN_WIDTH - 0.44;
  const dontY = addUgcGuidelineList(
    slide,
    listX,
    col2HeadingY,
    listW,
    "DO",
    "1F8A4C",
    brief.doGuidelines?.length ? brief.doGuidelines : ["ไม่มีข้อมูล"]
  );
  addUgcGuidelineList(
    slide,
    listX,
    dontY,
    listW,
    "DON'T",
    "C0392B",
    brief.dontGuidelines?.length ? brief.dontGuidelines : ["ไม่มีข้อมูล"]
  );

  // Column 3 — Reference Video
  const col3HeadingY = addUgcBriefColumn(pptx, slide, col3X, "Reference Video");
  addUgcReferenceVideoPanel(
    pptx,
    slide,
    col3X + 0.22,
    col3HeadingY,
    UGC_BRIEF_COLUMN_WIDTH - 0.44,
    brief
  );

  slide.addText("Prepared by Convert Cake", {
    x: UGC_BRIEF_MARGIN_X,
    y: 7.2,
    w: 3,
    h: 0.16,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 7,
    bold: true,
    color: COLORS.muted
  });
  slide.addNotes(
    `[Sources]\n- Brief overview, DO/DON'T guidelines: generated from confirmed workflow data for ${brandName}.\n- Reference video: attach the creator's actual reference clip when available.`
  );

  const scriptSlide = pptx.addSlide();
  addUgcScriptGridSlide(pptx, scriptSlide, brief, personaLabel, brandName);
}

const UGC_SCRIPT_GRID_MARGIN_X = 0.4;
const UGC_SCRIPT_GRID_COLUMNS = 3;
const UGC_SCRIPT_GRID_GAP_X = 0.24;
const UGC_SCRIPT_GRID_GAP_Y = 0.22;
const UGC_SCRIPT_GRID_TOP = 0.95;
const UGC_SCRIPT_GRID_BOTTOM = 7.25;
const UGC_SCRIPT_CARD_WIDTH =
  (13.33 -
    UGC_SCRIPT_GRID_MARGIN_X * 2 -
    UGC_SCRIPT_GRID_GAP_X * (UGC_SCRIPT_GRID_COLUMNS - 1)) /
  UGC_SCRIPT_GRID_COLUMNS;
const UGC_SCRIPT_CARD_HEIGHT =
  (UGC_SCRIPT_GRID_BOTTOM - UGC_SCRIPT_GRID_TOP - UGC_SCRIPT_GRID_GAP_Y) / 2;

function addUgcScriptGridSlide(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  brief: UgcVideoBrief,
  personaLabel: string,
  brandName: string
) {
  addUgcSlideHeader(pptx, slide, `SHORT VIDEO SCRIPT — ${personaLabel}`);

  brief.scenes.forEach((scene, index) => {
    const column = index % UGC_SCRIPT_GRID_COLUMNS;
    const row = Math.floor(index / UGC_SCRIPT_GRID_COLUMNS);
    const x =
      UGC_SCRIPT_GRID_MARGIN_X +
      column * (UGC_SCRIPT_CARD_WIDTH + UGC_SCRIPT_GRID_GAP_X);
    const y =
      UGC_SCRIPT_GRID_TOP + row * (UGC_SCRIPT_CARD_HEIGHT + UGC_SCRIPT_GRID_GAP_Y);
    addUgcScriptCard(pptx, slide, index + 1, scene, x, y);
  });

  slide.addText("Prepared by Convert Cake", {
    x: UGC_SCRIPT_GRID_MARGIN_X,
    y: 7.32,
    w: 3,
    h: 0.16,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 7,
    bold: true,
    color: COLORS.muted
  });
  slide.addNotes(
    `[Sources]\n- Script beats, visuals, and on-screen text: generated from confirmed workflow data for ${brandName}.`
  );
}

function addUgcScriptCard(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  index: number,
  scene: UgcVideoScene,
  x: number,
  y: number
) {
  const padX = 0.2;
  const contentX = x + padX;
  const contentW = UGC_SCRIPT_CARD_WIDTH - padX * 2;

  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w: UGC_SCRIPT_CARD_WIDTH,
    h: UGC_SCRIPT_CARD_HEIGHT,
    rectRadius: 0.08,
    fill: { color: COLORS.paper },
    line: { color: COLORS.line, width: 1 }
  });

  const title = `${String(index).padStart(2, "0")} | ${scene.title.toUpperCase()}`;
  slide.addText(
    [
      { text: title, options: { bold: true, color: COLORS.violet } },
      { text: `  ${scene.duration}`, options: { color: COLORS.muted } }
    ],
    {
      x: contentX,
      y: y + 0.16,
      w: contentW,
      h: 0.24,
      margin: 0,
      ...localizedTextStyle(title),
      fontSize: 10.5,
      breakLine: false,
      fit: "shrink"
    }
  );

  let cursorY = y + 0.5;
  const visual = clampText(scene.visual, 140);
  const visualLines = estimatedWrappedLines(visual, contentW, 8.6);
  const visualHeight = Math.max(0.2, (visualLines * 8.6 * 1.3) / 72);
  slide.addText(
    [
      { text: "Visual: ", options: { bold: true, italic: true, color: COLORS.muted } },
      { text: visual, options: { italic: true, color: COLORS.ink } }
    ],
    {
      x: contentX,
      y: cursorY,
      w: contentW,
      h: visualHeight,
      margin: 0,
      ...localizedTextStyle(visual),
      fontSize: 8.6,
      valign: "top",
      breakLine: false
    }
  );
  cursorY += visualHeight + 0.1;

  slide.addText("Script:", {
    x: contentX,
    y: cursorY,
    w: contentW,
    h: 0.18,
    margin: 0,
    fontFace: SLIDE_FONT_FACE,
    fontSize: 9,
    bold: true,
    color: COLORS.violet,
    breakLine: false
  });
  cursorY += 0.22;
  const scriptLine = clampText(scene.scriptLines[0], 220);
  const scriptRuns = buildHighlightedTextRuns(scriptLine, scene.highlightedPhrase);
  const scriptLines = estimatedWrappedLines(scriptLine, contentW, 10);
  const scriptHeight = Math.max(0.3, (scriptLines * 10 * 1.35) / 72);
  slide.addText(scriptRuns, {
    x: contentX,
    y: cursorY,
    w: contentW,
    h: Math.min(scriptHeight, y + UGC_SCRIPT_CARD_HEIGHT - cursorY - 0.5),
    margin: 0,
    ...localizedTextStyle(scriptLine),
    fontSize: 10,
    color: COLORS.ink,
    valign: "top",
    breakLine: false,
    fit: "shrink"
  });

  const overlayY = y + UGC_SCRIPT_CARD_HEIGHT - 0.42;
  slide.addText(
    [
      {
        text: "On-Screen Text: ",
        options: { bold: true, color: COLORS.muted }
      },
      { text: clampText(scene.textOverlay, 110), options: { color: COLORS.ink } }
    ],
    {
      x: contentX,
      y: overlayY,
      w: contentW,
      h: 0.34,
      margin: 0,
      ...localizedTextStyle(scene.textOverlay),
      fontSize: 8,
      valign: "top",
      breakLine: false,
      fit: "shrink"
    }
  );
}

function buildHighlightedTextRuns(
  text: string,
  highlightedPhrase: string | undefined
): { text: string; options?: { highlight?: string; bold?: boolean } }[] {
  const phrase = highlightedPhrase?.trim();
  if (!phrase) return [{ text }];
  const start = text.indexOf(phrase);
  if (start < 0) return [{ text }];

  const before = text.slice(0, start);
  const after = text.slice(start + phrase.length);
  return [
    ...(before ? [{ text: before }] : []),
    { text: phrase, options: { highlight: COLORS.lime, bold: true } },
    ...(after ? [{ text: after }] : [])
  ];
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
  referenceImageData: readonly string[] = [],
  extractedCopy?: ExtractedArtworkCopy
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
      ? { x: 4.04, y: 0.85, w: 5.62, h: 5.97 }
      : { x: 4.04, y: 0.85, w: 4.34, h: 5.97 };
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
  slide.addText("CREATIVE REFERENCE (MOCKUP)", {
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
  const hook = clampText(extractedCopy?.headline?.trim() || direction?.hook, 170);
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
  const keyMessagePoints = extractedCopy?.keyMessage.length
    ? extractedCopy.keyMessage
    : direction?.supportingPoints?.length
      ? direction.supportingPoints
      : subheadline
        ? [subheadline]
        : [];
  addKeyMessageBlock(slide, keyMessagePoints, {
    x: 0.55,
    y: 2.93,
    w: 2.84,
    h: 2.32,
    fontSize: 11
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
  const callToAction = clampText(
    extractedCopy?.cta?.trim() || direction?.cta,
    120
  );
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

  if (extractedCopy?.footer?.trim()) {
    addTextBlock(slide, "Footer", extractedCopy.footer, {
      x: 0.55,
      y: 6.53,
      w: 2.84,
      h: 0.9,
      maxLength: 500,
      fontSize: 8.5
    });
  }

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
  referenceImageData: readonly string[] = [],
  extractedCopy?: ExtractedArtworkCopy
) {
  const { output, direction } = item;
  const slide = pptx.addSlide();
  if (isUgcOutput(output)) {
    addUgcClientSlide(pptx, slide, direction, brandName);
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
    referenceImageData,
    extractedCopy
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
  const extractedCopyByOutputId = await resolveExtractedArtworkCopy(items);
  for (const [index, item] of items.entries()) {
    let imageData: readonly string[] = [];
    let albumMasterData: string | undefined;
    const referenceImageData = await Promise.all(
      (item.direction?.referenceImages ?? []).map((reference) =>
        resolveImage(reference.url)
      )
    );
    if (!isUgcOutput(item.output)) {
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
      referenceImageData,
      extractedCopyByOutputId.get(item.output.id)
    );
  }

  return pptx;
}

/**
 * Reads the exact copy actually rendered on each generated artwork (vision
 * transcription), so the slide's copy column reflects the real pixels rather
 * than the direction fields, which can drift after a free-text "Regenerate"
 * edit. Never blocks the export: any failure just means slides fall back to
 * direction fields, same as before this existed.
 */
async function resolveExtractedArtworkCopy(
  items: readonly ClientSlideItem[]
): Promise<Map<string, ExtractedArtworkCopy>> {
  const outputs = items
    .filter((item) => !isUgcOutput(item.output) && item.output.assetUrl)
    .map((item) => ({
      id: item.output.id,
      assetUrl: item.output.assetUrl as string
    }));

  if (!outputs.length) {
    console.warn(
      "Artwork copy extraction skipped: no eligible outputs (non-UGC with an assetUrl)."
    );
    return new Map();
  }

  try {
    const results = await extractArtworkCopy(outputs);
    return new Map(results.map((result) => [result.outputId, result]));
  } catch (error) {
    console.error(
      "Artwork copy extraction failed; slide copy falls back to direction fields.",
      error
    );
    return new Map();
  }
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
  const pptx = await build();
  return uploadPptxToGoogleSlides({
    blob: await pptxBlob(pptx),
    name
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
