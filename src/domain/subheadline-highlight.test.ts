import { describe, expect, it } from "vitest";
import {
  isExactSubheadlineHighlight,
  resolveSubheadlineHighlight,
  suggestSubheadlineHighlight
} from "./subheadline-highlight";

describe("subheadline emphasis", () => {
  it("keeps an exact model-selected phrase", () => {
    const subheadline = "Turn search demand into qualified B2B leads";

    expect(
      resolveSubheadlineHighlight(subheadline, "qualified B2B leads")
    ).toBe("qualified B2B leads");
  });

  it("returns no emphasis when the model phrase is invalid", () => {
    const subheadline = "Turn search demand into qualified B2B leads";
    const highlight = resolveSubheadlineHighlight(
      subheadline,
      "rewritten phrase"
    );

    expect(highlight).toBe("");
  });

  it("preserves an intentional empty highlight from the model", () => {
    expect(resolveSubheadlineHighlight("No important phrase here", "")).toBe("");
  });

  it("uses a deterministic fallback only for legacy data with no field", () => {
    const subheadline = "Turn search demand into qualified B2B leads";
    expect(resolveSubheadlineHighlight(subheadline)).toBe(
      suggestSubheadlineHighlight(subheadline)
    );
  });

  it("normalizes whitespace before validating an exact phrase", () => {
    expect(
      isExactSubheadlineHighlight(
        "Make  AI search easier to act on",
        "AI  search"
      )
    ).toBe(true);
  });
});
