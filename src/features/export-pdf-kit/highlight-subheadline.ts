import type { ReviewHighlightMap, ReviewIdeaSection } from "./export-ideas-review-pdf"
import type { IdeaRecommendation } from "./types"

export type HighlightRequestItem = {
  id: string
  hook?: string
  subheadline: string
  concept?: string
  cta?: string
  why?: string
  tags?: string[]
}

const MAX_HIGHLIGHTS_PER_ITEM = 1

export function getIdeaWhy(idea: IdeaRecommendation) {
  const description = idea.description
  if (!description) return ""
  if (typeof description === "string") return description
  if (Array.isArray(description)) {
    const priorityItem =
      description.find((item) => item.label === "Why this converts" || item.label === "Evidence/Counterpoint") ||
      description[0]
    return priorityItem?.text || ""
  }
  const prioritySection =
    description.sections?.find((section) => section.group === "why_evidence") || description.sections?.[0]
  return prioritySection?.bullets?.[0] || description.summary || ""
}

export function buildHighlightItems(sections: ReviewIdeaSection[]) {
  return sections
    .flatMap((section) =>
      section.ideas.map((idea, index) => ({
        id: `${section.group}:${index}`,
        hook: idea.copywriting?.headline || idea.title || idea.concept_idea || "",
        subheadline: idea.copywriting?.sub_headline_1 || idea.copywriting?.sub_headline_2 || "",
        concept: idea.concept_idea || "",
        cta: idea.copywriting?.cta || "",
        why: idea.competitiveGap || getIdeaWhy(idea),
        tags: idea.tags || [],
      })),
    )
    .filter((item) => item.subheadline)
}

export function buildHighlightPrompt(items: HighlightRequestItem[]) {
  return `
Bold the sentence of this text that you think it's a highlight of this sub-headline
Rules:
- Return JSON only.
- Use exact text spans from subheadline. Do not rewrite.
- Prefer only the strongest strategic noun, product/service term, audience pain, proof, or conversion angle.
- Avoid generic words, filler, conjunctions, and common Thai particles.
- If the subheadline has no clearly important term, return an empty array.

Return this exact shape:
{
  "items": [
    { "id": "same id", "highlights": ["one exact continuous clause"] }
  ]
}

Items:
${JSON.stringify(items, null, 2)}
`.trim()
}

export function parseHighlightResponse(text: string, allowedIds: Set<string>) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "")
  const parsed = JSON.parse(cleaned) as unknown
  const items =
    parsed && typeof parsed === "object" && "items" in parsed
      ? (parsed as { items?: unknown[] }).items
      : Array.isArray(parsed)
        ? parsed
        : []

  const highlights: ReviewHighlightMap = {}

  for (const item of items || []) {
    if (!item || typeof item !== "object") continue
    const source = item as { id?: unknown; highlights?: unknown; terms?: unknown; keywords?: unknown }
    const id = typeof source.id === "string" ? source.id : ""
    if (!allowedIds.has(id)) continue

    const rawTerms = Array.isArray(source.highlights)
      ? source.highlights
      : Array.isArray(source.terms)
        ? source.terms
        : Array.isArray(source.keywords)
          ? source.keywords
          : []

    highlights[id] = rawTerms
      .filter((term): term is string => typeof term === "string")
      .map((term) => term.trim())
      .filter(Boolean)
      .slice(0, MAX_HIGHLIGHTS_PER_ITEM)
  }

  return highlights
}

export async function requestHighlightMap(endpoint: string, items: HighlightRequestItem[]) {
  if (items.length === 0) return {}

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  })
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(payload?.error || `Highlight request failed (${response.status})`)
  }

  return payload?.highlights && typeof payload.highlights === "object"
    ? (payload.highlights as ReviewHighlightMap)
    : {}
}
