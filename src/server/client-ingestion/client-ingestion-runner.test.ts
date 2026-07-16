import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/database.types";
import type { ApifyClient } from "./apify-client";
import type {
  ClientIngestionStore,
  ImageMirror
} from "./client-ingestion-harness";
import {
  runNextClientIngestionJob,
  SupabaseClientIngestionJobQueue,
  type ClientIngestionJobQueue
} from "./client-ingestion-runner";

function createStore(): ClientIngestionStore & {
  jobStatuses: unknown[];
  clientStatuses: unknown[];
  visualAssets: unknown[];
} {
  return {
    jobStatuses: [],
    clientStatuses: [],
    visualAssets: [],
    async updateJobStatus(input) {
      this.jobStatuses.push(input);
    },
    async updateClientStatus(input) {
      this.clientStatuses.push(input);
    },
    async saveBrandSource(input) {
      return { id: `${input.sourceType}-source` };
    },
    async listManualBrandInputs() {
      return [];
    },
    async saveSocialPosts(input) {
      return input.posts.map((post, index) => ({
        id: `post-${index + 1}`,
        postUrl: post.postUrl
      }));
    },
    async saveAdLibraryItems() {
      return [];
    },
    async saveVisualAsset(input) {
      this.visualAssets.push(input);
    }
  };
}

describe("runNextClientIngestionJob", () => {
  it("does nothing when there is no queued job to claim", async () => {
    const queue: ClientIngestionJobQueue = {
      claimNextQueuedJob: vi.fn(async () => null)
    };
    const apify: ApifyClient = {
      scrapeFacebookPosts: vi.fn(),
      scrapeFacebookAdsLibrary: vi.fn()
    };

    const result = await runNextClientIngestionJob({
      queue,
      apify,
      store: createStore(),
      imageMirror: { mirror: vi.fn() }
    });

    expect(result).toEqual({ claimed: false });
    expect(apify.scrapeFacebookPosts).not.toHaveBeenCalled();
    expect(apify.scrapeFacebookAdsLibrary).not.toHaveBeenCalled();
  });

  it("runs the ingestion harness for the claimed job", async () => {
    const queue: ClientIngestionJobQueue = {
      claimNextQueuedJob: vi.fn(async () => ({
        job: { id: "job-1", clientId: "client-1" },
        client: {
          id: "client-1",
          name: "Client One",
          facebookUrl: "https://www.facebook.com/client"
        }
      }))
    };
    const apify: ApifyClient = {
      scrapeFacebookPosts: vi.fn(async () => [
        {
          url: "https://www.facebook.com/client/posts/1",
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
          assetStoragePath: `${input.clientId}/${input.jobId}/0.jpg`,
          assetUrl: "https://storage.example.com/0.jpg",
          originalUrlHash: "hash-0"
        };
      }
    };

    const result = await runNextClientIngestionJob({
      queue,
      apify,
      store,
      imageMirror
    });

    expect(result).toMatchObject({
      claimed: true,
      jobId: "job-1",
      clientId: "client-1",
      result: {
        postsSaved: 1,
        adsSaved: 0,
        visualAssetsMirrored: 1
      }
    });
    expect(store.clientStatuses.at(-1)).toMatchObject({
      clientId: "client-1",
      status: "needs_review"
    });
    expect(store.visualAssets).toHaveLength(1);
  });

  it("marks the claimed job and client failed when an unexpected worker error escapes", async () => {
    const queue: ClientIngestionJobQueue = {
      claimNextQueuedJob: vi.fn(async () => ({
        job: { id: "job-1", clientId: "client-1" },
        client: {
          id: "client-1",
          name: "Client One",
          facebookUrl: "https://www.facebook.com/client"
        }
      }))
    };
    const store = createStore();
    store.saveSocialPosts = vi.fn(async () => {
      throw new Error("Could not persist Facebook posts");
    });

    const result = await runNextClientIngestionJob({
      queue,
      apify: {
        scrapeFacebookPosts: vi.fn(async () => [
          {
            url: "https://www.facebook.com/client/posts/1",
            text: "Post"
          }
        ]),
        scrapeFacebookAdsLibrary: vi.fn(async () => [])
      },
      store,
      imageMirror: { mirror: vi.fn() }
    });

    expect(result).toMatchObject({
      claimed: true,
      result: { completed: false }
    });
    expect(store.jobStatuses.at(-1)).toMatchObject({
      jobId: "job-1",
      status: "failed",
      errorMessage: "Could not persist Facebook posts"
    });
    expect(store.clientStatuses.at(-1)).toMatchObject({
      clientId: "client-1",
      status: "failed",
      errorMessage: "Could not persist Facebook posts"
    });
  });
});

describe("SupabaseClientIngestionJobQueue", () => {
  it("maps the claimed RPC row into a harness job and client", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          job_id: "job-1",
          client_id: "client-1",
          client_name: "Client One",
          facebook_url: "https://www.facebook.com/client"
        }
      ],
      error: null
    }));
    const schema = vi.fn(() => ({ rpc }));
    const supabase = { schema } as unknown as SupabaseClient<Database>;

    const queue = new SupabaseClientIngestionJobQueue(supabase);
    const claimed = await queue.claimNextQueuedJob();

    expect(schema).toHaveBeenCalledWith("moons");
    expect(rpc).toHaveBeenCalledWith("claim_next_brand_analysis_job");
    expect(claimed).toEqual({
      job: { id: "job-1", clientId: "client-1" },
      client: {
        id: "client-1",
        name: "Client One",
        facebookUrl: "https://www.facebook.com/client"
      }
    });
  });
});
