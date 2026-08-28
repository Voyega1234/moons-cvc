import { describe, expect, it } from "vitest";
import {
  activeBrandKitItems,
  isActiveBrandKitItem,
  isBrandPolicyItem
} from "./brand";

describe("active Brand Kit items", () => {
  it("keeps Visual guidance persisted but marks it inactive", () => {
    const items = [
      { title: "Brand Details", description: "Finance for Isuzu owners" },
      { title: " Visual Guidance: ", description: "Legacy visual analysis" }
    ];

    expect(isActiveBrandKitItem(items[1]!)).toBe(false);
    expect(activeBrandKitItems(items)).toEqual([items[0]]);
  });

  it("recognizes Brand System policy headings", () => {
    expect(isBrandPolicyItem({ title: "Policy (Strictly apply)" })).toBe(true);
    expect(isBrandPolicyItem({ title: "Advertising Policy" })).toBe(true);
    expect(isBrandPolicyItem({ title: "Brand Details" })).toBe(false);
  });
});
