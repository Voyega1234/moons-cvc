import { describe, expect, it, vi } from "vitest";
import { uploadPptxToGoogleSlides } from "./google-slides-import";

describe("uploadPptxToGoogleSlides", () => {
  it("gets a server-authorized upload session and converts the deck to Google Slides", async () => {
    const blob = new Blob(["deck"], {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          ok: true,
          uploadUrl: "https://upload.example/session",
          name: "Korea King creative slides"
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
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
      sessionToken: "supabase-session-token",
      endpoint: "/api/google-slides-upload-session",
      fetchImpl: fetchImpl as typeof fetch
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "/api/google-slides-upload-session",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer supabase-session-token"
        })
      })
    );
    const initializeBody = JSON.parse(
      String(fetchImpl.mock.calls[0]?.[1]?.body)
    ) as { name: string; size: number };
    expect(initializeBody).toEqual({
      name: "Korea King creative slides",
      size: blob.size
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
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(
      uploadPptxToGoogleSlides({
        blob: new Blob(["deck"]),
        name: "Creative slides",
        sessionToken: "supabase-session-token",
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
        sessionToken: "supabase-session-token",
        fetchImpl: fetchImpl as typeof fetch
      })
    ).rejects.toThrow("Drive API has not been enabled.");
  });
});
