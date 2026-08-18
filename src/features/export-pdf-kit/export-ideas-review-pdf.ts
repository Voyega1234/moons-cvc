import jsPDF from "jspdf"

import { compassContentTypeHeading, contentTypeSortRank } from "./content-type-sort"
import { getIdeaWhy } from "./highlight-subheadline"
import {
  ensureFonts,
  isClosingPunctuation,
  PT_TO_MM,
  savePdf,
  setFont,
  tokenizeWithRanges,
  wrapText,
  type FontStyle,
} from "./pdf-font-kit"
import type { IdeaRecommendation } from "./types"

const MAX_IDEAS = 10
const PAGE_WIDTH_MM = 297
const PAGE_HEIGHT_MM = 210
const HORIZONTAL_MARGIN_MM = 16
const VERTICAL_MARGIN_MM = 20
const GAP_MM = 8
const COLUMNS = 3
const CARD_HEIGHT_MM = 148

type TextRun = {
  text: string
  highlight: boolean
}
export type ReviewIdeaGroup = "recommended" | "option"
export type ReviewIdeaSection = {
  heading: string
  group: ReviewIdeaGroup
  ideas: IdeaRecommendation[]
}
export type ReviewHighlightMap = Record<string, string[]>
export type CompassReviewPdfItem = {
  group: ReviewIdeaGroup
  idea: IdeaRecommendation
  highlightTerms: string[] | undefined
}
export type CompassReviewPdfPage = {
  contentType: string
  pageIndex: number
  items: CompassReviewPdfItem[]
}

