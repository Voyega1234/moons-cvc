import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadGoogleDriveMaterialFolder,
  MAX_GOOGLE_DRIVE_MATERIAL_IMAGES,
  openGoogleDriveMaterialFolder,
  parseGoogleDriveFolderId
} from "./google-drive-materials";

describe("Google Drive materials", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("extracts folder IDs from supported Drive links", () => {
    expect(
      parseGoogleDriveFolderId(
        "https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOp"
      )
    ).toBe("1AbCdEfGhIjKlMnOp");
    expect(() => parseGoogleDriveFolderId("https://example.com/folders/123")).toThrow(
      "Google Drive"
    );
  });

  it("loads each nested folder only when that folder is opened", async () => {
    window.localStorage.setItem(
      "creative-compass.google-provider-token",
      "provider-token"
    );
    window.localStorage.setItem(
      "creative-compass.google-provider-token-expires-at",
      String(Date.now() + 60_000)
    );

    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/files/root-folder?")) {
        return Response.json({
          id: "root-folder",
          name: "Campaign",
          mimeType: "application/vnd.google-apps.folder"
        });
      }
      if (url.includes("root-folder") && url.includes("parents")) {
        return Response.json({
          files: [
            {
              id: "hero",
              name: "Hero.png",
              mimeType: "image/png",
              thumbnailLink: "https://drive.example/hero"
            },
            {
              id: "subfolder",
              name: "Products",
              mimeType: "application/vnd.google-apps.folder"
            }
          ]
        });
      }
      if (url.includes("subfolder") && url.includes("parents")) {
        return Response.json({
          files: [
            {
              id: "packshot",
              name: "Packshot.webp",
              mimeType: "image/webp"
            }
          ]
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const root = await openGoogleDriveMaterialFolder("root-folder", fetchImpl);
    expect(root).toEqual({
      id: "root-folder",
      name: "Campaign",
      path: "Campaign"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const rootContents = await loadGoogleDriveMaterialFolder(root, fetchImpl);
    expect(rootContents.images).toEqual([
      {
        id: "hero",
        name: "Hero.png",
        mimeType: "image/png",
        thumbnailUrl: "https://drive.example/hero"
      }
    ]);
    expect(rootContents.folders).toEqual([
      {
        id: "subfolder",
        name: "Products",
        path: "Campaign / Products"
      }
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const products = rootContents.folders[0];
    if (!products) throw new Error("Expected the nested Products folder.");
    const productContents = await loadGoogleDriveMaterialFolder(
      products,
      fetchImpl
    );
    expect(productContents.images[0]?.name).toBe("Packshot.webp");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("allows 500 images but rejects the 501st image in one opened folder", async () => {
    window.localStorage.setItem(
      "creative-compass.google-provider-token",
      "provider-token"
    );
    window.localStorage.setItem(
      "creative-compass.google-provider-token-expires-at",
      String(Date.now() + 60_000)
    );
    const folder = { id: "large-folder", name: "Large", path: "Large" };
    const image = (index: number) => ({
      id: `image-${index}`,
      name: `Image ${index}.jpg`,
      mimeType: "image/jpeg"
    });
    const fetch500 = vi.fn<typeof fetch>(async () =>
      Response.json({
        files: Array.from(
          { length: MAX_GOOGLE_DRIVE_MATERIAL_IMAGES },
          (_, index) => image(index)
        )
      })
    );
    await expect(
      loadGoogleDriveMaterialFolder(folder, fetch500)
    ).resolves.toMatchObject({
      images: { length: MAX_GOOGLE_DRIVE_MATERIAL_IMAGES }
    });

    const fetch501 = vi.fn<typeof fetch>(async () =>
      Response.json({
        files: Array.from(
          { length: MAX_GOOGLE_DRIVE_MATERIAL_IMAGES + 1 },
          (_, index) => image(index)
        )
      })
    );
    await expect(
      loadGoogleDriveMaterialFolder(folder, fetch501)
    ).rejects.toThrow("more than 500 images");
  });
});
