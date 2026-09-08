import { describe, expect, it } from "vitest";
import { normalizeCreativeDirections } from "./hook-generation-types";
import type { RawDirection } from "./hook-generation-types";

function baseUgcDirection(overrides: Partial<RawDirection> = {}): RawDirection {
  return {
    id: "dir-ugc-01",
    service: "ugc-video",
    hook: "Hook text",
    concept: "Concept text",
    why: "Why text",
    visual: "",
    cta: "CTA text",
    caption: "Caption text",
    formatBeats: ["Beat 1", "Beat 2", "Beat 3", "Beat 4"],
    ...overrides
  };
}

describe("normalizeCreativeDirections ugcBrief handling", () => {
  it("keeps a real 5-scene ugcBrief instead of substituting the 4-scene fallback", () => {
    const scene = (title: string, script: string) => ({
      title,
      duration: "00:00-00:06",
      scriptLines: [script],
      highlightedPhrase: script.slice(0, 5),
      visual: `visual for ${title}`,
      textOverlay: script
    });
    const raw = baseUgcDirection({
      ugcBrief: {
        product: "Test brand",
        duration: "40 วินาที",
        objective: "Objective",
        moodAndTone: "Playful",
        productionStyle: "Handheld",
        referenceDirection: "Native social",
        topic: "Topic text",
        persona: "Persona text",
        dresscode: "Dresscode text",
        doGuidelines: ["Do one", "Do two"],
        dontGuidelines: ["Dont one", "Dont two"],
        referenceVideoUrl: "https://example.com/ref.mp4",
        scenes: [
          scene("Hook", "line one"),
          scene("Tension", "line two"),
          scene("Turn", "line three"),
          scene("Proof", "line four"),
          scene("CTA", "line five")
        ]
      }
    });

    const [direction] = normalizeCreativeDirections([raw]);
    const brief = direction!.ugcBrief!;

    expect(brief.scenes).toHaveLength(5);
    expect(brief.scenes.map((s) => s.title)).toEqual([
      "Hook",
      "Tension",
      "Turn",
      "Proof",
      "CTA"
    ]);
    expect(brief.scenes[0]!.visual).toBe("visual for Hook");
    expect(brief.scenes[0]!.highlightedPhrase).toBe("line");
    expect(brief.persona).toBe("Persona text");
    expect(brief.dresscode).toBe("Dresscode text");
    expect(brief.topic).toBe("Topic text");
    expect(brief.doGuidelines).toEqual(["Do one", "Do two"]);
    expect(brief.dontGuidelines).toEqual(["Dont one", "Dont two"]);
    expect(brief.referenceVideoUrl).toBe("https://example.com/ref.mp4");
  });

  it("falls back to a 4-scene generic brief when no ugcBrief is present", () => {
    const raw = baseUgcDirection({ ugcBrief: undefined });

    const [direction] = normalizeCreativeDirections([raw]);
    const brief = direction!.ugcBrief!;

    expect(brief.scenes).toHaveLength(4);
    expect(brief.persona).toBeUndefined();
  });
});
