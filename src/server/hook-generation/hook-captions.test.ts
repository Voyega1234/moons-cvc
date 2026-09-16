import { describe, it, expect } from "vitest";
import { mergeHookCaptions } from "./hook-captions";

describe("mergeHookCaptions", () => {
  const ideas = [{ id: "a", hook: "Keep this headline", caption: "" }, { id: "b", hook: "Second", caption: "" }];
  it("matches by id and preserves the selected ideas", () => {
    expect(mergeHookCaptions(ideas, { captions: [{ id: "b", caption: "B" }, { id: "a", caption: "A", hook: "Overwrite" }] }))
      .toEqual([{ ...ideas[0], caption: "A" }, { ...ideas[1], caption: "B" }]);
  });
  it.each([
    null,
    { captions: [{ id: "a", caption: "A" }] },
    { captions: [{ id: "a", caption: "A" }, { id: "a", caption: "B" }] },
    { captions: [{ id: "a", caption: "A" }, { id: "x", caption: "B" }] },
    { captions: [{ id: "a", caption: "A" }, { id: "b", caption: " " }] }
  ])("rejects incomplete or mismatched captions", (value) => {
    expect(() => mergeHookCaptions(ideas, value)).toThrow();
  });
});
