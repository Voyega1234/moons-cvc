import { describe, expect, it } from "vitest";
import { presentBrandMemoryText } from "./brand-memory-presentation";

describe("presentBrandMemoryText", () => {
  it("hides legacy storage paths and presents a compact citation", () => {
    expect(
      presentBrandMemoryText(
        [
          "Mood: clean, modern",
          "Source assets: client/job/post-1.jpg, client/job/post-2.jpg",
          "",
          "Source: brand_analysis_jobs/job-123"
        ].join("\n")
      )
    ).toEqual({
      text: "Mood: clean, modern",
      citationLabel: "AI analysis · 2 images",
      citationTitle: "Source job job-123"
    });
  });

  it("reads the compact citation format used by new ingestion jobs", () => {
    expect(
      presentBrandMemoryText(
        "Use strong blue gradients.\nSource: brand_analysis_jobs/job-456 · 12 images"
      )
    ).toEqual({
      text: "Use strong blue gradients.",
      citationLabel: "AI analysis · 12 images",
      citationTitle: "Source job job-456"
    });
  });

  it("removes technical source metadata when it was appended inline", () => {
    expect(
      presentBrandMemoryText(
        "Use strong blue gradients. Source: brand_analysis_jobs/job-789 · 12 images"
      )
    ).toEqual({
      text: "Use strong blue gradients.",
      citationLabel: "AI analysis · 12 images",
      citationTitle: "Source job job-789"
    });
  });

  it("leaves manually entered memory unchanged", () => {
    expect(presentBrandMemoryText("Keep the logo clear.")).toEqual({
      text: "Keep the logo clear.",
      citationLabel: null,
      citationTitle: null
    });
  });
});
