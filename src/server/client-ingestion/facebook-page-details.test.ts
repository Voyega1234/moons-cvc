import { describe, expect, it } from "vitest";
import { normalizeFacebookPageDetails } from "./facebook-page-details";

describe("normalizeFacebookPageDetails", () => {
  it("normalizes the page logo and primary category", () => {
    expect(
      normalizeFacebookPageDetails([
        { error: "Page unavailable" },
        {
          title: "Mr Bean",
          image: "https://cdn.example.com/logo.png",
          category: ["TV show", "Entertainment"]
        }
      ])
    ).toEqual({
      title: "Mr Bean",
      imageUrl: "https://cdn.example.com/logo.png",
      category: "TV show"
    });
  });

  it("ignores unsafe image URLs and empty payloads", () => {
    expect(
      normalizeFacebookPageDetails([{ image: "javascript:alert(1)" }])
    ).toBeNull();
    expect(normalizeFacebookPageDetails([])).toBeNull();
  });
});
