function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function directionSubheadline(direction: {
  subheadline?: string;
  concept: string;
}): string {
  return normalizeText(direction.subheadline || direction.concept);
}

export function isExactSubheadlineHighlight(
  subheadline: string,
  highlight: string
): boolean {
  const cleanSubheadline = normalizeText(subheadline);
  const cleanHighlight = normalizeText(highlight);
  return Boolean(cleanHighlight) && cleanSubheadline.includes(cleanHighlight);
}

export function suggestSubheadlineHighlight(subheadline: string): string {
  const cleanSubheadline = normalizeText(subheadline);
  if (!cleanSubheadline) return "";

  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("th", { granularity: "word" });
    const words = Array.from(segmenter.segment(cleanSubheadline)).filter(
      (segment) => segment.isWordLike
    );
    if (words.length > 0) {
      const wordCount = Math.max(
        2,
        Math.min(6, Math.ceil(words.length * 0.35))
      );
      const first = words[0];
      const last = words[Math.min(wordCount, words.length) - 1];
      if (first && last) {
        return cleanSubheadline
          .slice(first.index, last.index + last.segment.length)
          .trim();
      }
    }
  }

  const words = cleanSubheadline.split(/\s+/);
  const wordCount = Math.max(2, Math.min(6, Math.ceil(words.length * 0.35)));
  return words.slice(0, wordCount).join(" ");
}

export function resolveSubheadlineHighlight(
  subheadline: string,
  candidate?: string
): string {
  if (candidate === undefined) return suggestSubheadlineHighlight(subheadline);

  const cleanCandidate = normalizeText(candidate);
  return isExactSubheadlineHighlight(subheadline, cleanCandidate)
    ? cleanCandidate
    : "";
}
