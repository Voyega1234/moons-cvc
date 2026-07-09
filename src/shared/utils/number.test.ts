import { describe, expect, it } from "vitest";
import { clamp } from "./number";

describe("clamp", () => {
  it("keeps values inside the configured limits", () => {
    expect(clamp(0, 1, 6)).toBe(1);
    expect(clamp(3, 1, 6)).toBe(3);
    expect(clamp(8, 1, 6)).toBe(6);
  });
});
