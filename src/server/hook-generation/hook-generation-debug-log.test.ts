import { describe, expect, it } from "vitest";
import {
  hookGenerationDebugLogDirectory,
  LOCAL_HOOK_GENERATION_DEBUG_LOG_DIR
} from "./hook-generation-debug-log";

describe("hookGenerationDebugLogDirectory", () => {
  it("enables Hook logs locally but disables them on Vercel deployments", () => {
    expect(hookGenerationDebugLogDirectory(undefined)).toBe(
      LOCAL_HOOK_GENERATION_DEBUG_LOG_DIR
    );
    expect(hookGenerationDebugLogDirectory("development")).toBe(
      LOCAL_HOOK_GENERATION_DEBUG_LOG_DIR
    );
    expect(hookGenerationDebugLogDirectory("preview")).toBeUndefined();
    expect(hookGenerationDebugLogDirectory("production")).toBeUndefined();
  });
});
