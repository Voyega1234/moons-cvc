import type { IdeaRecommendation } from "./types"

export const EXPORT_CONTENT_TYPE_ORDER = ["STATIC AD", "ALBUM AD", "UGC VIDEO", "SHORT VIDEO"] as const

export function normalizeContentTypeForSort(contentType?: string) {
  const normalized = (contentType || "").trim().toUpperCase()
  if (normalized === "STATIC" || normalized === "SINGLE STATIC" || normalized === "1:1 STATIC") return "STATIC AD"
  if (normalized === "ALBUM" || normalized === "ALBUM POST") return "ALBUM AD"
  if (normalized === "UGC" || normalized === "VIDEO AD") return "UGC VIDEO"
  if (
    normalized === "MOTION" ||
    normalized === "MOTION AD" ||
    normalized === "MOTION STATIC" ||
    normalized === "SHORT VDO"
  ) return "SHORT VIDEO"
  return normalized
}

export function contentTypeSortRank(contentType?: string) {
  const rank = EXPORT_CONTENT_TYPE_ORDER.indexOf(
    normalizeContentTypeForSort(contentType) as (typeof EXPORT_CONTENT_TYPE_ORDER)[number],
  )
  return rank === -1 ? EXPORT_CONTENT_TYPE_ORDER.length : rank
}

export function sortIdeasByContentType(ideasToSort: IdeaRecommendation[]) {
  return ideasToSort
    .map((idea, index) => ({ idea, index }))
    .sort((left, right) => {
      return (
        contentTypeSortRank(left.idea.content_type) -
          contentTypeSortRank(right.idea.content_type) || left.index - right.index
      )
    })
    .map(({ idea }) => idea)
}
