import { describe, expect, it } from "vitest";
import {
  fetchPastPostExamples,
  selectPastPostsForCaption,
  type PastPostsClient
} from "./past-posts";

function fakeClient(rows: {
  social: Record<string, unknown>[];
  ads: Record<string, unknown>[];
}): PastPostsClient {
  return {
    schema() {
      return {
        from(table: string) {
          return {
            select() {
              return {
                eq() {
                  return {
                    order() {
                      return {
                        async limit() {
                          return {
                            data: table === "brand_social_posts" ? rows.social : rows.ads,
                            error: null
                          };
                        }
                      };
                    }
                  };
                }
              };
            }
          };
        }
      };
    }
  };
}

describe("fetchPastPostExamples", () => {
  it("combines organic posts and ad captions, dropping empty text", async () => {
    const client = fakeClient({
      social: [{ text: "จองคิวก่อนหมดสิทธิ์!" }, { text: "  " }],
      ads: [
        { body_text: "โปรโมชั่นพิเศษ", caption: "แคปชั่นเดิม", cta_text: "สั่งเลย" },
        { body_text: "", caption: null, cta_text: null }
      ]
    });

    const examples = await fetchPastPostExamples({
      client,
      clientId: "flora"
    });

    expect(examples).toEqual([
      { source: "organic_post", text: "จองคิวก่อนหมดสิทธิ์!" },
      {
        source: "ad_caption",
        text: "โปรโมชั่นพิเศษ\nแคปชั่นเดิม\nสั่งเลย"
      }
    ]);
  });

  it("throws a readable error when a query fails", async () => {
    const client: PastPostsClient = {
      schema() {
        return {
          from() {
            return {
              select() {
                return {
                  eq() {
                    return {
                      order() {
                        return {
                          async limit() {
                            return { data: null, error: { message: "boom" } };
                          }
                        };
                      }
                    };
                  }
                };
              }
            };
          }
        };
      }
    };

    await expect(
      fetchPastPostExamples({ client, clientId: "flora" })
    ).rejects.toThrow("boom");
  });
});

describe("selectPastPostsForCaption", () => {
  it("selects a compact mix led by ad captions", () => {
    const posts = [
      ...Array.from({ length: 5 }, (_, index) => ({
        source: "organic_post" as const,
        text: `Organic ${index + 1}`
      })),
      ...Array.from({ length: 6 }, (_, index) => ({
        source: "ad_caption" as const,
        text: `Ad ${index + 1}`
      }))
    ];

    expect(selectPastPostsForCaption(posts)).toEqual([
      { source: "ad_caption", text: "Ad 1" },
      { source: "ad_caption", text: "Ad 2" },
      { source: "ad_caption", text: "Ad 3" },
      { source: "ad_caption", text: "Ad 4" },
      { source: "organic_post", text: "Organic 1" },
      { source: "organic_post", text: "Organic 2" }
    ]);
  });

  it("fills the sample from whichever source is available", () => {
    const posts = Array.from({ length: 8 }, (_, index) => ({
      source: "organic_post" as const,
      text: `Organic ${index + 1}`
    }));

    expect(selectPastPostsForCaption(posts).map((post) => post.text)).toEqual([
      "Organic 1",
      "Organic 2",
      "Organic 3",
      "Organic 4",
      "Organic 5",
      "Organic 6"
    ]);
  });
});
