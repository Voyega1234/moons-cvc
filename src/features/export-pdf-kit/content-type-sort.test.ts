import { describe, expect, it } from "vitest";
import {
  normalizeContentTypeForSort,
  sortIdeasByContentType
} from "./content-type-sort";

describe("content type sorting", () => {
  it("normalizes workflow labels and sorts them in the PDF section order", () => {
    const ideas = sortIdeasByContentType([
      { title: "UGC", content_type: "UGC video" },
      { title: "Motion", content_type: "Motion static" },
      { title: "Static", content_type: "Single static" },
      { title: "Album", content_type: "Album post" }
    ]);

    expect(ideas.map((idea) => idea.title)).toEqual([
      "Static",
      "Album",
      "UGC",
      "Motion"
    ]);
    expect(normalizeContentTypeForSort("1:1 Static")).toBe("STATIC AD");
  });
});

