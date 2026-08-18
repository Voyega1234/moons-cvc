const STANDALONE_DOT_SEPARATOR = /[ \t]+\.[ \t]+/g;
const INLINE_CHECKMARK = /[ \t]+(?=✅)/g;
const INLINE_CONTACT_LABEL = /[ \t]+(?=(?:Email|Inbox|Phone)\s*:)/gi;
const TRAILING_HASHTAG_BLOCK =
  /^([^#\n].*?)[ \t]+(#\S+(?:[ \t]+#\S+)*)[ \t]*$/gm;

/**
 * Repairs common model formatting artifacts without rewriting caption copy.
 * Existing line breaks and ordinary sentence punctuation remain untouched.
 */
export function normalizeGeneratedCaptionFormatting(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(STANDALONE_DOT_SEPARATOR, "\n\n")
    .replace(INLINE_CHECKMARK, "\n")
    .replace(INLINE_CONTACT_LABEL, "\n")
    .replace(TRAILING_HASHTAG_BLOCK, "$1\n\n$2")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
