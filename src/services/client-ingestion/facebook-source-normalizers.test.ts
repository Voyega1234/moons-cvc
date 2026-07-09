import { describe, expect, it } from "vitest";
import {
  getBestPostImageUrl,
  normalizeFacebookAdsLibraryItems,
  normalizeFacebookPosts
} from "./facebook-source-normalizers";

describe("facebook source normalizers", () => {
  it("normalizes Facebook posts with image-only visual candidates", () => {
    const posts = normalizeFacebookPosts([
      {
        url: "https://www.facebook.com/reel/1004684475751564/",
        text: "ให้ธรรมชาติโอบล้อมตัวคุณ",
        likes: 19,
        shares: 2,
        media: [
          {
            __typename: "Video",
            id: "1004684475751564",
            thumbnailImage: {
              uri: "https://cdn.example.com/video-thumb.jpg"
            },
            browser_native_hd_url: "https://cdn.example.com/video.mp4"
          }
        ]
      },
      {
        url: "https://www.facebook.com/example/posts/1",
        text: "Carousel post",
        media: [
          {
            mediaset_token: "pcb.1"
          },
          {
            __typename: "Photo",
            id: "photo-1",
            image: { uri: "https://cdn.example.com/photo.jpg" },
            ocrText: "May be an image of text"
          }
        ]
      }
    ]);

    expect(posts).toHaveLength(2);
    expect(posts[0]?.imageCount).toBe(1);
    expect(posts[0]?.visualAssets[0]?.originalImageUrl).toBe(
      "https://cdn.example.com/video-thumb.jpg"
    );
    expect(JSON.stringify(posts[0]?.visualAssets)).not.toContain("video.mp4");
    expect(posts[1]?.visualAssets[0]?.ocrText).toBe(
      "May be an image of text"
    );
  });

  it("normalizes Ads Library items using images and video preview images only", () => {
    const ads = normalizeFacebookAdsLibraryItems([
      {
        ad_archive_id: "1332905778811947",
        page_id: "113047648476907",
        page_name: "Meisaku Premium Yakiniku",
        is_active: true,
        start_date: 1782716400,
        end_date: 1783062000,
        publisher_platform: ["FACEBOOK", "INSTAGRAM"],
        ad_library_url:
          "https://www.facebook.com/ads/library/?id=1332905778811947",
        snapshot: {
          body: {
            text: "บุฟเฟต์ Yakiniku เนื้อ A5 ที่ทำถึงที่สุดในปี 2025✨"
          },
          cta_text: "Visit Instagram profile",
          cta_type: "VIEW_INSTAGRAM_PROFILE",
          display_format: "MULTI_VIDEOS",
          link_url: "http://instagram.com/meisaku.yakiniku",
          images: [
            {
              original_image_url: "https://cdn.example.com/ad-image.jpg"
            }
          ],
          videos: [
            {
              video_preview_image_url:
                "https://cdn.example.com/ad-video-preview.jpg",
              video_hd_url: "https://cdn.example.com/ad-video.mp4"
            }
          ]
        }
      }
    ]);

    expect(ads).toHaveLength(1);
    expect(ads[0]?.bodyText).toContain("Yakiniku");
    expect(ads[0]?.imageCount).toBe(2);
    expect(ads[0]?.visualAssets.map((asset) => asset.originalImageUrl)).toEqual(
      [
        "https://cdn.example.com/ad-image.jpg",
        "https://cdn.example.com/ad-video-preview.jpg"
      ]
    );
    expect(JSON.stringify(ads[0]?.visualAssets)).not.toContain("ad-video.mp4");
  });

  it("chooses the best available post image path", () => {
    expect(getBestPostImageUrl({ image: { uri: "image" } })).toBe("image");
    expect(
      getBestPostImageUrl({
        preferred_thumbnail: { image: { uri: "preferred" } }
      })
    ).toBe("preferred");
    expect(getBestPostImageUrl({ thumbnailImage: { uri: "thumb" } })).toBe(
      "thumb"
    );
    expect(getBestPostImageUrl({ thumbnail: "fallback" })).toBe("fallback");
  });
});
