import { describe, expect, it } from "vitest";
import { geminiApiProvider, openRouterGeminiModel } from "./gemini-api-provider";

describe("central Gemini provider", () => {
  it("defaults to OpenRouter and switches with one setting", () => {
    expect(geminiApiProvider({})).toBe("openrouter");
    expect(geminiApiProvider({ GEMINI_API_PROVIDER: "openrouter" })).toBe("openrouter");
    expect(geminiApiProvider({ GEMINI_API_PROVIDER: "gemini" })).toBe("gemini");
    expect(() => geminiApiProvider({ GEMINI_API_PROVIDER: "typo" })).toThrow("GEMINI_API_PROVIDER");
  });
  it("qualifies model IDs without adding duplicate prefixes", () => {
    expect(openRouterGeminiModel("gemini-3.8-flash")).toBe("google/gemini-3.8-flash");
    expect(openRouterGeminiModel("google/gemini-4-hydrogen")).toBe("google/gemini-4-hydrogen");
  });
});
