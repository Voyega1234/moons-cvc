import { describe, expect, it, vi } from "vitest";
import { handleGoogleSlidesRequest } from "./google-slides-endpoint";

const env = {
  GOOGLE_SLIDES_FOLDER_ID: "shared-drive-folder-id",
  GOOGLE_WORKSPACE_LOCAL_USER: "designer@convertcake.com"
};

describe("handleGoogleSlidesRequest", () => {
  it("initializes a resumable Google Slides upload in the configured folder", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(null, {
        status: 200,
        headers: { Location: "https://upload.example/session" }
      })
    );
    const createDriveAccessToken = vi.fn(async () => "service-account-token");

    const response = await handleGoogleSlidesRequest({
      request: postRequest({ action: "initialize", name: "Client deck.pptx", size: 42 }),
      env,
      fetchImpl,
      createDriveAccessToken
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      uploadUrl: "https://upload.example/session"
    });
    expect(createDriveAccessToken).toHaveBeenCalledOnce();
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      "upload/drive/v3/files?uploadType=resumable"
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer service-account-token",
      "X-Upload-Content-Length": "42",
      Origin: "https://moons.example"
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      name: "Client deck",
      mimeType: "application/vnd.google-apps.presentation",
      parents: ["shared-drive-folder-id"],
      appProperties: { generatedBy: "moons-google-slides" }
    });
  });

  it("verifies the upload folder and shares the deck with Convert Cake editors", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        id: "generated-slide-id",
        name: "Client deck",
        mimeType: "application/vnd.google-apps.presentation",
        webViewLink: "https://docs.google.com/presentation/d/generated-slide-id/edit",
        parents: ["shared-drive-folder-id"],
        appProperties: { generatedBy: "moons-google-slides" }
      }))
      .mockResolvedValueOnce(jsonResponse({ id: "permission-id" }));

    const response = await handleGoogleSlidesRequest({
      request: postRequest({ action: "share", fileId: "generated-slide-id" }),
      env,
      fetchImpl,
      createDriveAccessToken: async () => "service-account-token"
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      id: "generated-slide-id",
      name: "Client deck",
      url: "https://docs.google.com/presentation/d/generated-slide-id/edit"
    });
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain(
      "/files/generated-slide-id/permissions"
    );
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual({
      type: "domain",
      role: "writer",
      domain: "convertcake.com",
      allowFileDiscovery: false
    });
  });

  it("refuses to share a file outside the configured export folder", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        id: "generated-slide-id",
        mimeType: "application/vnd.google-apps.presentation",
        parents: ["different-folder-id"],
        appProperties: { generatedBy: "moons-google-slides" }
      })
    );

    const response = await handleGoogleSlidesRequest({
      request: postRequest({ action: "share", fileId: "generated-slide-id" }),
      env,
      fetchImpl,
      createDriveAccessToken: async () => "service-account-token"
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Google Slides file is outside the configured export folder."
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects an unauthenticated production request", async () => {
    const response = await handleGoogleSlidesRequest({
      request: postRequest({ action: "initialize", name: "Deck", size: 1 }),
      env: {
        ...env,
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: vi.fn<typeof fetch>(async () => jsonResponse({}, 401)),
      createDriveAccessToken: async () => "unused"
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "Unauthorized." });
  });
});

function postRequest(body: unknown): Request {
  return new Request("https://moons.local/api/google-slides", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://moons.example"
    },
    body: JSON.stringify(body)
  });
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
