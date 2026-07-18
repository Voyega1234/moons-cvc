export interface PresentedBrandMemoryText {
  text: string;
  citationLabel: string | null;
  citationTitle: string | null;
}

const SOURCE_JOB_PATTERN =
  /Source:\s*brand_analysis_jobs\/([a-z0-9-]+)(?:\s*·\s*(\d+)\s+images)?/i;
const SOURCE_JOB_VISIBLE_PATTERN =
  /\s*Source:\s*brand_analysis_jobs\/[^\n]*/gim;
const SOURCE_ASSETS_PATTERN = /^\s*Source assets:\s*([^\n]*)$/im;
const SOURCE_ASSETS_LINE_PATTERN = /^\s*Source assets:\s*[^\n]*$/gim;

export function presentBrandMemoryText(
  value: string
): PresentedBrandMemoryText {
  const sourceJob = value.match(SOURCE_JOB_PATTERN);
  const sourceAssets = value.match(SOURCE_ASSETS_PATTERN);
  const pathCount =
    sourceAssets?.[1]
      ?.split(",")
      .map((path) => path.trim())
      .filter(Boolean).length ?? 0;
  const declaredImageCount = Number(sourceJob?.[2] ?? 0);
  const imageCount = Math.max(pathCount, declaredImageCount);
  const jobId = sourceJob?.[1] ?? null;
  const text = value
    .replace(SOURCE_ASSETS_LINE_PATTERN, "")
    .replace(SOURCE_JOB_VISIBLE_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    text,
    citationLabel:
      jobId || imageCount
        ? `AI analysis${imageCount ? ` · ${imageCount} images` : ""}`
        : null,
    citationTitle: jobId ? `Source job ${jobId}` : null
  };
}
