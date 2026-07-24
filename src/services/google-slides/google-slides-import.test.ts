import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureGoogleProviderToken } from "../../lib/google-workspace/provider-token";
import {
  requestGoogleDriveAccessToken,
  uploadPptxToGoogleSlides
} from "./google-slides-import";

describe("uploadPptxToGoogleSlides", () => {
  beforeEach(() => window.localStorage.clear());

  it("reuses the Google token granted during Supabase sign-in", async () => {
    captureGoogleProviderToken({ provider_token: "supabase-google-token" });

    await expect(requestGoogleDriveAccessToken()).resolves.toBe(
      "supabase-google-token"
    );
  });

  it("uploads a PowerPoint deck and asks Drive to convert it to Google Slides", async () => {
    const blob = new Blob(["deck"], {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { Location: "https://upload.example/session" }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "slide-file-id",
            name: "Korea King creative slides",
            webViewLink:
              "https://docs.google.com/presentation/d/slide-file-id/edit"
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    const result = await uploadPptxToGoogleSlides({
      blob,
      name: "Korea King creative slides.pptx",
      accessToken: "google-access-token",
      fetchImpl: fetchImpl as typeof fetch
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("uploadType=resumable"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer google-access-token",
          "X-Upload-Content-Length": String(blob.size)
        })
      })
    );
    const initializeBody = JSON.parse(
      String(fetchImpl.mock.calls[0]?.[1]?.body)
    ) as { name: string; mimeType: string };
    expect(initializeBody).toEqual({
      name: "Korea King creative slides",
      mimeType: "application/vnd.google-apps.presentation"
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://upload.example/session",
      expect.objectContaining({ method: "PUT", body: blob })
    );
    expect(result).toEqual({
      id: "slide-file-id",
      name: "Korea King creative slides",
      url: "https://docs.google.com/presentation/d/slide-file-id/edit"
    });
  });

  it("stops with a useful error when Drive does not return an upload URL", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));

    await expect(
      uploadPptxToGoogleSlides({
        blob: new Blob(["deck"]),
        name: "Creative slides",
        accessToken: "google-access-token",
        fetchImpl: fetchImpl as typeof fetch
      })
    ).rejects.toThrow("Google Drive did not return an upload location.");
  });

  it("surfaces the message returned by Google Drive", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { message: "Drive API has not been enabled." } }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      )
    );

    await expect(
      uploadPptxToGoogleSlides({
        blob: new Blob(["deck"]),
        name: "Creative slides",
        accessToken: "google-access-token",
        fetchImpl: fetchImpl as typeof fetch
      })
    ).rejects.toThrow("Drive API has not been enabled.");
  });
});
