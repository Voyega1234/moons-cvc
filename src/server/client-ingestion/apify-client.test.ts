import { describe, expect, it, vi } from "vitest";
import { createApifyClient } from "./apify-client";

describe("createApifyClient", () => {
  it("uses the Ads Library actor input schema", async () => {
    let requestBody: BodyInit | null | undefined;
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, request?: RequestInit) => {
        requestBody = request?.body;
        return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
        });
      }
    );
    const client = createApifyClient({
      token: "token",
      fetchImpl: fetchImpl as typeof fetch
    });

    await client.scrapeFacebookAdsLibrary(
      "https://www.facebook.com/example"
    );

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.parse(String(requestBody))).toEqual({
      urls: [{ url: "https://www.facebook.com/example" }],
      limitPerSource: 30,
      scrapeAdDetails: true,
      "scrapePageAds.activeStatus": "all",
      "scrapePageAds.countryCode": "ALL"
    });
  });

  it("includes the actor response detail when Apify rejects input", async () => {
    const client = createApifyClient({
      token: "token",
      fetchImpl: vi.fn(async () =>
        new Response('{"error":"Invalid input"}', { status: 400 })
      ) as typeof fetch
    });

    await expect(
      client.scrapeFacebookAdsLibrary("https://www.facebook.com/example")
    ).rejects.toThrow('400 · {"error":"Invalid input"}');
  });
});
