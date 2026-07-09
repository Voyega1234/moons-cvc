export interface VisualAssetCandidate {
  sourceType: "facebook_post" | "facebook_ad";
  sourceUrl: string | null;
  sourceItemId: string | null;
  mediaKind: "image";
  originalImageUrl: string;
  captionContext: string;
  ocrText?: string;
}

export interface NormalizedFacebookPost {
  postUrl: string;
  text: string;
  likes: number;
  shares: number;
  comments: number;
  mediaCount: number;
  imageCount: number;
  rawPayload: unknown;
  visualAssets: readonly VisualAssetCandidate[];
}

export interface NormalizedFacebookAdLibraryItem {
  adArchiveId: string;
  pageId: string | null;
  pageName: string | null;
  adLibraryUrl: string | null;
  pageUrl: string | null;
  isActive: boolean;
  startedAt: string | null;
  endedAt: string | null;
  platforms: readonly string[];
  displayFormat: string | null;
  bodyText: string;
  title: string | null;
  caption: string | null;
  ctaText: string | null;
  ctaType: string | null;
  linkUrl: string | null;
  imageCount: number;
  rawPayload: unknown;
  visualAssets: readonly VisualAssetCandidate[];
}

export function normalizeFacebookPosts(
  payload: unknown
): readonly NormalizedFacebookPost[] {
  if (!Array.isArray(payload)) return [];

  return payload.flatMap((item) => {
    if (!isRecord(item)) return [];

    const postUrl = readString(item.url);
    if (!postUrl) return [];

    const text = readString(item.text) ?? "";
    const mediaItems = Array.isArray(item.media) ? item.media : [];
    const visualAssets = mediaItems.flatMap((media) => {
      const imageUrl = getBestPostImageUrl(media);
      if (!imageUrl) return [];
      const ocrText = readOcrText(media);

      return [
        {
          sourceType: "facebook_post" as const,
          sourceUrl: postUrl,
          sourceItemId: readMediaId(media) ?? postUrl,
          mediaKind: "image" as const,
          originalImageUrl: imageUrl,
          captionContext: text,
          ...(ocrText ? { ocrText } : {})
        }
      ];
    });

    return [
      {
        postUrl,
        text,
        likes: readNonNegativeNumber(item.likes),
        shares: readNonNegativeNumber(item.shares),
        comments: readNonNegativeNumber(item.comments),
        mediaCount: mediaItems.length,
        imageCount: visualAssets.length,
        rawPayload: item,
        visualAssets
      }
    ];
  });
}

export function normalizeFacebookAdsLibraryItems(
  payload: unknown
): readonly NormalizedFacebookAdLibraryItem[] {
  if (!Array.isArray(payload)) return [];

  return payload.flatMap((item) => {
    if (!isRecord(item)) return [];

    const adArchiveId = readString(item.ad_archive_id);
    if (!adArchiveId) return [];

    const snapshot = isRecord(item.snapshot) ? item.snapshot : {};
    const body = isRecord(snapshot.body) ? snapshot.body : {};
    const bodyText = readString(body.text) ?? "";
    const adLibraryUrl = readString(item.ad_library_url);
    const pageUrl =
      readString(item.url) ?? readString(snapshot.page_profile_uri);
    const visualAssets = getAdImageUrls(snapshot).map((imageUrl) => ({
      sourceType: "facebook_ad" as const,
      sourceUrl: adLibraryUrl ?? pageUrl,
      sourceItemId: adArchiveId,
      mediaKind: "image" as const,
      originalImageUrl: imageUrl,
      captionContext: bodyText
    }));

    return [
      {
        adArchiveId,
        pageId: readString(item.page_id) ?? readString(snapshot.page_id),
        pageName: readString(item.page_name) ?? readString(snapshot.page_name),
        adLibraryUrl,
        pageUrl,
        isActive: item.is_active === true,
        startedAt: readUnixSeconds(item.start_date),
        endedAt: readUnixSeconds(item.end_date),
        platforms: readStringArray(item.publisher_platform),
        displayFormat: readString(snapshot.display_format),
        bodyText,
        title: readString(snapshot.title),
        caption: readString(snapshot.caption),
        ctaText: readString(snapshot.cta_text),
        ctaType: readString(snapshot.cta_type),
        linkUrl: readString(snapshot.link_url),
        imageCount: visualAssets.length,
        rawPayload: item,
        visualAssets
      }
    ];
  });
}

export function getBestPostImageUrl(media: unknown): string | null {
  if (!isRecord(media)) return null;

  return (
    readNestedString(media, ["image", "uri"]) ??
    readNestedString(media, ["preferred_thumbnail", "image", "uri"]) ??
    readNestedString(media, ["thumbnailImage", "uri"]) ??
    readString(media.thumbnail)
  );
}

function getAdImageUrls(snapshot: Record<string, unknown>): readonly string[] {
  const urls = [
    ...readImageUrls(snapshot.images),
    ...readVideoPreviewUrls(snapshot.videos),
    ...readImageUrls(snapshot.extra_images)
  ];

  return [...new Set(urls)];
}

function readImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((image) => {
    if (!isRecord(image)) return [];
    const url =
      readString(image.original_image_url) ??
      readString(image.resized_image_url) ??
      readString(image.url);
    return url ? [url] : [];
  });
}

function readVideoPreviewUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((video) => {
    if (!isRecord(video)) return [];
    const url = readString(video.video_preview_image_url);
    return url ? [url] : [];
  });
}

function readMediaId(media: unknown): string | null {
  if (!isRecord(media)) return null;
  return readString(media.id) ?? readString(media.videoId);
}

function readOcrText(media: unknown): string | null {
  if (!isRecord(media)) return null;
  return readString(media.ocrText);
}

function readNestedString(
  value: Record<string, unknown>,
  path: readonly string[]
): string | null {
  let current: unknown = value;

  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }

  return readString(current);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readNonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function readUnixSeconds(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return new Date(value * 1000).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
