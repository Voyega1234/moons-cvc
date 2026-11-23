import { getSupabaseClient } from "../../lib/supabase/client";
import { env } from "../../config/env";
import { PEOPLE_PHOTO_BUCKET, PEOPLE_PHOTO_FOLDER, PEOPLE_PHOTO_MAX_BYTES, PEOPLE_PHOTO_MIME_TYPES, peoplePhotoPath, peoplePhotoTitle, peoplePhotoDetails, readPeoplePhotoAnalysis, type PeopleCasting, type PeoplePhotoAnalysis } from "../../domain/people-photos";

export interface PeoplePhoto { path: string; title: string; url: string; ageBand?: PeopleCasting["ageBand"]; gender?: PeopleCasting["gender"]; analysis?: PeoplePhotoAnalysis; }

export async function listPeoplePhotos(): Promise<readonly PeoplePhoto[]> {
  const bucket = getSupabaseClient().storage.from(PEOPLE_PHOTO_BUCKET);
  const files: { name: string }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await bucket.list(PEOPLE_PHOTO_FOLDER, { limit: 1000, offset, sortBy: { column: "created_at", order: "desc" } });
    if (error) throw new Error(`Could not load the shared people library: ${error.message}`);
    files.push(...(data ?? []).filter((file) => file.id && /\.(png|jpe?g|webp)$/i.test(file.name)).map((file) => ({ name: `${PEOPLE_PHOTO_FOLDER}/${file.name}` })));
    if (!data || data.length < 1000) break;
  }
  if (!files.length) return [];
  const signed = await bucket.createSignedUrls(files.map((file) => file.name), 3600);
  if (signed.error) throw signed.error;
  return files.map((file, index) => {
    const url = signed.data?.[index]?.signedUrl;
    if (!url) throw new Error(`Could not preview ${peoplePhotoTitle(file.name)}.`);
    return { path: file.name, ...peoplePhotoDetails(file.name), url };
  });
}

export async function uploadPeoplePhoto(file: File, description: string, casting?: PeopleCasting): Promise<{ warning?: string }> {
  if (!PEOPLE_PHOTO_MIME_TYPES.includes(file.type)) throw new Error("Choose JPEG, PNG or WEBP photos.");
  if (file.size > PEOPLE_PHOTO_MAX_BYTES) throw new Error("Each photo must be 15 MB or smaller.");
  const title = [description.trim(), file.name].filter(Boolean).join(" — ");
  const path = peoplePhotoPath(title, file.type, casting);
  const { error } = await getSupabaseClient().storage.from(PEOPLE_PHOTO_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(`Could not upload ${file.name}: ${error.message}`);
  try { await analyzeStoredPeoplePhoto({ path, title: peoplePhotoTitle(path), url: "", ...casting }); return {}; }
  catch (caught) { return { warning: `${file.name} was uploaded, but AI labels could not be saved. ${caught instanceof Error ? caught.message : "Use Retry labeling to try again."}` }; }
}

export async function updatePeoplePhotoCasting(photo: PeoplePhoto, casting: PeopleCasting, analysis = photo.analysis): Promise<void> {
  const mimeType = /\.png$/i.test(photo.path) ? "image/png" : /\.webp$/i.test(photo.path) ? "image/webp" : "image/jpeg";
  const { error } = await getSupabaseClient().storage.from(PEOPLE_PHOTO_BUCKET).move(photo.path, peoplePhotoPath(photo.title, mimeType, casting, analysis));
  if (error) throw new Error(`Could not save casting details: ${error.message}`);
}

export async function analyzeStoredPeoplePhoto(photo: PeoplePhoto): Promise<void> {
  const { data } = await getSupabaseClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in before analyzing photos.");
  const response = await fetch(`${env.apiBaseUrl}/people-photo-analysis`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ path: photo.path }), signal: AbortSignal.timeout(170_000)
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error(typeof result.error === "string" ? result.error : "Photo analysis failed.");
  const analysis = readPeoplePhotoAnalysis(result.analysis);
  await updatePeoplePhotoCasting(photo, { ageBand: photo.ageBand ?? "unknown", gender: photo.gender ?? "unspecified" }, analysis);
}

export async function removePeoplePhoto(path: string): Promise<void> {
  const { error } = await getSupabaseClient().storage.from(PEOPLE_PHOTO_BUCKET).remove([path]);
  if (error) throw error;
}
