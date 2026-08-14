import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cacheGoogleProviderRefreshToken,
  captureGoogleProviderToken,
  clearGoogleProviderToken,
  currentGoogleProviderToken,
  requireGoogleProviderToken
} from "./provider-token";

describe("Google Workspace provider token", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps a freshly returned Supabase provider token for Google API calls", () => {
    captureGoogleProviderToken({ provider_token: "google-token" }, 1_000);

    expect(currentGoogleProviderToken(2_000)).toBe("google-token");
  });

  it("clears an expired provider token", () => {
    captureGoogleProviderToken({ provider_token: "google-token" }, 1_000);

    expect(currentGoogleProviderToken(60 * 60 * 1000)).toBeNull();
  });

  it("removes Google access on sign out and returns an actionable error", async () => {
    captureGoogleProviderToken({ provider_token: "google-token" });
    clearGoogleProviderToken();

    await expect(
      requireGoogleProviderToken(fetch, async () => null)
    ).rejects.toThrow(
      "Your Creative Compass session has expired. Sign in again."
    );
  });

  it("renews an expired Google token through the authenticated backend", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          accessToken: "renewed-google-token",
          expiresIn: 3_600
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );

    await expect(
      requireGoogleProviderToken(
        fetchImpl,
        async () => "supabase-access-token"
      )
    ).resolves.toBe("renewed-google-token");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/google-provider-token",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer supabase-access-token"
        }
      })
    );
    expect(currentGoogleProviderToken()).toBe("renewed-google-token");
  });

  it("turns a plain-text server failure into an actionable Google error", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response("A server error occurred.", {
        status: 500,
        headers: { "Content-Type": "text/plain" }
      })
    );

    await expect(
      requireGoogleProviderToken(
        fetchImpl,
        async () => "supabase-access-token"
      )
    ).rejects.toThrow(
      "Google Workspace access could not be authorized."
    );
  });

  it("sends a newly issued Google refresh token only to the backend", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" }
      })
    );

    await cacheGoogleProviderRefreshToken(
      {
        access_token: "supabase-access-token",
        provider_refresh_token: "google-refresh-token"
      },
      fetchImpl
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/google-provider-token",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer supabase-access-token",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ refreshToken: "google-refresh-token" })
      })
    );
    expect(
      Object.values(window.localStorage).includes("google-refresh-token")
    ).toBe(false);
  });

  it("retries a transient failure while saving Google renewal", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" }
        })
      );

    await expect(
      cacheGoogleProviderRefreshToken(
        {
          access_token: "supabase-access-token",
          provider_refresh_token: "google-refresh-token"
        },
        fetchImpl
      )
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries a transient failure while renewing Google access", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            accessToken: "renewed-after-retry",
            expiresIn: 3_600
          }),
          { headers: { "Content-Type": "application/json" } }
        )
      );

    await expect(
      requireGoogleProviderToken(
        fetchImpl,
        async () => "supabase-access-token"
      )
    ).resolves.toBe("renewed-after-retry");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
