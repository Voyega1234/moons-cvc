import type PptxGenJS from "pptxgenjs";
import type {
  CreativeDirection,
  CreativeOutput
} from "../../domain/creative-run";
import type { WorkflowState } from "./model";
import { approvalRolesForOutput } from "./rules";

export interface ClientSlideItem {
  output: CreativeOutput;
  direction: CreativeDirection | undefined;
}

export type ClientSlideImageResolver = (url: string) => Promise<string>;

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

export function pmApprovedClientSlideItems(
  state: Pick<WorkflowState, "outputs" | "directions">
): readonly ClientSlideItem[] {
  return state.outputs
    .filter((output) =>
      approvalRolesForOutput(output).every(
        (role) => output.approval[role] === "approved"
      )
    )
    .map((output) => ({
      output,
      direction: state.directions.find(
        (direction) => direction.id === output.directionId
      )
    }));
}

function isUgcOutput(output: CreativeOutput): boolean {
  return output.format.toUpperCase().includes("UGC");
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
  slide.addText(label.toUpperCase(), {
    x: 7.35,
    y,
    w: 5.05,
    h: 0.2,
    margin: 0,
    fontFace: "Aptos",
    fontSize: 8,
    bold: true,
    color: COLORS.muted,
    charSpacing: 1.1
  });
  slide.addText(clampText(value, maxLength), {
    x: 7.35,
    y: y + 0.25,
    w: 5.05,
    h: height - 0.25,
    margin: 0,
    fontFace: "Aptos",
    fontSize: 12.5,
    color: COLORS.ink,
    breakLine: false,
    valign: "top",
    fit: "shrink",
    paraSpaceAfter: 0
  });
}

function addUgcPreview(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  direction: CreativeDirection | undefined
) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 1.58,
    y: 0.7,
    w: 3.15,
    h: 6.12,
    rectRadius: 0.16,
    fill: { color: COLORS.ink },
    line: { color: COLORS.ink }
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 1.7,
    y: 0.86,
    w: 2.91,
    h: 5.8,
    rectRadius: 0.12,
    fill: { color: COLORS.violetSoft },
    line: { color: COLORS.violetSoft }
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 2.59,
    y: 0.76,
    w: 1.14,
    h: 0.15,
    rectRadius: 0.06,
    fill: { color: "0F1018" },
    line: { color: "0F1018" }
  });
  slide.addText("CREATOR-LED UGC", {
    x: 1.95,
    y: 1.25,
    w: 2.4,
    h: 0.25,
    margin: 0,
    fontFace: "Aptos",
    fontSize: 8,
    bold: true,
    color: COLORS.violet,
    align: "center",
    charSpacing: 1.2
  });
  slide.addText(clampText(direction?.hook, 120), {
    x: 1.98,
    y: 1.8,
    w: 2.34,
    h: 1.55,
    margin: 0,
    fontFace: "Aptos Display",
    fontSize: 22,
    bold: true,
    color: COLORS.ink,
    align: "center",
    valign: "middle",
    fit: "shrink"
  });
  const beats = (direction?.formatBeats ?? []).slice(0, 3);
  const beatText = beats.length
    ? beats.map((beat, index) => `${index + 1}. ${cleanText(beat)}`).join("\n")
    : clampText(direction?.caption, 170);
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 1.98,
    y: 4.1,
    w: 2.34,
    h: 1.64,
    rectRadius: 0.1,
    fill: { color: COLORS.paper, transparency: 8 },
    line: { color: COLORS.paper, transparency: 100 }
  });
  slide.addText(beatText, {
    x: 2.14,
    y: 4.28,
    w: 2.02,
    h: 1.28,
    margin: 0,
    fontFace: "Aptos",
    fontSize: 10.5,
    color: COLORS.ink,
    breakLine: false,
    valign: "middle",
    fit: "shrink"
  });
  slide.addText("9:16 concept preview", {
    x: 1.96,
    y: 6.06,
    w: 2.38,
    h: 0.22,
    margin: 0,
    fontFace: "Aptos",
    fontSize: 8,
    color: COLORS.muted,
    align: "center"
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

function addClientSlide(
  pptx: PptxGenJS,
  item: ClientSlideItem,
  brandName: string,
  slideNumber: number,
  totalSlides: number,
  outputSize: WorkflowState["outputSize"],
  imageData?: string
) {
  const { output, direction } = item;
  const slide = pptx.addSlide();
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
  if (isUgcOutput(output)) {
    addUgcPreview(pptx, slide, direction);
  } else if (imageData) {
    addArtworkPreview(
      slide,
      imageData,
      outputSize,
      `${brandName} ${output.format} creative artwork`
    );
  }

  slide.addText(brandName.toUpperCase(), {
    x: 7.35,
    y: 0.64,
    w: 3.6,
    h: 0.22,
    margin: 0,
    fontFace: "Aptos",
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
    fontFace: "Aptos",
    fontSize: 7.5,
    bold: true,
    color: COLORS.limeInk,
    align: "center",
    fit: "shrink"
  });
  slide.addText(clampText(direction?.hook, 170), {
    x: 7.35,
    y: 1.18,
    w: 5.05,
    h: 1.42,
    margin: 0,
    fontFace: "Aptos Display",
    fontSize: 26,
    bold: true,
    color: COLORS.ink,
    valign: "top",
    fit: "shrink",
    breakLine: false
  });
  addTextBlock(
    slide,
    isUgcOutput(output) ? "Script direction" : "Caption",
    direction?.caption,
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
    fontFace: "Aptos",
    fontSize: 8,
    color: COLORS.muted,
    align: "right"
  });
}

export async function buildPmApprovedClientSlidesPptx(
  state: Pick<
    WorkflowState,
    "brand" | "outputs" | "directions" | "outputSize"
  >,
  resolveImage: ClientSlideImageResolver = fetchClientSlideImage
): Promise<PptxGenJS> {
  const items = pmApprovedClientSlideItems(state);
  if (!items.length) {
    throw new Error("No PM-approved assets are ready for client slides yet.");
  }

  const { default: PptxGenJSConstructor } = await import("pptxgenjs");
  const pptx = new PptxGenJSConstructor();
  const brandName = cleanText(state.brand?.name, "Client");
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Compass";
  pptx.company = "Neo Creative Compass";
  pptx.subject = `${brandName} approved creative concepts`;
  pptx.title = `${brandName} client slides`;
  pptx.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos"
  };

  for (const [index, item] of items.entries()) {
    let imageData: string | undefined;
    if (!isUgcOutput(item.output)) {
      if (!item.output.assetUrl) {
        throw new Error(
          `Approved asset ${index + 1} does not have an artwork file yet.`
        );
      }
      imageData = await resolveImage(item.output.assetUrl);
    }
    addClientSlide(
      pptx,
      item,
      brandName,
      index + 1,
      items.length,
      state.outputSize,
      imageData
    );
  }

  return pptx;
}

export async function downloadPmApprovedClientSlides(
  state: Pick<
    WorkflowState,
    "brand" | "outputs" | "directions" | "outputSize"
  >
): Promise<void> {
  const pptx = await buildPmApprovedClientSlidesPptx(state);
  await pptx.writeFile({
    fileName: `${fileSlug(state.brand?.name ?? "client")}-client-slides.pptx`,
    compression: true
  });
}
