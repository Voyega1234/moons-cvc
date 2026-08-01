import sharp from "sharp";
import type { AlbumFormat } from "../../domain/creative-run.js";
import type { ArtworkGenerationRequest } from "../../services/artwork-generation/openai-image-generation.js";

type SelectedHook = ArtworkGenerationRequest["selectedHooks"][number];

export function buildAlbumMasterInstruction(
  hook: SelectedHook,
  format: AlbumFormat
): string {
  const beats = hook.formatBeats ?? [];
  const panelInstructions =
    format === "three-horizontal" || format === "three-vertical"
      ? [
          `The dominant cover area uses the exact headline “${hook.hook}”, the main visual, and immediate brand recognition.`,
          `The first supporting area develops the story using ${beats[0] ?? "the opening supporting point"} and ${beats[1] ?? "the mechanism or proof"}.`,
          `The closing supporting area uses ${beats[2] ?? "the offer or decision moment"} and contains the album's only CTA: the exact text “${hook.cta}”.`
        ]
      : [
          `The dominant cover area uses the exact headline “${hook.hook}”, the main visual, and immediate brand recognition.`,
          `The opening supporting area develops ${beats[0] ?? "the opening supporting point"}.`,
          `The evidence supporting area develops ${beats[1] ?? "the mechanism or proof"}.`,
          `The closing supporting area uses ${beats[2] ?? "the offer or decision moment"} and contains the album's only CTA: the exact text “${hook.cta}”.`
        ];
  return [
    "ALBUM MASTER GRID - highest-priority layout instruction:",
    albumLayoutPrompt(format),
    "The prescribed layout is non-negotiable. Do not rotate it, mirror it, replace it with a top-and-bottom mosaic, or invent another grid.",
    "Render one square master artwork containing the complete album. Keep every panel inside its own rectangular area.",
    "Use subtle, straight, continuous separators so the panel boundaries remain machine-detectable. Never bend, stagger, overlap, or interrupt a separator.",
    ...panelInstructions,
    `CTA UNIQUENESS IS MANDATORY: render exactly one CTA across the entire master, located only in the closing supporting area. Do not place a CTA, button, signup banner, action strip, or duplicate of “${hook.cta}” in the cover, opening support, evidence support, header, footer, or any other area. Perform a final count before rendering: the CTA text must appear once, not twice.`,
    "Do not render sequence labels, page numbers, step numbers, or decorative numerals such as 01, 02, 03, or 04. Positional words in this instruction are structural notes only and must never become visible copy. Keep only verified dates, prices, metrics, or quantities required by the approved campaign content.",
    "Keep text, logo, CTA, faces, products, and essential proof at least 8% inside each panel boundary. Never place essential content across a separator.",
    "ONE CAMPAIGN WORLD IS MANDATORY: art-direct the complete master as one composition, not a collage of separate mini-posters. Every area must share the same brand palette, typography family, lighting logic, camera or illustration language, depth, material treatment, icon style, and production finish.",
    "Build the supporting areas as continuations or close crops of the cover's visual world. Reuse its environment, texture, motifs, shapes, and image-making technique. Controlled tonal variation is allowed within the same palette, but never switch to an unrelated background, photographic genre, illustration style, 3D material, or lighting setup.",
    "Create hierarchy through scale, crop, whitespace, and information density rather than making each area look like a different campaign."
  ].join("\n");
}

function albumLayoutPrompt(format: AlbumFormat): string {
  switch (format) {
    case "three-vertical":
      return "Use a vertical cover occupying the full left half and two equal supporting panels stacked on the right half.";
    case "three-horizontal":
      return "Use a horizontal cover occupying the full top half and two equal supporting panels side by side across the bottom half.";
    case "four-vertical":
      return "Use a large vertical cover occupying the full left two-thirds and three equal supporting panels stacked on the right one-third.";
    case "four-grid":
      return "Use exactly four equal panels in a strict two-by-two grid.";
  }
}

interface AlbumBoundaryDetection {
  vertical?: number;
  horizontal?: number;
  secondaryVertical?: number;
  secondaryHorizontal?: number;
}

interface AlbumCropRegion {
  index: 1 | 2 | 3 | 4;
  left: number;
  top: number;
  width: number;
  height: number;
  maxWidth: number;
  maxHeight: number;
}

