import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/database.types";
import {
  SupabaseClientIngestionStore,
  shouldReplaceClientCategory,
  toJson
} from "./supabase-client-ingestion-store";

interface Operation {
  table: string;
  action: string;
  payload: unknown;
  options?: unknown;
  filters?: readonly [string, unknown][];
}

class QueryBuilder {
  filters: [string, unknown][] = [];
  data: unknown = null;
  error = null;

  constructor(
    private readonly table: string,
    private readonly operations: Operation[],
    seed: Record<string, unknown>
  ) {
    this.data = seed[table] ?? null;
  }

  update(payload: unknown) {
    this.operations.push({
      table: this.table,
      action: "update",
      payload,
      filters: this.filters
    });
    return this;
  }

  insert(payload: unknown) {
    this.operations.push({
      table: this.table,
      action: "insert",
      payload,
      filters: this.filters
    });
    this.data = { id: `${this.table}-id` };
    return this;
  }

  upsert(payload: unknown, options?: unknown) {
    this.operations.push({
      table: this.table,
      action: "upsert",
      payload,
      options,
      filters: this.filters
    });
    this.data = Array.isArray(payload)
      ? payload.map((row, index) => ({
          id: `${this.table}-${index + 1}`,
          post_url: readRecordValue(row, "post_url"),
          ad_archive_id: readRecordValue(row, "ad_archive_id")
        }))
      : null;
    return this;
  }

  select() {
    return this;
  }

  single() {
    return { data: this.data, error: null };
  }

  maybeSingle() {
    const data = Array.isArray(this.data) ? this.data[0] ?? null : this.data;
    return { data, error: null };
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  ilike(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  limit() {
    return this;
  }
}

function createClient(
  operations: Operation[],
  seed: Record<string, unknown> = {}
): SupabaseClient<Database> {
  return {
    schema() {
      return {
        from(table: string) {
          return new QueryBuilder(table, operations, seed);
        }
      };
    }
  } as unknown as SupabaseClient<Database>;
}

describe("SupabaseClientIngestionStore", () => {
  it("maps source, post, ad, and visual asset writes to Supabase rows", async () => {
    const operations: Operation[] = [];
    const store = new SupabaseClientIngestionStore(createClient(operations));

    await store.updateJobStatus({
      jobId: "job-1",
      status: "scraping_facebook_posts",
      currentStep: "scraping_facebook_posts",
      sourceStatus: { facebook_posts: "running" }
    });
    await store.updateClientStatus({
      clientId: "client-1",
      status: "scraping_facebook_posts"
    });
    const source = await store.saveBrandSource({
      clientId: "client-1",
      jobId: "job-1",
      sourceType: "facebook_posts",
      sourceUrl: "https://www.facebook.com/client",
      status: "succeeded",
      rawPayload: [{ ok: true }]
    });
    await store.saveSocialPosts({
      clientId: "client-1",
      sourceId: source.id,
      posts: [
        {
          postUrl: "https://www.facebook.com/post/1",
          text: "Post",
          likes: 1,
          shares: 2,
          comments: 3,
          mediaCount: 1,
          imageCount: 1,
          rawPayload: { post: true },
          visualAssets: []
        }
      ]
    });
    await store.saveAdLibraryItems({
      clientId: "client-1",
      sourceId: source.id,
      ads: [
        {
          adArchiveId: "ad-1",
          pageId: "page-1",
          pageName: "Client",
          adLibraryUrl: "https://www.facebook.com/ads/library/?id=ad-1",
          pageUrl: "https://www.facebook.com/client",
          isActive: true,
          startedAt: null,
          endedAt: null,
          platforms: ["FACEBOOK"],
          displayFormat: "IMAGE",
          bodyText: "Ad body",
          title: null,
          caption: null,
          ctaText: null,
          ctaType: null,
          linkUrl: null,
          imageCount: 1,
          rawPayload: { ad: true },
          visualAssets: []
        }
      ]
    });
    await store.saveVisualAsset({
      clientId: "client-1",
      sourceId: source.id,
      sourceType: "facebook_post",
      sourceUrl: "https://www.facebook.com/post/1",
      sourceItemId: "media-1",
      mirrored: {
        assetBucket: "brand-source-assets",
        assetStoragePath: "client/job/post.jpg",
        assetUrl: "https://storage.example.com/post.jpg",
        originalUrlHash: "hash"
      },
      captionContext: "Caption",
      ocrText: "OCR"
    });

    expect(operations.map((operation) => operation.table)).toEqual([
      "brand_analysis_jobs",
      "clients",
      "brand_sources",
      "brand_social_posts",
      "brand_ad_library_items",
      "brand_visual_assets"
    ]);
    expect(JSON.stringify(operations)).toContain("brand-source-assets");
    expect(JSON.stringify(operations)).toContain("source_id,post_url");
    expect(JSON.stringify(operations)).toContain("source_id,ad_archive_id");
  });

  it("converts undefined payloads to JSON null", () => {
    expect(toJson(undefined)).toBeNull();
  });

  it("uses page details only as defaults for category and logo", async () => {
    const operations: Operation[] = [];
    const store = new SupabaseClientIngestionStore(
      createClient(operations, {
        clients: { category: "Awaiting brand ingestion" },
        brand_library: null
      })
    );

    await store.saveFacebookPageDetails({
      clientId: "client-1",
      category: "TV show",
      logo: {
        assetBucket: "brand-source-assets",
        assetStoragePath: "client/job/facebook_page/logo.png",
        assetUrl: "https://storage.example.com/logo.png",
        originalUrlHash: "logo-hash"
      }
    });

    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "clients",
          action: "update",
          payload: { category: "TV show" }
        }),
        expect.objectContaining({
          table: "brand_library",
          action: "insert",
          payload: expect.objectContaining({
            title: "Logo",
            asset_url: "https://storage.example.com/logo.png"
          })
        })
      ])
    );
    expect(shouldReplaceClientCategory("Agency-defined category")).toBe(false);
    expect(shouldReplaceClientCategory("Uncategorised client")).toBe(true);
  });

  it("preserves a curated category and an existing logo", async () => {
    const operations: Operation[] = [];
    const store = new SupabaseClientIngestionStore(
      createClient(operations, {
        clients: { category: "Entertainment brand" },
        brand_library: {
          id: "logo-1",
          asset_url: "https://storage.example.com/manual-logo.png"
        }
      })
    );

    await store.saveFacebookPageDetails({
      clientId: "client-1",
      category: "TV show",
      logo: {
        assetBucket: "brand-source-assets",
        assetStoragePath: "client/job/facebook_page/logo.png",
        assetUrl: "https://storage.example.com/facebook-logo.png",
        originalUrlHash: "logo-hash"
      }
    });

    expect(operations).toEqual([]);
  });
});

function readRecordValue(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}
