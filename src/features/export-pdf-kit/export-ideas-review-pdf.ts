import jsPDF from "jspdf"

import type { IdeaRecommendation } from "./types"

const MAX_IDEAS = 10
const PAGE_WIDTH_MM = 297
const PAGE_HEIGHT_MM = 210
const HORIZONTAL_MARGIN_MM = 16
const VERTICAL_MARGIN_MM = 20
const GAP_MM = 8
const COLUMNS = 3
const CARD_HEIGHT_MM = 148
const FONT_NAME = "SukhumvitReview"
const PT_TO_MM = 0.3528
const FONT_FILES = {
  normal: {
    filename: "SukhumvitSet-Text.ttf",
    url: "/fonts/Sukhumvit_Set/SukhumvitSet-Text.ttf",
  },
  medium: {
    filename: "SukhumvitSet-Medium.ttf",
    url: "/fonts/Sukhumvit_Set/SukhumvitSet-Medium.ttf",
  },
  semibold: {
    filename: "SukhumvitSet-SemiBold.ttf",
    url: "/fonts/Sukhumvit_Set/SukhumvitSet-SemiBold.ttf",
  },
  bold: {
    filename: "SukhumvitSet-Bold.ttf",
    url: "/fonts/Sukhumvit_Set/SukhumvitSet-Bold.ttf",
  },
} as const

type FontStyle = keyof typeof FONT_FILES

const fontBase64Promises = new Map<string, Promise<string>>()

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

async function loadFontAsBase64(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to load font ${url}: ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const chunkSize = 0x8000
  let binary = ""
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

async function ensureFonts(pdf: jsPDF) {
  try {
    for (const [style, file] of Object.entries(FONT_FILES) as Array<[FontStyle, (typeof FONT_FILES)[FontStyle]]>) {
      if (!fontBase64Promises.has(file.url)) {
        fontBase64Promises.set(file.url, loadFontAsBase64(file.url))
      }
      const fontBase64 = await fontBase64Promises.get(file.url)
      if (!fontBase64) throw new Error(`Missing font data for ${file.url}`)
      pdf.addFileToVFS(file.filename, fontBase64)
      pdf.addFont(file.filename, FONT_NAME, style)
    }
    return true
  } catch (error) {
    console.warn("[Review PDF Export] Failed to load Sukhumvit Set, falling back to Helvetica:", error)
    return false
  }
}

function setFont(pdf: jsPDF, style: FontStyle, sizePt: number, hasThaiFont: boolean) {
  pdf.setFont(hasThaiFont ? FONT_NAME : "helvetica", hasThaiFont ? style : style === "normal" ? "normal" : "bold")
  pdf.setFontSize(sizePt)
}

type TokenSegment = {
  text: string
  start: number
  end: number
}

function normalizeSubheadlineText(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

function tokenizeWithRanges(text: string): TokenSegment[] {
  const cleanText = text.replace(/\s+/g, " ").trim()
  if (!cleanText) return []

  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const Segmenter = Intl.Segmenter
    const segmenter = new Segmenter("th", { granularity: "word" })
    return Array.from(segmenter.segment(cleanText))
      .map((segment) => ({
        text: segment.segment,
        start: segment.index,
        end: segment.index + segment.segment.length,
      }))
      .filter((segment) => segment.text)
  }

  return Array.from(cleanText.matchAll(/\s+|\S+/g)).map((match) => ({
    text: match[0],
    start: match.index || 0,
    end: (match.index || 0) + match[0].length,
  }))
}

function tokenize(text: string) {
  return tokenizeWithRanges(text).map((segment) => segment.text)
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

function wrapLongToken(pdf: jsPDF, token: string, maxWidthMm: number) {
  const chunks: string[] = []
  let current = ""
  for (const char of Array.from(token)) {
    const next = current + char
    if (current && pdf.getTextWidth(next) > maxWidthMm) {
      chunks.push(current)
      current = char
    } else {
      current = next
    }
  }
  if (current) chunks.push(current)
  return chunks
}

function wrapText(pdf: jsPDF, text: string, maxWidthMm: number, maxLines: number) {
  const tokens = tokenize(text)
  const lines: string[] = []
  let current = ""

  for (const token of tokens) {
    if (!current && /^\s+$/.test(token)) continue
    const next = current + token
    if (pdf.getTextWidth(next) <= maxWidthMm) {
      current = next
      continue
    }

    if (current) {
      lines.push(current.trimEnd())
      current = ""
      if (lines.length >= maxLines) break
    }

    const nextToken = token.trimStart()
    if (pdf.getTextWidth(nextToken) <= maxWidthMm) {
      current = nextToken
    } else {
      const chunks = wrapLongToken(pdf, nextToken, maxWidthMm)
      for (const chunk of chunks) {
        lines.push(chunk)
        if (lines.length >= maxLines) break
      }
    }
    if (lines.length >= maxLines) break
  }

  if (current && lines.length < maxLines) lines.push(current.trimEnd())
  return lines
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

function getCardData(idea: IdeaRecommendation) {
  const metaTags = [...(idea.tags || []), idea.content_pillar, idea.product_focus]
    .filter((tag): tag is string => typeof tag === "string" && Boolean(tag))
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 2)

  return {
    hook: idea.copywriting?.headline || idea.title || idea.concept_idea || "",
    subheadline: idea.copywriting?.sub_headline_1 || idea.copywriting?.sub_headline_2 || "",
    cta: idea.copywriting?.cta || "",
    metaTags,
    contentType: getContentTypeLabel(idea.content_type),
  }
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
  const bodyFontSize = 11.6
  const bodyLineHeight = bodyFontSize * PT_TO_MM * 1.42

  pdf.setDrawColor(220, 227, 236)
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

  const hookFontSize = data.hook.length > 92 ? 16.8 : data.hook.length > 58 ? 18.4 : 19.8
  const hookLineHeight = hookFontSize * PT_TO_MM * 1.18
  pdf.setTextColor(16, 24, 40)
  setFont(pdf, "bold", hookFontSize, hasThaiFont)
  const hookLines = wrapText(pdf, data.hook, contentWidth, 3)
  drawCenteredTextBlock(pdf, hookLines, contentX + contentWidth / 2, y + 57, hookLineHeight)

  if (data.subheadline) {
    const subY = y + 84
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
    const ctaTextY = y + 112
    pdf.setTextColor(102, 112, 133)
    setFont(pdf, "semibold", 9.1, hasThaiFont)
    pdf.text("CTA", contentX + contentWidth / 2, ctaTextY, { align: "center", baseline: "top" })

    pdf.setTextColor(71, 84, 103)
    setFont(pdf, "medium", bodyFontSize, hasThaiFont)
    const ctaLines = wrapText(pdf, data.cta, contentWidth, 2)
    drawCenteredTextBlock(pdf, ctaLines, contentX + contentWidth / 2, ctaTextY + 6.5, bodyLineHeight)
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

function savePdf(pdf: jsPDF, filename: string) {
  const bytes = new Uint8Array(pdf.output("arraybuffer"))
  const blob = new Blob([bytes], { type: "application/pdf" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
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
