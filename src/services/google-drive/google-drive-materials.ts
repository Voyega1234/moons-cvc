import { requireGoogleProviderToken } from "../../lib/google-workspace/provider-token";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp"
]);
export const MAX_GOOGLE_DRIVE_MATERIAL_IMAGES = 500;

export interface GoogleDriveMaterialImage {
  id: string;
  name: string;
  mimeType: string;
  thumbnailUrl?: string;
}

export interface GoogleDriveMaterialFolder {
  id: string;
  name: string;
  path: string;
}

export interface GoogleDriveMaterialFolderContents {
  folder: GoogleDriveMaterialFolder;
  folders: readonly GoogleDriveMaterialFolder[];
  images: readonly GoogleDriveMaterialImage[];
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
}

interface DriveListResponse {
  files?: DriveFile[];
  nextPageToken?: string;
  error?: { message?: string };
}

export function parseGoogleDriveFolderId(value: string): string {
  const trimmed = value.trim();
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Paste a valid Google Drive folder link.");
  }
  if (!/(^|\.)drive\.google\.com$/i.test(url.hostname)) {
    throw new Error("Paste a Google Drive folder link.");
  }
  const match = url.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (!match?.[1]) throw new Error("The link does not contain a Drive folder ID.");
  return match[1];
}

export async function openGoogleDriveMaterialFolder(
  folderLink: string,
  fetchImpl: typeof fetch = fetch
): Promise<GoogleDriveMaterialFolder> {
  const rootId = parseGoogleDriveFolderId(folderLink);
  const accessToken = await requireGoogleProviderToken(fetchImpl);
  const root = await getDriveFile(rootId, accessToken, fetchImpl);
  if (root.mimeType !== FOLDER_MIME_TYPE) {
    throw new Error("The Drive link must point to a folder.");
  }
  return { id: root.id, name: root.name, path: root.name };
}

export async function loadGoogleDriveMaterialFolder(
  folder: GoogleDriveMaterialFolder,
  fetchImpl: typeof fetch = fetch
): Promise<GoogleDriveMaterialFolderContents> {
  const accessToken = await requireGoogleProviderToken(fetchImpl);
  const children = await listDriveFolder(folder.id, accessToken, fetchImpl);
  const images = children
    .filter((file) => SUPPORTED_IMAGE_TYPES.has(file.mimeType))
    .map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      ...(file.thumbnailLink ? { thumbnailUrl: file.thumbnailLink } : {})
    }));
  if (images.length > MAX_GOOGLE_DRIVE_MATERIAL_IMAGES) {
    throw new Error(
      `This folder contains more than ${MAX_GOOGLE_DRIVE_MATERIAL_IMAGES} images.`
    );
  }
  const folders = children
    .filter((file) => file.mimeType === FOLDER_MIME_TYPE)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((child) => ({
      id: child.id,
      name: child.name,
      path: `${folder.path} / ${child.name}`
    }));
  return { folder, folders, images };
}

export async function downloadGoogleDriveMaterial(
  image: GoogleDriveMaterialImage,
  fetchImpl: typeof fetch = fetch
): Promise<File> {
  const accessToken = await requireGoogleProviderToken(fetchImpl);
  const response = await fetchImpl(
    `${DRIVE_API}/files/${encodeURIComponent(image.id)}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) throw new Error(await driveError(response, "Could not download image."));
  const blob = await response.blob();
  return new File([blob], image.name, {
    type: blob.type || image.mimeType
  });
}

async function getDriveFile(
  id: string,
  accessToken: string,
  fetchImpl: typeof fetch
): Promise<DriveFile> {
  const response = await fetchImpl(
    `${DRIVE_API}/files/${encodeURIComponent(id)}?fields=id,name,mimeType&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) {
    throw new Error(await driveError(response, "Could not open the Drive folder."));
  }
  return (await response.json()) as DriveFile;
}

async function listDriveFolder(
  folderId: string,
  accessToken: string,
  fetchImpl: typeof fetch
): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId.replaceAll("'", "\\'")}' in parents and trashed = false`,
      fields: "nextPageToken,files(id,name,mimeType,thumbnailLink)",
      pageSize: "1000",
      orderBy: "folder,name",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true"
    });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetchImpl(`${DRIVE_API}/files?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) {
      throw new Error(await driveError(response, "Could not read the Drive folder."));
    }
    const payload = (await response.json()) as DriveListResponse;
    files.push(...(payload.files ?? []));
    pageToken = payload.nextPageToken;
  } while (pageToken);
  return files;
}

async function driveError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as DriveListResponse;
    return payload.error?.message?.trim() || fallback;
  } catch {
    return fallback;
  }
}
