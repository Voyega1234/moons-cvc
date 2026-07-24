import { describe, expect, it } from "vitest";
import {
  ARTWORK_REFERENCE_BUCKET,
  artworkReferencePatterns,
  selectArtworkReferencePattern,
  selectArtworkReferencePatterns
} from "./artwork-reference-library";

const hook = {
  hook: "A clear campaign headline",
  concept: "A focused commercial idea",
  visual: "One production-ready key visual"
};

describe("artwork reference library", () => {
  it("uses all 72 inspected artworks as stable private objects", () => {
    expect(ARTWORK_REFERENCE_BUCKET).toBe("artwork-reference-library");
    expect(artworkReferencePatterns).toHaveLength(72);
    expect(
      artworkReferencePatterns.every((pattern) =>
        pattern.storagePath.startsWith("artworks/")
      )
    ).toBe(true);
    expect(new Set(artworkReferencePatterns.map((pattern) => pattern.id)).size).toBe(
      72
    );
    expect(
      new Set(artworkReferencePatterns.map((pattern) => pattern.sourceFile)).size
    ).toBe(72);
  });

  it("selects a compatible beauty artwork from the full catalog", () => {
    const selected = selectArtworkReferencePattern({
      brandCategory: "Beauty clinic",
      service: "single-static",
      canvasRatio: "1:1",
      brief: "Promote a radiant skin treatment offer.",
      hook
    });

    expect(selected.canvasRatio).toBe("1:1");
    expect(selected.mode).toBe("standard_commercial");
    expect(selected.searchText).toMatch(/beauty|clinic|skin/i);
  });

  it("does not force a combined-grid reference for standalone album images", () => {
    const albumSelected = selectArtworkReferencePattern({
      service: "album-post",
      canvasRatio: "1:1",
      brief: "Launch a focused commercial campaign.",
      hook
    });
    const staticSelected = selectArtworkReferencePattern({
      service: "single-static",
      canvasRatio: "1:1",
      brief: "Launch a focused commercial campaign.",
      hook
    });

    expect(albumSelected.id).toBe(staticSelected.id);
  });

  it("matches short AI only as a complete term", () => {
    const selected = selectArtworkReferencePattern({
      brandCategory: "Retail",
      service: "single-static",
      canvasRatio: "1:1",
      brief: "A warm retail campaign for a neighborhood store.",
      hook
    });

    expect(selected.mode).not.toBe("tech_b2b");
  });

  it("prioritizes same-client history when the runtime brand is known", () => {
    const selected = selectArtworkReferencePattern({
      brandName: "CVC",
      brandCategory: "Marketing agency",
      service: "single-static",
      canvasRatio: "4:5",
      brief: "Explain a performance marketing strategy.",
      hook
    });

    expect(selected.client).toBe("CVC");
  });

  it("uses Luna style intent before generic category keywords", () => {
    const selected = selectArtworkReferencePattern({
      brandCategory: "Marketing technology",
      service: "single-static",
      canvasRatio: "1:1",
      brief: "Launch a verified limited offer.",
      hook,
      strategy: {
        commercialStyle: "promotion",
        sellingMechanism: "offer",
        preferredMode: "fmcg_energy",
        preferredLayout: "marketplace_promo",
        preferredHeroType: "product_group",
        referenceSearchText: "dense retail offer price hierarchy product group"
      }
    });

    expect(selected.layoutArchetype).toBe("marketplace_promo");
    expect(selected.mode).toBe("fmcg_energy");
  });

  it("selects two distinct and compatible artwork references", () => {
    const selected = selectArtworkReferencePatterns({
      brandName: "CVC",
      brandCategory: "Marketing agency",
      service: "single-static",
      canvasRatio: "4:5",
      brief: "Show why advertising spend is not producing sales.",
      hook
    });

    expect(selected).toHaveLength(2);
    expect(new Set(selected.map((pattern) => pattern.id)).size).toBe(2);
    expect(selected[1]?.canvasRatio).toBe(selected[0]?.canvasRatio);
  });
});