function normalizeSubheadlineText(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

export function getReviewHighlightKey(group: ReviewIdeaGroup, index: number) {
  return `${group}:${index}`
}

function getExactHighlightRanges(text: string, highlightTerms?: string[]) {
  if (!highlightTerms?.length) return []

  const ranges: Array<{ start: number; end: number }> = []
  const terms = highlightTerms
    .map((term) => normalizeSubheadlineText(term))
    .filter((term) => term.length >= 2 && text.includes(term))
    .sort((a, b) => b.length - a.length)

  for (const term of terms) {
    let start = text.indexOf(term)
    while (start >= 0) {
      const end = start + term.length
      const overlaps = ranges.some((range) => start < range.end && end > range.start)
      if (!overlaps) ranges.push({ start, end })
      start = text.indexOf(term, end)
    }
  }

  return ranges.sort((a, b) => a.start - b.start)
}

function makeHighlightedRuns(text: string, highlightTerms?: string[]) {
  const cleanText = normalizeSubheadlineText(text)
  const highlightRanges = getExactHighlightRanges(cleanText, highlightTerms)

  return tokenizeWithRanges(cleanText).map((token) => {
    const isHighlighted = highlightRanges.some((range) => token.start < range.end && token.end > range.start)
    return {
      text: token.text,
      highlight: isHighlighted,
    }
  })
}

function getTextRunWidth(pdf: jsPDF, run: TextRun, normalStyle: FontStyle, highlightStyle: FontStyle, sizePt: number, hasThaiFont: boolean) {
  setFont(pdf, run.highlight ? highlightStyle : normalStyle, sizePt, hasThaiFont)
  return pdf.getTextWidth(run.text)
}

function wrapRuns(
  pdf: jsPDF,
  runs: TextRun[],
  maxWidthMm: number,
  maxLines: number,
  normalStyle: FontStyle,
  highlightStyle: FontStyle,
  sizePt: number,
  hasThaiFont: boolean,
) {
  const lines: TextRun[][] = []
  let line: TextRun[] = []
  let lineWidth = 0

  for (const run of runs) {
    const runWidth = getTextRunWidth(pdf, run, normalStyle, highlightStyle, sizePt, hasThaiFont)
    if (line.length > 0 && isClosingPunctuation(run.text)) {
      line.push(run)
      lineWidth += runWidth
      continue
    }
    if (line.length > 0 && lineWidth + runWidth > maxWidthMm) {
      lines.push(line)
      if (lines.length >= maxLines) return lines
      line = []
      lineWidth = 0
    }

    line.push(run)
    lineWidth += runWidth
  }

  if (line.length > 0 && lines.length < maxLines) lines.push(line)
  return lines
}

function drawHighlightedText(
  pdf: jsPDF,
  runs: TextRun[],
  x: number,
  y: number,
  maxWidthMm: number,
  maxLines: number,
  lineHeightMm: number,
  sizePt: number,
  hasThaiFont: boolean,
  align: "left" | "center" = "left",
) {
  const lines = wrapRuns(pdf, runs, maxWidthMm, maxLines, "medium", "bold", sizePt, hasThaiFont)

  lines.forEach((line, lineIndex) => {
    const lineWidth =
      align === "center"
        ? line.reduce((total, run) => total + getTextRunWidth(pdf, run, "medium", "bold", sizePt, hasThaiFont), 0)
        : 0
    let cursorX = align === "center" ? x + Math.max(0, maxWidthMm - lineWidth) / 2 : x
    line.forEach((run) => {
      pdf.setTextColor(run.highlight ? 16 : 52, run.highlight ? 24 : 64, run.highlight ? 40 : 84)
      setFont(pdf, run.highlight ? "bold" : "medium", sizePt, hasThaiFont)
      pdf.text(run.text, cursorX, y + lineIndex * lineHeightMm, { baseline: "top" })
      cursorX += pdf.getTextWidth(run.text)
    })
  })

  return lines.length * lineHeightMm
}

function drawCenteredTextBlock(pdf: jsPDF, lines: string[], centerX: number, y: number, lineHeightMm: number) {
  lines.forEach((line, index) => {
    pdf.text(line, centerX, y + index * lineHeightMm, { align: "center", baseline: "top" })
  })
}

function getContentTypeLabel(contentType?: string) {
  const labels: Record<string, string> = {
    STATIC: "STATIC AD",
    "STATIC AD": "STATIC AD",
    ALBUM: "ALBUM AD",
    "ALBUM AD": "ALBUM AD",
    MOTION: "SHORT VDO",
    "MOTION AD": "SHORT VDO",
    "SHORT VDO": "SHORT VDO",
    "SHORT VIDEO": "SHORT VDO",
    UGC: "UGC VIDEO",
    "UGC VIDEO": "UGC VIDEO",
    "VIDEO AD": "UGC VIDEO",
  }

  return contentType ? labels[contentType.toUpperCase()] || contentType : ""
}

export function getReviewPdfSubheadline(idea: IdeaRecommendation) {
  return (
    idea.copywriting?.sub_headline_1?.trim() ||
    idea.copywriting?.sub_headline_2?.trim() ||
    "-"
  )
}

function getCardData(idea: IdeaRecommendation) {
  const metaTags = [...(idea.tags || []), idea.content_pillar, idea.product_focus]
    .filter((tag): tag is string => typeof tag === "string" && Boolean(tag))
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 2)

  return {
    hook: idea.copywriting?.headline || idea.title || idea.concept_idea || "",
    subheadline: getReviewPdfSubheadline(idea),
    cta: idea.copywriting?.cta || "",
    why: idea.competitiveGap || getIdeaWhy(idea),
    metaTags,
    contentType: getContentTypeLabel(idea.content_type),
  }
}

export function buildCompassReviewPdfPages(
  sections: ReviewIdeaSection[],
  highlightMap: ReviewHighlightMap = {},
) {
  const itemsByContentType = new Map<string, CompassReviewPdfItem[]>()

  sections.forEach((section) => {
    section.ideas.forEach((idea, index) => {
      const contentType = getContentTypeLabel(idea.content_type) || "CREATIVE"
      const items = itemsByContentType.get(contentType) || []
      items.push({
        group: section.group,
        idea,
        highlightTerms: highlightMap[getReviewHighlightKey(section.group, index)],
      })
      itemsByContentType.set(contentType, items)
    })
  })

  const pages: CompassReviewPdfPage[] = []
  const contentTypeEntries = [...itemsByContentType.entries()].sort(
    ([left], [right]) =>
      contentTypeSortRank(left) - contentTypeSortRank(right) ||
      left.localeCompare(right),
  )

  contentTypeEntries.forEach(([contentType, items]) => {
    const orderedItems = [...items].sort(
      (a, b) => Number(a.group === "option") - Number(b.group === "option"),
    )
    for (let index = 0; index < orderedItems.length; index += COLUMNS) {
      pages.push({
        contentType,
        pageIndex: index / COLUMNS,
        items: orderedItems.slice(index, index + COLUMNS),
      })
    }
  })

  return pages
}

