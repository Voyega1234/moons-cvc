import { describe, expect, it, vi } from "vitest";
import { resolveConvertCakeAuthorization } from "./convert-cake-auth";

describe("resolveConvertCakeAuthorization", () => {
  it("allows an authenticated Convert Cake account", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          id: "0d4c7456-3876-47d4-bf72-4dfbcd614e40",
          email: "Designer@convertcake.com"
        }),
        { headers: { "Content-Type": "application/json" } }
      )
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
      email: "designer@convertcake.com",
      userId: "0d4c7456-3876-47d4-bf72-4dfbcd614e40"
    });
  });

  it("does not allow organization metadata to bypass the email domain", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          id: "0d4c7456-3876-47d4-bf72-4dfbcd614e40",
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
