import { describe, expect, it, vi } from "vitest";
import { handleGoogleWorkspaceAccessTokenRequest } from "./workspace-access-token-endpoint";

describe("handleGoogleWorkspaceAccessTokenRequest", () => {
  it("issues a short-lived DWD Drive token for the signed-in employee", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        id: "user-id",
        email: "designer@convertcake.com"
      }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "cloud-token" }))
      .mockResolvedValueOnce(jsonResponse({ signedJwt: "signed-jwt" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "drive-token" }));
    const response = await handleGoogleWorkspaceAccessTokenRequest({
      request: new Request("https://example.com/api/google-provider-token", {
        headers: { Authorization: "Bearer supabase-token" }
      }),
      env: {
        VERCEL_ENV: "production",
        SUPABASE_URL: "https://supabase.example",
        SUPABASE_ANON_KEY: "anon-key",
        GOOGLE_CLOUD_PROJECT_NUMBER: "123456789",
        GOOGLE_WORKLOAD_IDENTITY_POOL: "vercel",
        GOOGLE_WORKLOAD_IDENTITY_PROVIDER: "compass",
        GOOGLE_SERVICE_ACCOUNT_EMAIL:
          "compass-workspace@example-project.iam.gserviceaccount.com"
      },
      oidcToken: "vercel-oidc-token",
      fetchImpl
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      accessToken: "drive-token",
      expiresIn: 3600
    });
    const signBody = JSON.parse(String(fetchImpl.mock.calls[2]?.[1]?.body)) as {
      payload: string;
    };
    expect(JSON.parse(signBody.payload)).toMatchObject({
      sub: "designer@convertcake.com",
      scope: "https://www.googleapis.com/auth/drive.readonly"
    });
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" }
  });
}