function drawIdeaCard(
  pdf: jsPDF,
  idea: IdeaRecommendation,
  ideaNumber: number,
  highlightTerms: string[] | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  hasThaiFont: boolean,
) {
  const data = getCardData(idea)
  const padX = 6.5
  const contentX = x + padX
  const contentWidth = width - padX * 2
  const bodyFontSize = 10.4
  const bodyLineHeight = bodyFontSize * PT_TO_MM * 1.38

  pdf.setDrawColor(220, 227, 236)
  pdf.setLineWidth(0.28)
  pdf.setFillColor(255, 255, 255)
  pdf.roundedRect(x, y, width, height, 3.2, 3.2, "FD")

  const ideaBadgeWidth = 21
  const badgeGap = data.contentType ? 4 : 0
  setFont(pdf, "bold", 9.5, hasThaiFont)
  const contentTypeBadgeWidth = data.contentType ? Math.min(29, Math.max(21, pdf.getTextWidth(data.contentType) + 7)) : 0
  const badgeGroupWidth = ideaBadgeWidth + badgeGap + contentTypeBadgeWidth
  const badgeStartX = contentX + (contentWidth - badgeGroupWidth) / 2

  pdf.setFillColor(238, 242, 255)
  pdf.roundedRect(badgeStartX, y + 7, ideaBadgeWidth, 6.2, 1.6, 1.6, "F")
  pdf.setTextColor(37, 99, 235)
  setFont(pdf, "bold", 9.7, hasThaiFont)
  pdf.text(`Idea ${ideaNumber}`, badgeStartX + ideaBadgeWidth / 2, y + 10.1, { align: "center", baseline: "middle" })

  if (data.contentType) {
    const badgeX = badgeStartX + ideaBadgeWidth + badgeGap
    pdf.setFillColor(244, 247, 255)
    pdf.roundedRect(badgeX, y + 7, contentTypeBadgeWidth, 6.2, 1.6, 1.6, "F")
    pdf.setTextColor(29, 78, 216)
    pdf.text(data.contentType, badgeX + contentTypeBadgeWidth / 2, y + 10.1, { align: "center", baseline: "middle" })
  }

  if (data.metaTags.length > 0) {
    pdf.setTextColor(102, 112, 133)
    setFont(pdf, "medium", 9.0, hasThaiFont)
    const metaText = data.metaTags.join(" · ")
    const metaLines = wrapText(pdf, metaText, contentWidth, 1)
    pdf.text(metaLines[0] || "", contentX + contentWidth / 2, y + 18.5, { align: "center", baseline: "top" })
  }

  const hookFontSize = data.hook.length > 92 ? 15.8 : data.hook.length > 58 ? 17 : 18
  const hookLineHeight = hookFontSize * PT_TO_MM * 1.16
  pdf.setTextColor(16, 24, 40)
  setFont(pdf, "bold", hookFontSize, hasThaiFont)
  const hookLines = wrapText(pdf, data.hook, contentWidth, 3)
  drawCenteredTextBlock(pdf, hookLines, contentX + contentWidth / 2, y + 40, hookLineHeight)

  if (data.subheadline) {
    const subY = y + 69
    drawHighlightedText(
      pdf,
      makeHighlightedRuns(data.subheadline, highlightTerms),
      contentX,
      subY,
      contentWidth,
      3,
      bodyLineHeight,
      bodyFontSize,
      hasThaiFont,
      "center",
    )
  }

  if (data.cta) {
    const ctaTextY = y + 96.5
    pdf.setTextColor(102, 112, 133)
    setFont(pdf, "semibold", 8.6, hasThaiFont)
    pdf.text("CTA", contentX + contentWidth / 2, ctaTextY, { align: "center", baseline: "top" })

    pdf.setTextColor(71, 84, 103)
    setFont(pdf, "medium", 9.8, hasThaiFont)
    const ctaLines = wrapText(pdf, data.cta, contentWidth, 2)
    drawCenteredTextBlock(pdf, ctaLines, contentX + contentWidth / 2, ctaTextY + 6, 4.8)
  }

  if (data.why) {
    const whyX = contentX
    const whyY = y + 116
    const whyHeight = 25.5
    pdf.setFillColor(238, 243, 255)
    pdf.roundedRect(whyX, whyY, contentWidth, whyHeight, 3, 3, "F")

    pdf.setTextColor(37, 99, 235)
    setFont(pdf, "bold", 7.7, hasThaiFont)
    pdf.text("WHY", contentX + contentWidth / 2, whyY + 4.8, {
      align: "center",
      baseline: "top",
    })

    setFont(pdf, "medium", 7.6, hasThaiFont)
    const whyLines = wrapText(pdf, data.why, contentWidth - 8, 4)
    drawCenteredTextBlock(
      pdf,
      whyLines,
      contentX + contentWidth / 2,
      whyY + 9,
      3.65,
    )
  }
}

