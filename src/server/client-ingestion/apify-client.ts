export interface ApifyClientOptions {
  token: string;
  fetchImpl?: typeof fetch;
  postsActorId?: string;
  adsActorId?: string;
  pageDetailsActorId?: string;
}

export interface ApifyClient {
  scrapeFacebookPosts(facebookUrl: string): Promise<unknown>;
  scrapeFacebookAdsLibrary(facebookUrl: string): Promise<unknown>;
  scrapeFacebookPageDetails?(facebookUrl: string): Promise<unknown>;
}

const DEFAULT_POSTS_ACTOR_ID = "apify~facebook-posts-scraper";
const DEFAULT_ADS_ACTOR_ID = "curious_coder~facebook-ads-library-scraper";
const DEFAULT_PAGE_DETAILS_ACTOR_ID =
  "igview-owner~facebook-page-details-scraper";

export function createApifyClient({
  token,
  fetchImpl = fetch,
  postsActorId = DEFAULT_POSTS_ACTOR_ID,
  adsActorId = DEFAULT_ADS_ACTOR_ID,
  pageDetailsActorId = DEFAULT_PAGE_DETAILS_ACTOR_ID
}: ApifyClientOptions): ApifyClient {
  if (!token.trim()) throw new Error("APIFY_TOKEN is required.");

  return {
    scrapeFacebookPosts(facebookUrl) {
      return runActor(fetchImpl, token, postsActorId, {
        captionText: false,
        onlyPostsNewerThan: "2024-07-01",
        onlyPostsOlderThan: "1 day",
        resultsLimit: 30,
        startUrls: [{ url: facebookUrl, method: "GET" }]
      });
    },
    scrapeFacebookAdsLibrary(facebookUrl) {
      return runActor(fetchImpl, token, adsActorId, {
        urls: [{ url: facebookUrl }],
        limitPerSource: 30,
        scrapeAdDetails: true,
        "scrapePageAds.activeStatus": "all",
        "scrapePageAds.countryCode": "ALL"
      });
    },
    scrapeFacebookPageDetails(facebookUrl) {
      return runActor(fetchImpl, token, pageDetailsActorId, {
        pageUrls: [facebookUrl],
        showVerifiedBadge: true
      });
    }
  };
}

async function runActor(
  fetchImpl: typeof fetch,
  token: string,
  actorId: string,
  input: unknown
): Promise<unknown> {
  const response = await fetchImpl(
    `https://api.apify.com/v2/actors/${actorId}/run-sync-get-dataset-items`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    }
  );

  if (!response.ok) {
    const detail = (await response.text()).trim().slice(0, 500);
    throw new Error(
      `Apify actor ${actorId} failed: ${response.status}${detail ? ` · ${detail}` : ""}`
    );
  }

  return response.json();
}
