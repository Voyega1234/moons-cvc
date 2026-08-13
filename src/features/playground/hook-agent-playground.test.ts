import { describe, expect, it } from "vitest";
import { brands } from "../../data/mock-brands";
import type { HookResearchDossier } from "../../server/hook-generation/hook-research-agent";
import {
  PLAYGROUND_MODEL_LIMIT,
  buildPlaygroundModelRequest,
  buildPlaygroundRequest,
  buildPromptDiff,
  filterPlaygroundBrands,
  filterSystemBrands,
  getDefaultPlaygroundBrand,
  isValidOpenRouterModelId
} from "./hook-agent-playground";

describe("Playground model selection", () => {
  it("allows up to five compared models", () => {
    expect(PLAYGROUND_MODEL_LIMIT).toBe(5);
  });
});

describe("buildPlaygroundRequest", () => {
  it("includes only the brand inputs selected for the experiment", () => {
    const brand = brands[0]!;
    const selectedItem = brand.library.brand[0]!;
    const request = buildPlaygroundRequest({
      brand,
      selectedBrandItemIds: new Set([selectedItem.id]),
      includeQuestionnaire: false,
      includeBrief: true,
      brief: "  Launch the workday bundle  ",
      service: "single-static",
      quantity: 3,
      prompt: "Test prompt",
      generationModel: "google/gemini-3.6-flash"
    });

    expect(request.onboardingQuestionnaire).toBe("");
    expect(request.brief).toBe("Launch the workday bundle");
    expect(request.brandLibrary.brand).toEqual([
      {
        title: selectedItem.title,
        description: selectedItem.description
      }
    ]);
    expect(request.brandLibrary.products).toEqual([]);
    expect(request.agentHookPrompt).toBe("Test prompt");
  });
});

describe("buildPlaygroundModelRequest", () => {
  it("only sends the shared dossier when sharing is enabled", () => {
    const request = { brief: "Campaign brief" };
    const dossier = {
      summary: "Shared finding",
      references: [],
      insights: [],
      gaps: []
    } as HookResearchDossier;

    expect(
      buildPlaygroundModelRequest({
        request,
        runId: "run-shared",
        model: "sakana/sakana-namazu",
        researchDossier: dossier
      })
    ).toMatchObject({ researchDossier: dossier });
    expect(
      buildPlaygroundModelRequest({
        request,
        runId: "run-independent",
        model: "sakana/sakana-namazu",
        researchDossier: null
      })
    ).not.toHaveProperty("researchDossier");
  });
});

describe("filterPlaygroundBrands", () => {
  it("searches by brand name and category", () => {
    expect(
      filterPlaygroundBrands(brands, "jim").map((brand) => brand.id)
    ).toEqual(["jim"]);
    expect(
      filterPlaygroundBrands(brands, "automotive").map((brand) => brand.id)
    ).toEqual(["aklass"]);
  });
});

describe("filterSystemBrands", () => {
  it("hides mapping-only brands that do not exist in the system", () => {
    const mappingOnlyBrand = {
      ...brands[0]!,
      id: "mapping-only",
      existsInSystem: false
    };

    expect(
      filterSystemBrands([mappingOnlyBrand, brands[1]!]).map((brand) => brand.id)
    ).toEqual([brands[1]!.id]);
  });
});

describe("getDefaultPlaygroundBrand", () => {
  it("prefers Convert Cake Ads over Convert Cake", () => {
    const convertCake = {
      ...brands[1]!,
      id: "convert-cake",
      name: "ConvertCake"
    };
    const convertCakeAds = {
      ...brands[2]!,
      id: "convert-cake-ads",
      name: "Convert Cake Ads"
    };

    expect(
      getDefaultPlaygroundBrand([brands[0]!, convertCake, convertCakeAds])
    ).toBe(convertCakeAds);
  });

  it("falls back to Convert Cake when the Ads brand is unavailable", () => {
    const convertCake = {
      ...brands[1]!,
      id: "convert-cake",
      name: "ConvertCake"
    };

    expect(getDefaultPlaygroundBrand([brands[0]!, convertCake])).toBe(convertCake);
  });

  it("falls back to the first available brand", () => {
    expect(getDefaultPlaygroundBrand(brands)).toBe(brands[0]);
  });
});

describe("isValidOpenRouterModelId", () => {
  it("accepts provider/model tags and rejects internal model names", () => {
    expect(isValidOpenRouterModelId("sakana/sakana-namazu")).toBe(true);
    expect(isValidOpenRouterModelId("openai/gpt-5.6-terra:free")).toBe(true);
    expect(isValidOpenRouterModelId("n8n-compass-new")).toBe(false);
  });
});

describe("buildPromptDiff", () => {
  it("keeps line order while marking additions and removals", () => {
    expect(buildPromptDiff("one\ntwo\nthree", "one\nnew\nthree")).toEqual([
      { type: "same", text: "one" },
      { type: "removed", text: "two" },
      { type: "added", text: "new" },
      { type: "same", text: "three" }
    ]);
  });
});
