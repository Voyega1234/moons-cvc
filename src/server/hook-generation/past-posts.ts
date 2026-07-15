export interface PastPostExample {
  source: "organic_post" | "ad_caption";
  text: string;
}

export interface PastPostsClient {
  schema(schema: "moons"): {
    from(table: string): {
      select(columns: string): {
        eq(column: string, value: string): {
          order(
            column: string,
            options: { ascending: boolean }
          ): {
            limit(count: number): Promise<{
              data: Record<string, unknown>[] | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    };
  };
}

const PAST_POSTS_LIMIT = 20;

export async function fetchPastPostExamples({
  client,
  clientId
}: {
  client: PastPostsClient;
  clientId: string;
}): Promise<readonly PastPostExample[]> {
  const schema = client.schema("moons");

  const [postsResult, adsResult] = await Promise.all([
    schema
      .from("brand_social_posts")
      .select("text")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(PAST_POSTS_LIMIT),
    schema
      .from("brand_ad_library_items")
      .select("body_text, caption, cta_text")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(PAST_POSTS_LIMIT)
  ]);

  if (postsResult.error) throw new Error(postsResult.error.message);
  if (adsResult.error) throw new Error(adsResult.error.message);

  const organicPosts: PastPostExample[] = (postsResult.data ?? [])
    .map((row) => (typeof row.text === "string" ? row.text.trim() : ""))
    .filter((text) => text.length > 0)
    .map((text) => ({ source: "organic_post" as const, text }));

  const adCaptions: PastPostExample[] = (adsResult.data ?? [])
    .map((row) => buildAdCaptionText(row))
    .filter((text): text is string => text.length > 0)
    .map((text) => ({ source: "ad_caption" as const, text }));

  return [...organicPosts, ...adCaptions];
}

function buildAdCaptionText(row: Record<string, unknown>): string {
  return [row.body_text, row.caption, row.cta_text]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0
    )
    .map((value) => value.trim())
    .join("\n");
}
