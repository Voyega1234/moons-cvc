import { describe, expect, it } from "vitest";
import {
  hasUsablePastWorkPost,
  resolvePastWorkSignedUrls,
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

  it("keeps loading past work when one stored image cannot be signed", async () => {
    const assets = [{ id: "good" }, { id: "missing" }];
    const urls = await resolvePastWorkSignedUrls(assets, async (asset) => {
      if (asset.id === "missing") throw new Error("Object not found");
      return "https://example.com/good.jpg";
    });

    expect(urls).toEqual(
      new Map([
        ["good", "https://example.com/good.jpg"],
        ["missing", null]
      ])
    );
  });

  it("hides historical empty Facebook error rows unless they have an image", () => {
    expect(hasUsablePastWorkPost({ text: "" }, false)).toBe(false);
    expect(hasUsablePastWorkPost({ text: "A real post" }, false)).toBe(true);
    expect(hasUsablePastWorkPost({ text: "" }, true)).toBe(true);
  });
});
