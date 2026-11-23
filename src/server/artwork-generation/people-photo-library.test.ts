import { expect, it, vi } from "vitest";
import { PEOPLE_PHOTO_PREFIX, PEOPLE_PHOTO_FOLDER, peoplePhotoPath } from "../../domain/people-photos";
import { loadPeoplePhotoCandidates, plannedPeoplePhotos, resolvePeoplePhotoCandidates } from "./people-photo-library";
import type { ArtworkStorageClient } from "./artwork-generation-types";
import type { ReferenceImageInput } from "./openai-images-client";
import sharp from "sharp";

it("lists only images and caches shared image bytes across Hook requests", async () => {
  const path = peoplePhotoPath("office woman", "image/png");
  const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: "white" } }).png().toBuffer();
  const bucket = {
    list: vi.fn().mockResolvedValue({ data: [{ name: path.split("/").at(-1), id: "photo" }, { name: "folder", id: null }], error: null }),
    download: vi.fn().mockResolvedValue({ data: { type: "image/png", arrayBuffer: async () => bytes }, error: null })
  };
  const storage = { storage: { from: vi.fn().mockReturnValue(bucket) } } as unknown as ArtworkStorageClient;
  const names = await loadPeoplePhotoCandidates(storage);
  expect(bucket.list.mock.calls[0]?.[0]).toBe(PEOPLE_PHOTO_FOLDER);
  expect(names).toEqual([path]);
  const cache = new Map<string, Promise<ReferenceImageInput>>();
  const [first, second] = await Promise.all([resolvePeoplePhotoCandidates(storage, names, "office", cache), resolvePeoplePhotoCandidates(storage, names, "woman", cache)]);
  expect(bucket.download).toHaveBeenCalledOnce();
  expect(first[0]).toBe(second[0]);
  expect(first[0]?.label).toContain(`${PEOPLE_PHOTO_PREFIX}office woman`);
  expect(first[0]?.label).toContain("Gender (team-provided): Not specified");
  expect(first[0]?.mimeType).toBe("image/jpeg");
  expect((await sharp(first[0]!.bytes).metadata()).width).toBe(32);
});

it("loads later pages instead of silently dropping older library photos", async () => {
  const first = Array.from({ length: 1000 }, (_, index) => ({ id: `${index}`, name: `${index}.jpg` }));
  const list = vi.fn().mockResolvedValueOnce({ data: first, error: null }).mockResolvedValueOnce({ data: [{ id: "last", name: "older.jpg" }], error: null });
  const storage = { storage: { from: () => ({ list }) } } as unknown as ArtworkStorageClient;
  const names = await loadPeoplePhotoCandidates(storage);
  expect(names).toHaveLength(1001);
  expect(names.at(-1)).toBe(`${PEOPLE_PHOTO_FOLDER}/older.jpg`);
  expect(list.mock.calls[1]?.[1].offset).toBe(1000);
});

it("only accepts explicitly chosen optional people images", () => {
  const references = [{ bytes: Buffer.from("product"), mimeType: "image/png", label: "Uploaded main object" }, { bytes: Buffer.from("person"), mimeType: "image/png", label: `${PEOPLE_PHOTO_PREFIX}portrait` }];
  expect(plannedPeoplePhotos(references, [])).toEqual([]);
  expect(plannedPeoplePhotos(references, undefined)).toEqual([]);
  expect(plannedPeoplePhotos(references, [2, 2])).toEqual([references[1]]);
  for (const selection of [[1], [3], [0], [1.5], ["2"], "2"]) expect(() => plannedPeoplePhotos(references, selection)).toThrow();
});
