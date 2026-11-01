import { describe, expect, it } from "vitest";
import { parseRequestBody, parseRevisionRequestBody } from "./artwork-request-parser";

describe("Album revision sources", () => {
  const request = {
    requestType: "artwork-revision", model: "gpt-image-2.5-sunburst", clientId: "brand", runId: "run",
    outputId: "a", directionId: "idea", format: "Album post", instructions: "Edit the title",
    sourceImageUrl: "https://example.com/master.png", output: { size: "1024x1024", format: "png" },
    album: { format: "three-horizontal", outputIds: ["a", "b", "c"] }
  };
  it("preserves panel URLs in output order", () => {
    const sourceImageUrls = ["a", "b", "c"].map(id => `https://example.com/${id}.png`);
    expect(parseRevisionRequestBody({ ...request, album: { ...request.album, sourceImageUrls } }).album?.sourceImageUrls).toEqual(sourceImageUrls);
  });
  it.each([
    { sourceImageUrls: [] },
    { sourceImageUrls: ["https://example.com/a.png"] },
    { sourceImageUrls: ["https://example.com/a", "file:///tmp/a", "https://example.com/c"] }
  ])("rejects incomplete or invalid panel sources", ({ sourceImageUrls }) => {
    expect(() => parseRevisionRequestBody({ ...request, album: { ...request.album, sourceImageUrls } })).toThrow("sourceImageUrls");
  });
  it("accepts a legacy request without panel URLs", () => {
    expect(parseRevisionRequestBody(request).album?.sourceImageUrls).toBeUndefined();
  });
  it("preserves an explicit panel selection and keeps legacy all-panel requests compatible", () => {
    expect(parseRevisionRequestBody({ ...request, album: { ...request.album, selectedOutputIds: ["b"] } }).album?.selectedOutputIds).toEqual(["b"]);
    expect(parseRevisionRequestBody(request).album?.selectedOutputIds).toBeUndefined();
  });
  it.each([[], ["missing"], ["a", "a"], [42], "a"])("rejects an invalid panel selection: %j", (selectedOutputIds) => {
    expect(() => parseRevisionRequestBody({ ...request, album: { ...request.album, selectedOutputIds } })).toThrow("album.selectedOutputIds");
  });
});

describe("parseRequestBody", () => {
  it("rejects persisted Visual guidance from artwork agent input", () => {
    const parsed = parseRequestBody({
      model: "gpt-image-2.5-sunburst",
      artworkMode: "standard",
      imagePromptModel: "gpt-5.6-terra",
      runId: "run-1",
      brand: null,
      service: "single-static",
      quantity: 1,
      brief: "Campaign brief",
      selectedHooks: [
        {
          id: "hook-1",
          hook: "Hook",
          concept: "Concept",
          why: "Why",
          visual: "Visual",
          cta: "CTA",
          caption: "Caption"
        }
      ],
      textInputs: [],
      referenceImages: [],
      brandLibrary: {
        brand: [
          { title: "Brand Details", description: "Active context" },
          { title: "Visual guidance", description: "Legacy visual analysis" }
        ],
        products: [],
        docs: [],
        refs: []
      },
      output: { size: "1024x1024", format: "png" }
    });

    expect(parsed.brandLibrary.brand).toEqual([
      { title: "Brand Details", description: "Active context" }
    ]);
  });
});
