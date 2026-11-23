import { afterEach, expect, it, vi } from "vitest";
import { getSupabaseClient } from "../../lib/supabase/client";
import { listPeoplePhotos, removePeoplePhoto, uploadPeoplePhoto, updatePeoplePhotoCasting } from "./people-photo-library";
import { PEOPLE_PHOTO_BUCKET, peoplePhotoPath, peoplePhotoTitle, peoplePhotoDetails } from "../../domain/people-photos";

vi.mock("../../lib/supabase/client", () => ({ getSupabaseClient: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });

it("stores shared photos privately with the descriptive name and signed previews", async () => {
  const path = peoplePhotoPath("Thai office portrait", "image/png");
  const bucket = {
    upload: vi.fn().mockResolvedValue({ error: null }),
    list: vi.fn().mockResolvedValue({ data: [{ name: path.split("/").at(-1), id: "image" }], error: null }),
    createSignedUrls: vi.fn().mockResolvedValue({ data: [{ signedUrl: "https://example.com/signed-photo" }], error: null }),
    remove: vi.fn().mockResolvedValue({ error: null }),
    move: vi.fn().mockResolvedValue({ error: null })
  };
  const from = vi.fn().mockReturnValue(bucket);
  vi.mocked(getSupabaseClient).mockReturnValue({ storage: { from }, auth: { getSession: async () => ({ data: { session: { access_token: "session" } } }) } } as unknown as ReturnType<typeof getSupabaseClient>);
  const analysis = { description: "Seated person at desk", tags: ["desk", "seated"], apparentAgeBand: "35-44" };
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, analysis })));
  vi.stubGlobal("fetch", fetchMock);
  const file = new File(["photo"], "photo.png", { type: "image/png" });
  await uploadPeoplePhoto(file, "Woman at desk", { ageBand: "25-34", gender: "woman" });
  expect(from).toHaveBeenCalledWith(PEOPLE_PHOTO_BUCKET);
  const uploaded = bucket.upload.mock.calls[0]!;
  expect(peoplePhotoTitle(uploaded[0])).toBe("Woman at desk — photo.png");
  expect(peoplePhotoDetails(uploaded[0])).toMatchObject({ ageBand: "25-34", gender: "woman" });
  expect(uploaded[2]).toEqual({ contentType: "image/png", upsert: false });
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body)).toEqual({ path: uploaded[0] });
  expect(peoplePhotoDetails(bucket.move.mock.calls[0]?.[1])).toMatchObject({ ageBand: "25-34", gender: "woman", analysis });
  expect(await listPeoplePhotos()).toEqual([{ path, title: "Thai office portrait", url: "https://example.com/signed-photo", ageBand: "unknown", gender: "unspecified" }]);
  expect(bucket.createSignedUrls).toHaveBeenCalledWith([path], 3600);
  await removePeoplePhoto(path);
  expect(bucket.remove).toHaveBeenCalledWith([path]);
  await updatePeoplePhotoCasting({ path, title: "Thai office portrait", url: "https://example.com/signed-photo" }, { ageBand: "35-44", gender: "woman" });
  expect(bucket.move.mock.calls[1]?.[0]).toBe(path);
  expect(peoplePhotoDetails(bucket.move.mock.calls[1]?.[1])).toEqual({ title: "Thai office portrait", ageBand: "35-44", gender: "woman" });
});

it("keeps the uploaded image when AI labeling fails and lets the user retry later", async () => {
  const upload = vi.fn().mockResolvedValue({ error: null });
  const move = vi.fn();
  vi.mocked(getSupabaseClient).mockReturnValue({ storage: { from: () => ({ upload, move }) }, auth: { getSession: async () => ({ data: { session: { access_token: "session" } } }) } } as unknown as ReturnType<typeof getSupabaseClient>);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Label service unavailable")));
  const result = await uploadPeoplePhoto(new File(["image"], "person.png", { type: "image/png" }), "Portrait");
  expect(result.warning).toContain("was uploaded");
  expect(result.warning).toContain("Label service unavailable");
  expect(upload).toHaveBeenCalledOnce();
  expect(move).not.toHaveBeenCalled();
});

it("rejects non-images before accessing storage", async () => {
  await expect(uploadPeoplePhoto(new File(["text"], "x.txt", { type: "text/plain" }), "")).rejects.toThrow("JPEG, PNG or WEBP");
  expect(getSupabaseClient).not.toHaveBeenCalled();
});

it("does not hide missing storage as an empty library", async () => {
  vi.mocked(getSupabaseClient).mockReturnValue({ storage: { from: () => ({ list: async () => ({ data: null, error: { message: "Bucket not found" } }) }) } } as unknown as ReturnType<typeof getSupabaseClient>);
  await expect(listPeoplePhotos()).rejects.toThrow("Bucket not found");
});
