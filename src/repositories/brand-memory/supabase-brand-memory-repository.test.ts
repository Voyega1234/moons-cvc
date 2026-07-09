import { describe, expect, it } from "vitest";
import { selectLatestUniqueAdAssets } from "./supabase-brand-memory-repository";

describe("selectLatestUniqueAdAssets", () => {
  it("keeps the newest asset per ad and applies the card limit", () => {
    const assets = [
      { id: "new-ad-1", source_item_id: "ad-1" },
      { id: "old-ad-1", source_item_id: "ad-1" },
      { id: "ad-2", source_item_id: "ad-2" },
      { id: "missing", source_item_id: null }
    ];

    expect(selectLatestUniqueAdAssets(assets, 2)).toEqual([
      { id: "new-ad-1", source_item_id: "ad-1" },
      { id: "ad-2", source_item_id: "ad-2" }
    ]);
  });
});
