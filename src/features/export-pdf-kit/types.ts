export type IdeaContentType =
  | "STATIC AD"
  | "UGC VIDEO"
  | "VIDEO AD"
  | "ALBUM AD"
  | "SHORT VDO"
  | "SHORT VIDEO"
  | "MOTION AD"
  | string

export type VisualRoute = {
  route_name?: string
  route_type?: string
  visual_idea?: string
  why_it_fits?: string
}

export type IdeaDescription =
  | string
  | {
      summary?: string
      sections?: Array<{
        group?: "pain" | "insight_solution" | "why_evidence" | string
        bullets?: string[]
      }>
    }
  | Array<{
      label?: "Pain" | "Insight" | "Solution/Product fit" | "Why this converts" | "Evidence/Counterpoint" | string
      text?: string
    }>

export interface IdeaRecommendation {
  title?: string
  description?: IdeaDescription
  category?: string
  concept_type?: "Proven Concept" | "New Concept" | string
  impact?: "Proven Concept" | "New Concept" | string
  competitiveGap?: string
  tags?: string[]
  content_pillar?: string
  product_focus?: string
  product_service_focus?: string
  concept_idea?: string
  content_type?: IdeaContentType
  visual_routes?: VisualRoute[]
  copywriting?: {
    headline?: string
    sub_headline_1?: string
    sub_headline_2?: string
    bullets?: string[]
    cta?: string
  }
}