export async function splitAlbumMaster(
  imageBytes: Buffer,
  format: AlbumFormat
): Promise<readonly { index: 1 | 2 | 3 | 4; bytes: Buffer }[]> {
  const metadata = await sharp(imageBytes).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Could not read the generated album master dimensions.");
  }

  const side = Math.min(metadata.width, metadata.height);
  const left = Math.floor((metadata.width - side) / 2);
  const top = Math.floor((metadata.height - side) / 2);
  const analysisSize = 512;
  const analysis = await sharp(imageBytes)
    .extract({ left, top, width: side, height: side })
    .resize(analysisSize, analysisSize, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
  const detected = detectAlbumBoundaries({
    pixels: analysis,
    width: analysisSize,
    height: analysisSize,
    format
  });
  const scale = side / analysisSize;
  const boundaries: AlbumBoundaryDetection = {
    ...(detected.vertical !== undefined
      ? { vertical: Math.round(detected.vertical * scale) }
      : {}),
    ...(detected.horizontal !== undefined
      ? { horizontal: Math.round(detected.horizontal * scale) }
      : {}),
    ...(detected.secondaryVertical !== undefined
      ? { secondaryVertical: Math.round(detected.secondaryVertical * scale) }
      : {}),
    ...(detected.secondaryHorizontal !== undefined
      ? { secondaryHorizontal: Math.round(detected.secondaryHorizontal * scale) }
      : {})
  };
  const regions = albumCropRegions({
    left,
    top,
    side,
    format,
    boundaries
  });

  return Promise.all(
    regions.map(async (region) => ({
      index: region.index,
      bytes: await sharp(imageBytes)
        .extract({
          left: region.left,
          top: region.top,
          width: region.width,
          height: region.height
        })
        .resize({
          width: region.maxWidth,
          height: region.maxHeight,
          fit: "inside"
        })
        .png()
        .toBuffer()
    }))
  );
}

export function detectAlbumBoundaries({
  pixels,
  width,
  height,
  format
}: {
  pixels: Uint8Array;
  width: number;
  height: number;
  format: AlbumFormat;
}): AlbumBoundaryDetection {
  const vertical = (
    expected: number,
    radius: number,
    yStart = 0,
    yEnd = height
  ) =>
    findContinuousBoundary({
      pixels,
      width,
      height,
      axis: "vertical",
      expected,
      radius,
      crossStart: yStart,
      crossEnd: yEnd
    });
  const horizontal = (
    expected: number,
    radius: number,
    xStart = 0,
    xEnd = width
  ) =>
    findContinuousBoundary({
      pixels,
      width,
      height,
      axis: "horizontal",
      expected,
      radius,
      crossStart: xStart,
      crossEnd: xEnd
    });

  if (format === "three-vertical") {
    const seam = vertical(width * 0.5, width * 0.26);
    return {
      vertical: seam,
      secondaryHorizontal: horizontal(
        height * 0.5,
        height * 0.24,
        seam + 3,
        width
      )
    };
  }
  if (format === "three-horizontal") {
    const seam = horizontal(height * 0.5, height * 0.26);
    return {
      horizontal: seam,
      secondaryVertical: vertical(
        width * 0.5,
        width * 0.24,
        seam + 3,
        height
      )
    };
  }
  if (format === "four-grid") {
    return {
      vertical: vertical(width * 0.5, width * 0.24),
      horizontal: horizontal(height * 0.5, height * 0.24)
    };
  }

  const seam = vertical(width * (2 / 3), width * 0.34);
  const first = horizontal(
    height / 3,
    height * 0.17,
    seam + 3,
    width
  );
  const second = horizontal(
    height * (2 / 3),
    height * 0.17,
    seam + 3,
    width
  );
  return {
    vertical: seam,
    secondaryHorizontal:
      first < second - height * 0.12 ? first : Math.round(height / 3),
    horizontal:
      first < second - height * 0.12
        ? second
        : Math.round(height * (2 / 3))
  };
}

