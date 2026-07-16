import { describe, expect, it, vi } from "vitest";
import type { ApifyClient } from "./apify-client";
import {
  runClientIngestionJob,
  type BrandMemoryWriter,
  type BrandVisualAnalyzer,
  type ClientIngestionStore,
  type ImageMirror
} from "./client-ingestion-harness";

function createStore(): ClientIngestionStore & {
  jobStatuses: unknown[];
  clientStatuses: unknown[];
  sources: unknown[];
  posts: unknown[];
  ads: unknown[];
  visualAssets: unknown[];
} {
  return {
    jobStatuses: [],
    clientStatuses: [],
    sources: [],
    posts: [],
    ads: [],
    visualAssets: [],
    async updateJobStatus(input) {
      this.jobStatuses.push(input);
    },
    async updateClientStatus(input) {
      this.clientStatuses.push(input);
    },
    async saveBrandSource(input) {
      const source = { ...input, id: `source-${this.sources.length + 1}` };
      this.sources.push(source);
      return source;
    },
    async listManualBrandInputs() {
      return [];
    },
    async saveSocialPosts(input) {
      this.posts.push(...input.posts);
      return input.posts.map((post, index) => ({
        id: `post-${index + 1}`,
        postUrl: post.postUrl
      }));
    },
    async saveAdLibraryItems(input) {
      this.ads.push(...input.ads);
      return input.ads.map((ad, index) => ({
        id: `ad-${index + 1}`,
        adArchiveId: ad.adArchiveId
      }));
    },
    async saveVisualAsset(input) {
      this.visualAssets.push(input);
    }
  };
}

