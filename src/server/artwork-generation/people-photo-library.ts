import { PEOPLE_PHOTO_BUCKET, PEOPLE_PHOTO_FOLDER, PEOPLE_PHOTO_PREFIX, peoplePhotoSourceLabel, selectPeoplePhotoNames } from "../../domain/people-photos.js";
import type { ArtworkStorageClient } from "./artwork-generation-types.js";
import type { ReferenceImageInput } from "./openai-images-client.js";
import sharp from "sharp";

export function plannedPeoplePhotos(references: readonly ReferenceImageInput[], selection: unknown): readonly ReferenceImageInput[] {
  if (selection === undefined) return [];
  if (!Array.isArray(selection)) throw new Error("peoplePhotoImages must be an image-number array.");
  return [...new Set(selection)].map((number) => {
    const image = Number.isInteger(number) ? references[number - 1] : undefined;
    if (!image?.label?.startsWith(PEOPLE_PHOTO_PREFIX)) throw new Error("The people-photo plan selected an unavailable or non-people image.");
    return image;
  });
}

export async function loadPeoplePhotoCandidates(storage: ArtworkStorageClient): Promise<readonly string[]> {
  const bucket = storage.storage.from(PEOPLE_PHOTO_BUCKET);
  if (!bucket.list) return [];
  const names = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await bucket.list(PEOPLE_PHOTO_FOLDER, { limit: 1000, offset, sortBy: { column: "created_at", order: "desc" } });
    if (error) throw new Error(`People photo library: ${error.message}`);
    for (const item of data ?? []) if (item.id && /\.(?:png|jpe?g|webp)$/i.test(item.name)) names.add(`${PEOPLE_PHOTO_FOLDER}/${item.name}`);
    if (!data || data.length < 1000) break;
  }
  return [...names];
}

export async function resolvePeoplePhotoCandidates(storage: ArtworkStorageClient, names: readonly string[], context: string, cache = new Map<string, Promise<ReferenceImageInput>>(), limit = 6): Promise<readonly ReferenceImageInput[]> {
  return Promise.all(selectPeoplePhotoNames(names, context, limit).map((name) => {
    const previous = cache.get(name);
    if (previous) return previous;
    const loading = loadPhoto(storage, name);
    cache.set(name, loading);
    return loading;
  }));
}

async function loadPhoto(storage: ArtworkStorageClient, name: string): Promise<ReferenceImageInput> {
    const { data, error } = await storage.storage.from(PEOPLE_PHOTO_BUCKET).download(name);
    if (error || !data) throw new Error(`People photo could not be loaded: ${name}`);
    return {
      bytes: await sharp(Buffer.from(await data.arrayBuffer())).rotate()
        .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
        .toColourspace("srgb").jpeg({ quality: 85 }).toBuffer(),
      mimeType: "image/jpeg",
      label: peoplePhotoSourceLabel(name)
    };
}
