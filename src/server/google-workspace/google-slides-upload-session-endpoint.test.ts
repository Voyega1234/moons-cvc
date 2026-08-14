import { describe, expect, it, vi } from "vitest";
import { handleGoogleSlidesUploadSessionRequest } from "./google-slides-upload-session-endpoint";

const env = {
  VERCEL_ENV: "production",
  SUPABASE_URL: "https://supabase.example",
  SUPABASE_ANON_KEY: "anon-key",
  GOOGLE_CLOUD_PROJECT_NUMBER: "123456789",
  GOOGLE_WORKLOAD_IDENTITY_POOL: "vercel",
  GOOGLE_WORKLOAD_IDENTITY_PROVIDER: "compass",
  GOOGLE_SERVICE_ACCOUNT_EMAIL:
    "compass-workspace@example-project.iam.gserviceaccount.com"
};

describe("handleGoogleSlidesUploadSessionRequest", () => {
  it("uses Vercel OIDC and DWD to create a user-owned resumable upload", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        id: "supabase-user-id",
        email: "designer@convertcake.com"
      }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "cloud-token" }))
      .mockResolvedValueOnce(jsonResponse({ signedJwt: "signed-jwt" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "drive-token" }))
      .mockResolvedValueOnce(new Response(null, {
        status: 200,
        headers: { Location: "https://upload.example/session" }
      }));

    const response = await handleGoogleSlidesUploadSessionRequest({
      request: request({ name: "Campaign.pptx", size: 4096 }),
      env,
      oidcToken: "vercel-oidc-token",
      fetchImpl
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      uploadUrl: "https://upload.example/session",
      name: "Campaign"
    });
    const signBody = JSON.parse(String(fetchImpl.mock.calls[2]?.[1]?.body)) as {
      payload: string;
    };
    expect(JSON.parse(signBody.payload)).toMatchObject({
      sub: "designer@convertcake.com",
      scope: "https://www.googleapis.com/auth/drive.file"
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining("uploadType=resumable"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer drive-token" })
      })
    );
  });

  it("rejects requests without a valid Creative Compass session", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const response = await handleGoogleSlidesUploadSessionRequest({
      request: new Request("https://example.com/api/google-slides-upload-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Campaign", size: 4096 })
      }),
      env,
      oidcToken: "vercel-oidc-token",
      fetchImpl
    });

    expect(response.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function request(body: unknown): Request {
  return new Request("https://example.com/api/google-slides-upload-session", {
    method: "POST",
    headers: {
      Authorization: "Bearer supabase-session-token",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" }
  });
}