function findContinuousBoundary({
  pixels,
  width,
  height,
  axis,
  expected,
  radius,
  crossStart,
  crossEnd
}: {
  pixels: Uint8Array;
  width: number;
  height: number;
  axis: "vertical" | "horizontal";
  expected: number;
  radius: number;
  crossStart: number;
  crossEnd: number;
}): number {
  const axisLength = axis === "vertical" ? width : height;
  const start = Math.max(6, Math.floor(expected - radius));
  const end = Math.min(axisLength - 7, Math.ceil(expected + radius));
  const scores: { position: number; raw: number; weighted: number }[] = [];

  for (let position = start; position <= end; position += 1) {
    const gradients: number[] = [];
    const from = Math.max(2, Math.floor(crossStart));
    const to = Math.min(
      axis === "vertical" ? height - 2 : width - 2,
      Math.ceil(crossEnd)
    );
    for (let cross = from; cross < to; cross += 2) {
      let strongest = 0;
      for (let offset = -4; offset <= 3; offset += 1) {
        const first =
          axis === "vertical"
            ? pixels[cross * width + position + offset]
            : pixels[(position + offset) * width + cross];
        const second =
          axis === "vertical"
            ? pixels[cross * width + position + offset + 1]
            : pixels[(position + offset + 1) * width + cross];
        strongest = Math.max(
          strongest,
          Math.abs((first ?? 0) - (second ?? 0))
        );
      }
      gradients.push(strongest);
    }
    gradients.sort((a, b) => a - b);
    const raw = gradients[Math.floor(gradients.length * 0.4)] ?? 0;
    const proximity = 1 - 0.28 * (Math.abs(position - expected) / radius);
    scores.push({ position, raw, weighted: raw * proximity });
  }

  const best = scores.reduce(
    (current, candidate) =>
      candidate.weighted > current.weighted ? candidate : current,
    scores[0] ?? {
      position: Math.round(expected),
      raw: 0,
      weighted: 0
    }
  );
  const rawScores = scores.map((score) => score.raw).sort((a, b) => a - b);
  const median = rawScores[Math.floor(rawScores.length / 2)] ?? 0;
  if (best.raw < Math.max(4, median * 1.2)) return Math.round(expected);

  const boundaryCluster = scores.filter(
    (score) =>
      Math.abs(score.position - best.position) <= 12 &&
      score.raw >= best.raw * 0.85
  );
  return Math.round(
    boundaryCluster.reduce((sum, score) => sum + score.position, 0) /
      Math.max(1, boundaryCluster.length)
  );
}

export function albumCropRegions({
  left,
  top,
  side,
  format,
  boundaries
}: {
  left: number;
  top: number;
  side: number;
  format: AlbumFormat;
  boundaries: AlbumBoundaryDetection;
}): readonly AlbumCropRegion[] {
  const vertical = clampBoundary(boundaries.vertical, side / 2, side);
  const horizontal = clampBoundary(boundaries.horizontal, side / 2, side);

  if (format === "three-vertical") {
    const rightHorizontal = clampBoundary(
      boundaries.secondaryHorizontal,
      side / 2,
      side
    );
    return [
      cropRegion(1, left, top, vertical, side, 1920),
      cropRegion(
        2,
        left + vertical,
        top,
        side - vertical,
        rightHorizontal,
        960
      ),
      cropRegion(
        3,
        left + vertical,
        top + rightHorizontal,
        side - vertical,
        side - rightHorizontal,
        960
      )
    ];
  }
  if (format === "three-horizontal") {
    const bottomVertical = clampBoundary(
      boundaries.secondaryVertical,
      side / 2,
      side
    );
    return [
      cropRegion(1, left, top, side, horizontal, 1920),
      cropRegion(
        2,
        left,
        top + horizontal,
        bottomVertical,
        side - horizontal,
        960
      ),
      cropRegion(
        3,
        left + bottomVertical,
        top + horizontal,
        side - bottomVertical,
        side - horizontal,
        960
      )
    ];
  }
  if (format === "four-grid") {
    return [
      cropRegion(1, left, top, vertical, horizontal, 960),
      cropRegion(2, left + vertical, top, side - vertical, horizontal, 960),
      cropRegion(3, left, top + horizontal, vertical, side - horizontal, 960),
      cropRegion(
        4,
        left + vertical,
        top + horizontal,
        side - vertical,
        side - horizontal,
        960
      )
    ];
  }

  const firstHorizontal = clampBoundary(
    boundaries.secondaryHorizontal,
    side / 3,
    side
  );
  const secondHorizontal = clampBoundary(
    boundaries.horizontal,
    side * (2 / 3),
    side
  );
  return [
    cropRegion(1, left, top, vertical, side, 1920),
    cropRegion(
      2,
      left + vertical,
      top,
      side - vertical,
      firstHorizontal,
      960
    ),
    cropRegion(
      3,
      left + vertical,
      top + firstHorizontal,
      side - vertical,
      secondHorizontal - firstHorizontal,
      960
    ),
    cropRegion(
      4,
      left + vertical,
      top + secondHorizontal,
      side - vertical,
      side - secondHorizontal,
      960
    )
  ];
}

function cropRegion(
  index: AlbumCropRegion["index"],
  left: number,
  top: number,
  width: number,
  height: number,
  maxEdge: number
): AlbumCropRegion {
  return {
    index,
    left: Math.round(left),
    top: Math.round(top),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    maxWidth: maxEdge,
    maxHeight: maxEdge
  };
}

function clampBoundary(
  value: number | undefined,
  fallback: number,
  side: number
): number {
  return Math.min(
    side - 1,
    Math.max(1, Math.round(value ?? fallback))
  );
}