function drawSectionHeading(pdf: jsPDF, heading: string, x: number, y: number, hasThaiFont: boolean) {
  pdf.setTextColor(16, 24, 40)
  setFont(pdf, "bold", 13.5, hasThaiFont)
  pdf.text(heading, x, y, { baseline: "top" })
}

function drawPageBackground(pdf: jsPDF) {
  pdf.setFillColor(255, 255, 255)
  pdf.rect(0, 0, PAGE_WIDTH_MM, PAGE_HEIGHT_MM, "F")
}

function drawNeoReviewHeader(
  pdf: jsPDF,
  contentType: string,
  brandName: string,
  pageNumber: number,
  pageCount: number,
  hasThaiFont: boolean,
) {
  const centerX = PAGE_WIDTH_MM / 2

  pdf.setTextColor(23, 29, 45)
  setFont(pdf, "semibold", 21, hasThaiFont)
  pdf.text(compassContentTypeHeading(contentType), centerX, 12, {
    align: "center",
    baseline: "top",
  })

  pdf.setTextColor(108, 116, 133)
  setFont(pdf, "normal", 9.5, hasThaiFont)
  pdf.text(
    `${brandName} · Recommended first, followed by options`,
    centerX,
    21.5,
    { align: "center", baseline: "top" },
  )

  pdf.setTextColor(124, 131, 146)
  setFont(pdf, "medium", 9, hasThaiFont)
  pdf.text(`${pageNumber} / ${pageCount}`, PAGE_WIDTH_MM - 11, 12.6, {
    align: "right",
    baseline: "top",
  })

  pdf.setDrawColor(226, 230, 239)
  pdf.setLineWidth(0.28)
  pdf.line(11, 32, PAGE_WIDTH_MM - 11, 32)
}

