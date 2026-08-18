import { describe, expect, it, vi } from "vitest";
import { uploadPptxToGoogleSlides } from "./google-slides-import";

describe("uploadPptxToGoogleSlides", () => {
  it("uses the authenticated backend to initialize, upload, and share the deck", async () => {
    const blob = new Blob(["deck"], {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        uploadUrl: "https://upload.example/session"
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: "slide-file-id",
        name: "Korea King creative slides",
        mimeType: "application/vnd.google-apps.presentation"
      }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        id: "slide-file-id",
        name: "Korea King creative slides",
        url: "https://docs.google.com/presentation/d/slide-file-id/edit"
      }));

    const result = await uploadPptxToGoogleSlides({
      blob,
      name: "Korea King creative slides.pptx",
      fetchImpl,
      accessTokenProvider: async () => "supabase-token",
      endpoint: "/api/google-slides"
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "/api/google-slides",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer supabase-token",
          "Content-Type": "application/json"
        }
      })
    );
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      action: "initialize",
      name: "Korea King creative slides",
      size: blob.size
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://upload.example/session",
      expect.objectContaining({ method: "PUT", body: blob })
    );
    expect(JSON.parse(String(fetchImpl.mock.calls[2]?.[1]?.body))).toEqual({
      action: "share",
      fileId: "slide-file-id"
    });
    expect(result).toEqual({
      id: "slide-file-id",
      name: "Korea King creative slides",
      url: "https://docs.google.com/presentation/d/slide-file-id/edit"
    });
  });

  it("surfaces a backend initialization error", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ ok: false, error: "Shared Drive folder is unavailable." }, 500)
    );

    await expect(
      uploadPptxToGoogleSlides({
        blob: new Blob(["deck"]),
        name: "Creative slides",
        fetchImpl,
        accessTokenProvider: async () => "supabase-token"
      })
    ).rejects.toThrow("Shared Drive folder is unavailable.");
  });

  it("stops if Google upload does not return a file ID", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        uploadUrl: "https://upload.example/session"
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(
      uploadPptxToGoogleSlides({
        blob: new Blob(["deck"]),
        name: "Creative slides",
        fetchImpl,
        accessTokenProvider: async () => null
      })
    ).rejects.toThrow("Google Drive did not return a file ID.");
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
