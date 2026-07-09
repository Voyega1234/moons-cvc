import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/database.types";
import {
  buildStoragePath,
  extensionFromMimeType,
  hashOriginalUrl,
  SupabaseImageMirror
} from "./supabase-image-mirror";

describe("SupabaseImageMirror", () => {
  it("builds stable storage paths with safe segments", () => {
    expect(
      buildStoragePath({
        clientId: "Client One!",
        jobId: "Job 1",
        sourceType: "facebook_post",
        sourceItemId: "Post / 123",
        index: 2,
        originalUrlHash: "abcdef",
        extension: "jpg"
      })
    ).toBe("client-one/job-1/facebook_post/post-123-2-abcdef.jpg");
  });

  it("maps image mime types to file extensions", () => {
    expect(extensionFromMimeType("image/jpeg")).toBe("jpg");
    expect(extensionFromMimeType("image/png; charset=utf-8")).toBe("png");
    expect(extensionFromMimeType("image/webp")).toBe("webp");
  });

  it("hashes original URLs deterministically", async () => {
    await expect(hashOriginalUrl("https://cdn.example.com/a.jpg")).resolves.toBe(
      await hashOriginalUrl("https://cdn.example.com/a.jpg")
    );
  });

  it("downloads an image, uploads it to Supabase Storage, and returns a signed URL", async () => {
    const uploads: unknown[] = [];
    const client = {
      storage: {
        from(bucket: string) {
          return {
            async upload(path: string, blob: Blob, options: unknown) {
              uploads.push({ bucket, path, size: blob.size, options });
              return { data: { path }, error: null };
            },
            async createSignedUrl(path: string) {
              return {
                data: { signedUrl: `https://storage.example.com/${path}` },
                error: null
              };
            }
          };
        }
      }
    } as unknown as SupabaseClient<Database>;
    const fetchImpl = vi.fn(async () =>
      new Response(new Blob(["image-bytes"]), {
        status: 200,
        headers: { "content-type": "image/png" }
      })
    );

    const mirror = new SupabaseImageMirror({ client, fetchImpl });
    const result = await mirror.mirror({
      clientId: "client-1",
      jobId: "job-1",
      sourceType: "facebook_ad",
      sourceItemId: "ad-1",
      index: 0,
      imageUrl: "https://cdn.example.com/ad.png"
    });

    expect(result.assetBucket).toBe("brand-source-assets");
    expect(result.assetStoragePath).toContain("client-1/job-1/facebook_ad");
    expect(result.assetStoragePath).toMatch(/\.png$/);
    expect(result.assetUrl).toContain(result.assetStoragePath);
    expect(uploads).toHaveLength(1);
    expect(JSON.stringify(uploads)).toContain("brand-source-assets");
  });

  it("rejects non-image source assets", async () => {
    const client = {
      storage: {
        from() {
          return {
            upload: vi.fn(),
            createSignedUrl: vi.fn()
          };
        }
      }
    } as unknown as SupabaseClient<Database>;
    const fetchImpl = vi.fn(async () =>
      new Response("not image", {
        status: 200,
        headers: { "content-type": "video/mp4" }
      })
    );

    const mirror = new SupabaseImageMirror({ client, fetchImpl });
    await expect(
      mirror.mirror({
        clientId: "client-1",
        jobId: "job-1",
        sourceType: "facebook_post",
        sourceItemId: "video-1",
        index: 0,
        imageUrl: "https://cdn.example.com/video.mp4"
      })
    ).rejects.toThrow("Source asset is not an image.");
  });
});
