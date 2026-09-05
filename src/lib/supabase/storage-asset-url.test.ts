import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "./database.types";
import {
  parseSupabaseSignedStorageUrl,
  refreshSupabaseSignedAssetUrl,
  toPermanentSupabaseAssetUrl
} from "./storage-asset-url";

describe("Supabase storage asset URLs", () => {
  it("extracts the stable bucket and object path from an expired signed URL", () => {
    expect(
      parseSupabaseSignedStorageUrl(
        "https://project.supabase.co/storage/v1/object/sign/brand-assets/client/brand-kit/logo%20final.png?token=expired"
      )
    ).toEqual({
      bucket: "brand-assets",
      path: "client/brand-kit/logo final.png"
    });
  });

  it("renews a stored signed URL without depending on its expired token", async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: "https://project.supabase.co/fresh-logo.png" },
      error: null
    });
    const client = {
      storage: {
        from: vi.fn(() => ({ createSignedUrl }))
      }
    } as unknown as SupabaseClient<Database>;

    await expect(
      refreshSupabaseSignedAssetUrl(
        client,
        "https://project.supabase.co/storage/v1/object/sign/brand-assets/client/logo.png?token=expired"
      )
    ).resolves.toBe("https://project.supabase.co/fresh-logo.png");
    expect(createSignedUrl).toHaveBeenCalledWith(
      "client/logo.png",
      60 * 60 * 24 * 7
    );
  });

  it("leaves ordinary external image URLs unchanged", async () => {
    const client = {} as SupabaseClient<Database>;
    await expect(
      refreshSupabaseSignedAssetUrl(
        client,
        "https://images.example.com/logo.png"
      )
    ).resolves.toBe("https://images.example.com/logo.png");
  });

  it("keeps a signed URL that is not close to expiring", async () => {
    const payload = btoa(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 * 60 })
    );
    const value =
      `https://project.supabase.co/storage/v1/object/sign/brand-assets/client/fresh.png` +
      `?token=header.${payload}.signature`;
    const client = {} as SupabaseClient<Database>;

    await expect(refreshSupabaseSignedAssetUrl(client, value)).resolves.toBe(
      value
    );
  });

  it("rewrites a legacy signed URL to the permanent public URL", () => {
    expect(
      toPermanentSupabaseAssetUrl(
        "https://project.supabase.co/storage/v1/object/sign/brand-assets/client/brand-kit/logo%20final.png?token=expired"
      )
    ).toBe(
      "https://project.supabase.co/storage/v1/object/public/brand-assets/client/brand-kit/logo%20final.png"
    );
  });

  it("leaves a URL that is already public unchanged", () => {
    const value =
      "https://project.supabase.co/storage/v1/object/public/brand-assets/client/logo.png";
    expect(toPermanentSupabaseAssetUrl(value)).toBe(value);
  });

  it("leaves ordinary external image URLs unchanged when converting to a permanent URL", () => {
    const value = "https://images.example.com/logo.png";
    expect(toPermanentSupabaseAssetUrl(value)).toBe(value);
  });
});
