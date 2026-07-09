import { describe, expect, it } from "vitest";
import {
  brandDocumentTypeLabels,
  brandDocumentTypes,
  isBrandDocumentType
} from "./brand-memory";

describe("brand memory document types", () => {
  it("accepts only supported business document types", () => {
    expect(isBrandDocumentType("brand_guideline")).toBe(true);
    expect(isBrandDocumentType("pdf")).toBe(false);
    expect(isBrandDocumentType("image")).toBe(false);
  });

  it("has display labels for every selectable type", () => {
    for (const type of brandDocumentTypes) {
      expect(brandDocumentTypeLabels[type]).toBeTruthy();
    }
  });
});
