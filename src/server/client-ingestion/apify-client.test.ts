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

  it("uses the Facebook page details actor without putting the token in the URL", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input);
        requestInit = init;
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    );
    const client = createApifyClient({
      token: "secret-token",
      fetchImpl: fetchImpl as typeof fetch
    });

    await client.scrapeFacebookPageDetails?.(
      "https://www.facebook.com/example"
    );

    expect(requestUrl).toContain(
      "igview-owner~facebook-page-details-scraper/run-sync-get-dataset-items"
    );
    expect(requestUrl).not.toContain("secret-token");
    expect(requestInit?.headers).toMatchObject({
      Authorization: "Bearer secret-token"
    });
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      pageUrls: ["https://www.facebook.com/example"],
      showVerifiedBadge: true
    });
  });
});