describe("runClientIngestionJob", () => {
  it("collects posts and ads, mirrors image-only assets, and leaves the job ready for analysis", async () => {
    const apify: ApifyClient = {
      scrapeFacebookPosts: vi.fn(async () => [
        {
          url: "https://www.facebook.com/page/posts/1",
          text: "Organic brand post",
          media: [
            {
              id: "video-1",
              thumbnailImage: { uri: "https://cdn.example.com/post-thumb.jpg" },
              browser_native_hd_url: "https://cdn.example.com/post-video.mp4"
            }
          ]
        }
      ]),
      scrapeFacebookAdsLibrary: vi.fn(async () => [
        {
          ad_archive_id: "ad-1",
          ad_library_url: "https://www.facebook.com/ads/library/?id=ad-1",
          snapshot: {
            body: { text: "Paid ad body" },
            videos: [
              {
                video_preview_image_url:
                  "https://cdn.example.com/ad-preview.jpg",
                video_hd_url: "https://cdn.example.com/ad-video.mp4"
              }
            ]
          }
        }
      ])
    };
    const store = createStore();
    const imageMirror: ImageMirror = {
      async mirror(input) {
        return {
          assetBucket: "brand-source-assets",
          assetStoragePath: `${input.clientId}/${input.jobId}/${input.index}.jpg`,
          assetUrl: `https://storage.example.com/${input.index}.jpg`,
          originalUrlHash: `hash-${input.index}`
        };
      }
    };

    const result = await runClientIngestionJob(
      { id: "job-1", clientId: "client-1" },
      {
        id: "client-1",
        name: "Client One",
        facebookUrl: "https://www.facebook.com/client"
      },
      { apify, store, imageMirror }
    );

    expect(result).toEqual({
      postsSaved: 1,
      adsSaved: 1,
      visualAssetsMirrored: 2,
      usedFallbackSearch: false,
      completed: false
    });
    expect(store.sources).toHaveLength(2);
    expect(store.posts).toHaveLength(1);
    expect(store.ads).toHaveLength(1);
    expect(store.visualAssets).toHaveLength(2);
    expect(JSON.stringify(store.visualAssets)).not.toContain(".mp4");
    expect(store.clientStatuses.at(-1)).toMatchObject({
      clientId: "client-1",
      status: "needs_review"
    });
  });

  it("marks the client failed with a Facebook access message when both Facebook sources fail and no fallback exists", async () => {
    const apify: ApifyClient = {
      scrapeFacebookPosts: vi.fn(async () => {
        throw new Error("Posts unavailable");
      }),
      scrapeFacebookAdsLibrary: vi.fn(async () => {
        throw new Error("Ads unavailable");
      })
    };
    const store = createStore();
    const imageMirror: ImageMirror = {
      mirror: vi.fn()
    };

    const result = await runClientIngestionJob(
      { id: "job-1", clientId: "client-1" },
      {
        id: "client-1",
        name: "Client One",
        facebookUrl: "https://www.facebook.com/client"
      },
      { apify, store, imageMirror }
    );

    expect(result.visualAssetsMirrored).toBe(0);
    expect(store.sources).toHaveLength(2);
    expect(store.clientStatuses.at(-1)).toMatchObject({
      clientId: "client-1",
      status: "failed",
      errorMessage: "Please check Facebook page URL."
    });
  });

  it("notifies about the Facebook URL instead of using fallback for actor access errors", async () => {
    const apify: ApifyClient = {
      scrapeFacebookPosts: vi.fn(async () => [
        {
          url: "https://www.facebook.com/unavailable-page",
          error: "not_available",
          errorDescription: "This content is not available."
        }
      ]),
      scrapeFacebookAdsLibrary: vi.fn(async () => [
        {
          url: "https://www.facebook.com/unavailable-page",
          error: "Page is private",
          errorCode: "PAGE_PRIVATE"
        }
      ])
    };
    const store = createStore();
    const searchFallback = {
      search: vi.fn(async () => ({ results: [] }))
    };

    const result = await runClientIngestionJob(
      { id: "job-1", clientId: "client-1" },
      {
        id: "client-1",
        name: "Client One",
        facebookUrl: "https://www.facebook.com/unavailable-page"
      },
      {
        apify,
        store,
        imageMirror: { mirror: vi.fn() },
        searchFallback
      }
    );

    expect(result).toEqual({
      postsSaved: 0,
      adsSaved: 0,
      visualAssetsMirrored: 0,
      usedFallbackSearch: false,
      completed: false
    });
    expect(searchFallback.search).not.toHaveBeenCalled();
    expect(store.posts).toEqual([]);
    expect(store.ads).toEqual([]);
    expect(store.sources).toEqual([
      expect.objectContaining({ status: "failed" }),
      expect.objectContaining({ status: "failed" })
    ]);
    expect(store.clientStatuses.at(-1)).toMatchObject({
      status: "failed",
      errorMessage: "Please check Facebook page URL."
    });
  });

  it("analyzes mirrored images, writes Brand Memory, and marks the client ready", async () => {
    const apify: ApifyClient = {
      scrapeFacebookPosts: vi.fn(async () => [
        {
          url: "https://www.facebook.com/page/posts/1",
          text: "Soft floral styling",
          media: [
            {
              image: { uri: "https://cdn.example.com/post.jpg" }
            }
          ]
        }
      ]),
      scrapeFacebookAdsLibrary: vi.fn(async () => [])
    };
    const store = createStore();
    store.listManualBrandInputs = vi.fn(async () => [
      {
        sourceId: "questionnaire-1",
        sourceUrl: "https://portal.example.com",
        text: "Brand Name: Client One. Brand description: First-party detail."
      }
    ]);
    const imageMirror: ImageMirror = {
      async mirror(input) {
        return {
          assetBucket: "brand-source-assets",
          assetStoragePath: `${input.clientId}/${input.jobId}/${input.index}.jpg`,
          assetUrl: `https://storage.example.com/${input.index}.jpg`,
          originalUrlHash: `hash-${input.index}`
        };
      }
    };
    const visualAnalyzer: BrandVisualAnalyzer = {
      analyze: vi.fn(
        async (input: Parameters<BrandVisualAnalyzer["analyze"]>[0]) => ({
        brandKitEntries: [
          {
            title: "Visual mood",
            description: "Fresh, soft, feminine"
          }
        ],
        learning: [
          {
            polarity: "working" as const,
            note: "Use soft natural light with close product detail."
          }
        ],
        products: [
          {
            name: "ช่อดอกไม้",
            description: "ช่อดอกไม้สดสำหรับเป็นของขวัญ",
            offer: "จัดส่งตามวันนัดหมาย",
            keyBenefit: "มอบเป็นของขวัญได้สะดวก",
            audience: "ผู้ซื้อของขวัญ",
            claimNotes: "ตรวจสอบพื้นที่และเวลาจัดส่งก่อนใช้"
          }
        ],
        visualGuidance: {
          mood: ["fresh", "soft"],
          colorPalette: ["cream", "green"],
          layoutPatterns: ["centered product"],
          textOverlay: ["minimal"],
          typographyFeel: ["clean"],
          productPersonEnvironment: ["product with flowers"],
          dos: ["keep natural light"],
          donts: ["avoid harsh contrast"],
          sourceAssetPaths: input.visualAssets.map(
            (asset) => asset.assetStoragePath
          )
        },
        needsReview: false
        })
      )
    };
    const brandMemoryWriter: BrandMemoryWriter = {
      write: vi.fn(async () => undefined)
    };

    const result = await runClientIngestionJob(
      { id: "job-1", clientId: "client-1" },
      {
        id: "client-1",
        name: "Client One",
        facebookUrl: "https://www.facebook.com/client"
      },
      { apify, store, imageMirror, visualAnalyzer, brandMemoryWriter }
    );

    expect(result).toEqual({
      postsSaved: 1,
      adsSaved: 0,
      visualAssetsMirrored: 1,
      usedFallbackSearch: false,
      completed: true
    });
    expect(visualAnalyzer.analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        client: expect.objectContaining({ id: "client-1" }),
        textEvidence: expect.arrayContaining([
          expect.objectContaining({
            sourceType: "manual_input",
            sourceId: "questionnaire-1"
          })
        ]),
        sourceSummary: expect.objectContaining({ manualInputsSaved: 1 }),
        visualAssets: [
          expect.objectContaining({
            assetStoragePath: "client-1/job-1/0.jpg",
            sourceType: "facebook_post"
          })
        ]
      })
    );
    expect(brandMemoryWriter.write).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-1",
        jobId: "job-1",
        analysis: expect.objectContaining({
          visualGuidance: expect.objectContaining({
            sourceAssetPaths: ["client-1/job-1/0.jpg"]
          })
        })
      })
    );
    expect(store.clientStatuses.at(-1)).toMatchObject({
      clientId: "client-1",
      status: "ready"
    });
  });

  it("marks the client failed when visual analysis fails after image mirroring", async () => {
    const apify: ApifyClient = {
      scrapeFacebookPosts: vi.fn(async () => [
        {
          url: "https://www.facebook.com/page/posts/1",
          text: "Post with image",
          media: [
            {
              image: { uri: "https://cdn.example.com/post.jpg" }
            }
          ]
        }
      ]),
      scrapeFacebookAdsLibrary: vi.fn(async () => [])
    };
    const store = createStore();
    const imageMirror: ImageMirror = {
      async mirror(input) {
        return {
          assetBucket: "brand-source-assets",
          assetStoragePath: `${input.clientId}/${input.jobId}/${input.index}.jpg`,
          assetUrl: `https://storage.example.com/${input.index}.jpg`,
          originalUrlHash: `hash-${input.index}`
        };
      }
    };
    const visualAnalyzer: BrandVisualAnalyzer = {
      analyze: vi.fn(async () => {
        throw new Error("Vision model unavailable");
      })
    };
    const brandMemoryWriter: BrandMemoryWriter = {
      write: vi.fn(async () => undefined)
    };

    const result = await runClientIngestionJob(
      { id: "job-1", clientId: "client-1" },
      {
        id: "client-1",
        name: "Client One",
        facebookUrl: "https://www.facebook.com/client"
      },
      { apify, store, imageMirror, visualAnalyzer, brandMemoryWriter }
    );

    expect(result).toMatchObject({
      visualAssetsMirrored: 1,
      completed: false
    });
    expect(brandMemoryWriter.write).not.toHaveBeenCalled();
    expect(store.clientStatuses.at(-1)).toMatchObject({
      clientId: "client-1",
      status: "failed",
      errorMessage: "Vision model unavailable"
    });
  });

  it("skips an unavailable image and continues mirroring the remaining evidence", async () => {
    const apify: ApifyClient = {
      scrapeFacebookPosts: vi.fn(async () => [
        {
          url: "https://www.facebook.com/page/posts/1",
          text: "Post with two images",
          media: [
            { image: { uri: "https://cdn.example.com/broken.jpg" } },
            { image: { uri: "https://cdn.example.com/working.jpg" } }
          ]
        }
      ]),
      scrapeFacebookAdsLibrary: vi.fn(async () => [])
    };
    const store = createStore();
    const imageMirror: ImageMirror = {
      async mirror(input) {
        if (input.imageUrl.includes("broken")) {
          throw new Error("Image unavailable");
        }
        return {
          assetBucket: "brand-source-assets",
          assetStoragePath: `${input.clientId}/${input.index}.jpg`,
          assetUrl: `https://storage.example.com/${input.index}.jpg`,
          originalUrlHash: `hash-${input.index}`
        };
      }
    };

    const result = await runClientIngestionJob(
      { id: "job-1", clientId: "client-1" },
      {
        id: "client-1",
        name: "Client One",
        facebookUrl: "https://www.facebook.com/client"
      },
      { apify, store, imageMirror }
    );

    expect(result.visualAssetsMirrored).toBe(1);
    expect(store.visualAssets).toHaveLength(1);
    expect(store.clientStatuses.at(-1)).toMatchObject({
      status: "needs_review"
    });
  });

  it("marks the job failed when mirrored asset persistence fails", async () => {
    const apify: ApifyClient = {
      scrapeFacebookPosts: vi.fn(async () => [
        {
          url: "https://www.facebook.com/page/posts/1",
          text: "Post with image",
          media: [{ image: { uri: "https://cdn.example.com/image.jpg" } }]
        }
      ]),
      scrapeFacebookAdsLibrary: vi.fn(async () => [])
    };
    const store = createStore();
    store.saveVisualAsset = vi.fn(async () => {
      throw new Error("Could not save mirrored image");
    });

    const result = await runClientIngestionJob(
      { id: "job-1", clientId: "client-1" },
      {
        id: "client-1",
        name: "Client One",
        facebookUrl: "https://www.facebook.com/client"
      },
      {
        apify,
        store,
        imageMirror: {
          async mirror(input) {
            return {
              assetBucket: "brand-source-assets",
              assetStoragePath: `${input.clientId}/image.jpg`,
              assetUrl: "https://storage.example.com/image.jpg",
              originalUrlHash: "hash"
            };
          }
        }
      }
    );

    expect(result.visualAssetsMirrored).toBe(0);
    expect(store.clientStatuses.at(-1)).toMatchObject({
      status: "failed",
      errorMessage: "Could not save mirrored image"
    });
  });
});
