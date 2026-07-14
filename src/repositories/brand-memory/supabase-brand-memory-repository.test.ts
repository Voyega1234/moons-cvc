import { describe, expect, it } from "vitest";
import {
  selectLatestUniqueAdAssets,
  selectLatestUniquePastWorkAssets
} from "./supabase-brand-memory-repository";

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

  it("keeps one latest card per Facebook post and Ads Library creative", () => {
    const assets = [
      {
        id: "post-new",
        source_type: "facebook_post" as const,
        source_item_id: "media-1",
        source_url: "https://facebook.com/post-1"
      },
      {
        id: "post-old",
        source_type: "facebook_post" as const,
        source_item_id: "media-2",
        source_url: "https://facebook.com/post-1"
      },
      {
        id: "ad-new",
        source_type: "facebook_ad" as const,
        source_item_id: "ad-1",
        source_url: "https://facebook.com/ads/ad-1"
      },
      {
        id: "search",
        source_type: "google_search" as const,
        source_item_id: "result-1",
        source_url: "https://example.com"
      }
    ];

    expect(selectLatestUniquePastWorkAssets(assets)).toEqual([
      assets[0],
      assets[2]
    ]);
  });
});