function drawCompassIdeaCard(
  pdf: jsPDF,
  item: CompassReviewPdfItem,
  ideaNumber: number,
  x: number,
  y: number,
  width: number,
  height: number,
  hasThaiFont: boolean,
) {
  const data = getCardData(item.idea)
  const recommended = item.group === "recommended"
  const contentX = x + 7
  const contentWidth = width - 14
  const centerX = x + width / 2

  pdf.setFillColor(recommended ? 251 : 255, recommended ? 252 : 255, 255)
  pdf.setDrawColor(
    recommended ? 189 : 221,
    recommended ? 201 : 226,
    recommended ? 242 : 236,
  )
  pdf.setLineWidth(recommended ? 0.42 : 0.32)
  pdf.roundedRect(x, y, width, height, 4.5, 4.5, "FD")

  pdf.setFillColor(
    recommended ? 234 : 244,
    recommended ? 240 : 245,
    recommended ? 255 : 248,
  )
  pdf.roundedRect(x + 0.18, y + 0.18, width - 0.36, 7.2, 4.1, 4.1, "F")
  pdf.rect(x + 0.18, y + 3.7, width - 0.36, 3.7, "F")
  pdf.setTextColor(recommended ? 39 : 107, recommended ? 88 : 114, recommended ? 217 : 128)
  setFont(pdf, "semibold", 7.4, hasThaiFont)
  pdf.text(recommended ? "RECOMMENDED" : "OPTION", centerX, y + 4, {
    align: "center",
    baseline: "middle",
  })

  setFont(pdf, "semibold", 9, hasThaiFont)
  const ideaLabel = `Idea ${ideaNumber}`
  const ideaWidth = Math.max(22, pdf.getTextWidth(ideaLabel) + 8)
  const formatWidth = data.contentType
    ? Math.max(24, Math.min(34, pdf.getTextWidth(data.contentType) + 8))
    : 0
  const badgeGap = formatWidth ? 2.5 : 0
  const badgeStartX = centerX - (ideaWidth + badgeGap + formatWidth) / 2

  pdf.setFillColor(234, 240, 255)
  pdf.roundedRect(badgeStartX, y + 11.2, ideaWidth, 8, 2.5, 2.5, "F")
  pdf.setTextColor(39, 88, 217)
  pdf.text(ideaLabel, badgeStartX + ideaWidth / 2, y + 15.2, {
    align: "center",
    baseline: "middle",
  })

  if (formatWidth) {
    const formatX = badgeStartX + ideaWidth + badgeGap
    pdf.setFillColor(243, 245, 251)
    pdf.roundedRect(formatX, y + 11.2, formatWidth, 8, 2.5, 2.5, "F")
    pdf.text(data.contentType, formatX + formatWidth / 2, y + 15.2, {
      align: "center",
      baseline: "middle",
    })
  }

  if (data.metaTags.length > 0) {
    pdf.setTextColor(91, 99, 116)
    setFont(pdf, "medium", 9, hasThaiFont)
    const metaLines = wrapText(pdf, data.metaTags.join(" · "), contentWidth, 1)
    pdf.text(metaLines[0] || "", centerX, y + 22.5, {
      align: "center",
      baseline: "top",
    })
  }

  pdf.setTextColor(128, 135, 151)
  setFont(pdf, "semibold", 8.1, hasThaiFont)
  const hookLabelY = y + 48
  const hookTextY = y + 55
  pdf.text("HOOK", centerX, hookLabelY, { align: "center", baseline: "top" })

  const hookFontSize = data.hook.length > 78 ? 16.5 : data.hook.length > 48 ? 18.5 : 21
  const hookLineHeight = hookFontSize * PT_TO_MM * 1.08
  pdf.setTextColor(23, 29, 45)
  setFont(pdf, "bold", hookFontSize, hasThaiFont)
  const hookLines = wrapText(pdf, data.hook, contentWidth, data.why ? 3 : 4)
  drawCenteredTextBlock(pdf, hookLines, centerX, hookTextY, hookLineHeight)

  const subheadlineLabelY = Math.max(
    y + 78,
    hookTextY + hookLines.length * hookLineHeight + 8,
  )
  const subheadlineTextY = subheadlineLabelY + 7

  pdf.setTextColor(128, 135, 151)
  setFont(pdf, "semibold", 8.1, hasThaiFont)
  pdf.text("SUB-HEADLINE", centerX, subheadlineLabelY, {
    align: "center",
    baseline: "top",
  })

  if (data.subheadline) {
    const bodyFontSize = 10
    drawHighlightedText(
      pdf,
      makeHighlightedRuns(data.subheadline, item.highlightTerms),
      contentX,
      subheadlineTextY,
      contentWidth,
      data.why ? 3 : 4,
      bodyFontSize * PT_TO_MM * 1.36,
      bodyFontSize,
      hasThaiFont,
      "center",
    )
  }

  if (data.why) {
    const whyY = y + 112
    const whyHeight = 25.5
    pdf.setFillColor(238, 243, 255)
    pdf.roundedRect(contentX, whyY, contentWidth, whyHeight, 3, 3, "F")

    pdf.setTextColor(37, 99, 235)
    setFont(pdf, "bold", 7.7, hasThaiFont)
    pdf.text("WHY", centerX, whyY + 4.8, {
      align: "center",
      baseline: "top",
    })

    pdf.setTextColor(71, 84, 103)
    setFont(pdf, "medium", 7.6, hasThaiFont)
    const whyLines = wrapText(pdf, data.why, contentWidth - 8, 4)
    drawCenteredTextBlock(pdf, whyLines, centerX, whyY + 9, 3.65)
  }

  pdf.setTextColor(128, 135, 151)
  setFont(pdf, "semibold", 8.1, hasThaiFont)
  pdf.text("CTA", centerX, y + 142, { align: "center", baseline: "top" })

  if (data.cta) {
    pdf.setTextColor(36, 42, 56)
    const ctaFontSize = 10
    setFont(pdf, "medium", ctaFontSize, hasThaiFont)
    const ctaLines = wrapText(pdf, data.cta, contentWidth, 2)
    drawCenteredTextBlock(
      pdf,
      ctaLines,
      centerX,
      y + 149,
      ctaFontSize * PT_TO_MM * 1.36,
    )
  }
}

