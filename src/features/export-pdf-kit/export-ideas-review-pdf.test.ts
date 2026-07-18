import { describe, expect, it } from "vitest"

import { buildCompassReviewPdfPages } from "./export-ideas-review-pdf"

function idea(title: string, contentType: string) {
  return {
    title,
    content_type: contentType,
    copywriting: {
      headline: `${title} hook`,
      sub_headline_1: `${title} supporting copy`,
      cta: "Learn more",
    },
  }
}

describe("Compass review PDF page planning", () => {
  it("groups by creative type, places Recommended first, and preserves the current renderer inputs", () => {
    const pages = buildCompassReviewPdfPages(
      [
        {
          heading: "Recommended topics",
          group: "recommended",
          ideas: [idea("Static A", "STATIC AD"), idea("UGC A", "UGC VIDEO")],
        },
        {
          heading: "Other options",
          group: "option",
          ideas: [
            idea("Static B", "STATIC AD"),
            idea("Static C", "STATIC AD"),
            idea("Static D", "STATIC AD"),
            idea("Album A", "ALBUM AD"),
          ],
        },
      ],
      {
        "recommended:0": ["Static A supporting copy"],
        "option:0": ["Static B supporting copy"],
      },
    )

    expect(pages.map((page) => page.contentType)).toEqual([
      "STATIC AD",
      "STATIC AD",
      "ALBUM AD",
      "UGC VIDEO",
    ])
    expect(pages[0]?.items.map((item) => item.group)).toEqual([
      "recommended",
      "option",
      "option",
    ])
    expect(pages[1]?.pageIndex).toBe(1)
    expect(pages[0]?.items[0]?.highlightTerms).toEqual([
      "Static A supporting copy",
    ])
    expect(pages[0]?.items[1]?.highlightTerms).toEqual([
      "Static B supporting copy",
    ])
  })
})
