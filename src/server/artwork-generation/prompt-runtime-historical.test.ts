import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  loadDesignSystem20260723FinalArtworkPrompt,
  loadDesignSystem20260723StrategyPrompt
} from "./prompt-runtime";

describe("23 July 2026 Design System prompt archive", () => {
  it("loads the exact prompt files restored from commit 009c176", async () => {
    const [strategy, finalArtwork] = await Promise.all([
      loadDesignSystem20260723StrategyPrompt(),
      loadDesignSystem20260723FinalArtworkPrompt()
    ]);

    expect(createHash("sha256").update(strategy).digest("hex")).toBe(
      "a06267a14b895c28fa6fcdfc2466e451629d4b04dd0d2d2f655eb6fe3ec05cd8"
    );
    expect(createHash("sha256").update(finalArtwork).digest("hex")).toBe(
      "eefb010df77b5a1b6039e13e6af29e7b423f5414d90edafb6d8507dc082d6313"
    );
  });
});