export async function exportIdeasReviewPdf(
  sections: ReviewIdeaSection[],
  filename: string,
  highlightMap: ReviewHighlightMap = {},
) {
  const sectionsToRender = sections
    .map((section) => ({ ...section, ideas: section.ideas.slice(0, MAX_IDEAS) }))
    .filter((section) => section.ideas.length > 0)
  if (sectionsToRender.length === 0) return

  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" })
  const hasThaiFont = await ensureFonts(pdf)
  const usableWidth = PAGE_WIDTH_MM - HORIZONTAL_MARGIN_MM * 2
  const cardWidth = (usableWidth - GAP_MM * (COLUMNS - 1)) / COLUMNS
  const cardHeight = CARD_HEIGHT_MM
  const cardY = VERTICAL_MARGIN_MM + Math.max(0, PAGE_HEIGHT_MM - VERTICAL_MARGIN_MM * 2 - cardHeight) / 2
  let ideaNumber = 1

  sectionsToRender.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) pdf.addPage("a4", "landscape")

    section.ideas.forEach((idea, index) => {
      if (index > 0 && index % COLUMNS === 0) pdf.addPage("a4", "landscape")
      if (index % COLUMNS === 0) {
        drawPageBackground(pdf)
        drawSectionHeading(pdf, section.heading, HORIZONTAL_MARGIN_MM, 8, hasThaiFont)
      }

      const col = index % COLUMNS
      const x = HORIZONTAL_MARGIN_MM + col * (cardWidth + GAP_MM)
      drawIdeaCard(
        pdf,
        idea,
        ideaNumber,
        highlightMap[getReviewHighlightKey(section.group, index)],
        x,
        cardY,
        cardWidth,
        cardHeight,
        hasThaiFont,
      )
      ideaNumber += 1
    })
  })

  savePdf(pdf, filename)
}

export async function exportCompassIdeasReviewPdf(
  sections: ReviewIdeaSection[],
  filename: string,
  highlightMap: ReviewHighlightMap = {},
  brandName = "Creative topics",
) {
  const pages = buildCompassReviewPdfPages(sections, highlightMap)
  if (pages.length === 0) return

  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" })
  const hasThaiFont = await ensureFonts(pdf)
  const horizontalPadding = 11
  const gap = 7
  const cardY = 37
  const cardHeight = PAGE_HEIGHT_MM - cardY - 9
  const cardWidth = (PAGE_WIDTH_MM - horizontalPadding * 2 - gap * 2) / COLUMNS

  pages.forEach((page, pageIndex) => {
    if (pageIndex > 0) pdf.addPage("a4", "landscape")
    drawPageBackground(pdf)
    drawNeoReviewHeader(
      pdf,
      page.contentType,
      brandName,
      pageIndex + 1,
      pages.length,
      hasThaiFont,
    )

    page.items.forEach((item, index) => {
      drawCompassIdeaCard(
        pdf,
        item,
        page.pageIndex * COLUMNS + index + 1,
        horizontalPadding + index * (cardWidth + gap),
        cardY,
        cardWidth,
        cardHeight,
        hasThaiFont,
      )
    })
  })

  savePdf(pdf, filename)
}
