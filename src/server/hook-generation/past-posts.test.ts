import { describe, expect, it } from "vitest";
import { fetchPastPostExamples, type PastPostsClient } from "./past-posts";

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
        text: "โปรโมชั่นพิเศษ | แคปชั่นเดิม | สั่งเลย"
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
