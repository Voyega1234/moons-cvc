import jsPDF from "jspdf"

export const FONT_NAME = "SukhumvitReview"
export const PT_TO_MM = 0.3528
export const FONT_FILES = {
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

export type FontStyle = keyof typeof FONT_FILES

const fontBase64Promises = new Map<string, Promise<string>>()

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

export async function ensureFonts(pdf: jsPDF) {
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
    console.warn("[PDF Export] Failed to load Sukhumvit Set, falling back to Helvetica:", error)
    return false
  }
}

export function setFont(pdf: jsPDF, style: FontStyle, sizePt: number, hasThaiFont: boolean) {
  pdf.setFont(hasThaiFont ? FONT_NAME : "helvetica", hasThaiFont ? style : style === "normal" ? "normal" : "bold")
  pdf.setFontSize(sizePt)
}

type TokenSegment = {
  text: string
  start: number
  end: number
}

export function tokenizeWithRanges(text: string): TokenSegment[] {
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

export function tokenize(text: string) {
  return tokenizeWithRanges(text).map((segment) => segment.text)
}

export function isClosingPunctuation(text: string) {
  return /^[,.;:!?…%)\]}”’]+$/u.test(text)
}

export function wrapLongToken(pdf: jsPDF, token: string, maxWidthMm: number) {
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

export function wrapText(pdf: jsPDF, text: string, maxWidthMm: number, maxLines: number) {
  const tokens = tokenize(text)
  const lines: string[] = []
  let current = ""

  for (const token of tokens) {
    if (!current && /^\s+$/.test(token)) continue
    const next = current + token
    if (
      pdf.getTextWidth(next) <= maxWidthMm ||
      (current && isClosingPunctuation(token))
    ) {
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

export function savePdf(pdf: jsPDF, filename: string) {
  const bytes = new Uint8Array(pdf.output("arraybuffer"))
  const blob = new Blob([bytes], { type: "application/pdf" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
