import { describe, expect, it, vi } from "vitest";
import { resolveConvertCakeAuthorization } from "./convert-cake-auth";

describe("resolveConvertCakeAuthorization", () => {
  it("allows an authenticated Convert Cake account", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ email: "Designer@convertcake.com" }), {
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(
      resolveConvertCakeAuthorization(
        new Request("https://example.com/api", {
          headers: { Authorization: "Bearer supabase-token" }
        }),
        {
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_ANON_KEY: "anon-key"
        },
        fetchImpl
      )
    ).resolves.toEqual({
      authorized: true,
      accessToken: "supabase-token",
      email: "designer@convertcake.com"
    });
  });

  it("does not allow organization metadata to bypass the email domain", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          email: "outsider@example.com",
          app_metadata: { organization: "convert_cake" }
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await resolveConvertCakeAuthorization(
      new Request("https://example.com/api", {
        headers: { Authorization: "Bearer supabase-token" }
      }),
      {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl
    );

    expect(result.authorized).toBe(false);
  });
});
