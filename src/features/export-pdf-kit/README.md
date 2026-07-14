# Export PDF Kit

Portable client-side PDF export code for the Creative Compass idea review deck.

This folder is intentionally independent from the main app aliases such as `@/lib/...`, so it can be copied into another React/Next.js project.

## Files

- `export-ideas-review-pdf.ts` - main PDF renderer using `jsPDF`
- `types.ts` - minimal idea types required by the renderer
- `content-type-sort.ts` - stable sorting helper for content type order
- `highlight-subheadline.ts` - helper code for building highlight payloads/prompts and parsing model output
- `HIGHLIGHT_PROMPT.md` - copy-ready prompt for Gemini/OpenAI/etc.
- `index.ts` - convenience exports

## Dependency

Install `jspdf` in the target project:

```bash
npm install jspdf
```

## Font Requirement

The renderer loads Sukhumvit font files from these public URLs:

```text
/fonts/Sukhumvit_Set/SukhumvitSet-Text.ttf
/fonts/Sukhumvit_Set/SukhumvitSet-Medium.ttf
/fonts/Sukhumvit_Set/SukhumvitSet-SemiBold.ttf
/fonts/Sukhumvit_Set/SukhumvitSet-Bold.ttf
```

In a Next.js project, copy the font folder to:

```text
public/fonts/Sukhumvit_Set/
```

If the fonts are missing, the renderer falls back to Helvetica, but Thai text will not render as well.

## Runtime Requirement

Call `exportIdeasReviewPdf` from the browser/client side. It uses browser APIs:

- `fetch`
- `btoa`
- `Blob`
- `document.createElement`
- `URL.createObjectURL`

In Next.js App Router, call it inside a `"use client"` component or a client-side handler.

## Basic Usage

```ts
import {
  buildHighlightItems,
  exportIdeasReviewPdf,
  requestHighlightMap,
  sortIdeasByContentType,
  type IdeaRecommendation,
} from "./export-pdf-kit"

async function exportPdf({
  recommended,
  options,
}: {
  recommended: IdeaRecommendation[]
  options: IdeaRecommendation[]
}) {
  const sortedRecommended = sortIdeasByContentType(recommended)
  const sortedOptions = sortIdeasByContentType(options)
  const sections = [
    { heading: "Recommended topics", group: "recommended" as const, ideas: sortedRecommended },
    { heading: "Other options", group: "option" as const, ideas: sortedOptions },
  ]
  const highlightItems = buildHighlightItems(sections)
  const highlightMap = await requestHighlightMap("/api/idea-highlight-keywords", highlightItems)

  await exportIdeasReviewPdf(
    sections,
    "ideas-idea-review.pdf",
    highlightMap,
  )
}
```

## Content Type Sort Order

`sortIdeasByContentType` sorts in this order:

```text
STATIC AD -> ALBUM AD -> UGC VIDEO -> SHORT VIDEO
```

Aliases handled:

- `STATIC` -> `STATIC AD`
- `ALBUM` -> `ALBUM AD`
- `UGC` or `VIDEO AD` -> `UGC VIDEO`
- `MOTION`, `MOTION AD`, or `SHORT VDO` -> `SHORT VIDEO`

Unknown content types are placed after the known types while preserving original order.

## Highlight Map

The PDF can bold selected phrases in each subheadline.

`highlightMap` format:

```ts
const highlightMap = {
  "recommended:0": ["exact phrase from subheadline"],
  "recommended:1": ["another exact phrase"],
  "option:0": ["exact phrase"],
}
```

Keys use:

```text
${group}:${index}
```

where `group` is `recommended` or `option`, and `index` is the idea index after sorting. If you generate highlights with AI, sort ideas before generating the keys.

If you do not need highlights, pass `{}` or omit the third argument.

## Highlight Prompt And Helper Code

Use `highlight-subheadline.ts` when you want the same AI-assisted bolding behavior as the original app.

```ts
import {
  buildHighlightItems,
  buildHighlightPrompt,
  parseHighlightResponse,
  requestHighlightMap,
} from "./export-pdf-kit"
```

Client-side usage with your own API endpoint:

```ts
const sections = [
  { heading: "Recommended topics", group: "recommended" as const, ideas: sortedRecommended },
  { heading: "Other options", group: "option" as const, ideas: sortedOptions },
]

const highlightItems = buildHighlightItems(sections)
const highlightMap = await requestHighlightMap("/api/idea-highlight-keywords", highlightItems)

await exportIdeasReviewPdf(sections, "ideas-idea-review.pdf", highlightMap)
```

Server-side prompt usage:

```ts
const items = buildHighlightItems(sections)
const prompt = buildHighlightPrompt(items)
const modelText = await callYourModel(prompt)
const highlightMap = parseHighlightResponse(modelText, new Set(items.map((item) => item.id)))
```

The exact prompt is also available in `HIGHLIGHT_PROMPT.md`.

## Expected Idea Shape

The renderer reads these fields:

```ts
type IdeaRecommendation = {
  title?: string
  content_type?: string
  content_pillar?: string
  product_focus?: string
  concept_idea?: string
  tags?: string[]
  copywriting?: {
    headline?: string
    sub_headline_1?: string
    sub_headline_2?: string
    cta?: string
  }
}
```

Other fields can exist; they are ignored by this PDF.

## Current Layout

- A4 landscape
- 3 cards per row/page
- separate pages for `Recommended topics` and `Other options`
- card height: `148mm`
- card text alignment: centered
- top pills: `Idea N` and content type
- no `REC/OPT` pill
- no `WHY` box

## Common Integration Notes

1. Copy this whole folder into the target project.
2. Install `jspdf`.
3. Copy the Sukhumvit font files into `public/fonts/Sukhumvit_Set/`.
4. Import from `./export-pdf-kit`.
5. Sort ideas before creating highlight keys.
6. Call the export function from a client-side click handler.
