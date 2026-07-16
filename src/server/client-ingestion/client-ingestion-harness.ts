import type {
  NormalizedFacebookAdLibraryItem,
  NormalizedFacebookPost,
  VisualAssetCandidate
} from "../../services/client-ingestion/facebook-source-normalizers.js";
import {
  getFacebookSourceError,
  normalizeFacebookAdsLibraryItems,
  normalizeFacebookPosts
} from "../../services/client-ingestion/facebook-source-normalizers.js";
import type { ApifyClient } from "./apify-client.js";

export type IngestionJobStatus =
  | "queued"
  | "validating_source"
  | "scraping_facebook_posts"
  | "scraping_facebook_ads"
  | "searching_fallback"
  | "mirroring_images"
  | "analyzing_visuals"
  | "analyzing_brand"
  | "writing_memory"
  | "ready"
  | "needs_review"
  | "failed";

export interface ClientIngestionJob {
  id: string;
  clientId: string;
}

export interface ClientIngestionClient {
  id: string;
  name: string;
  facebookUrl: string;
}

export interface SavedBrandSource {
  id: string;
}

export interface SavedSocialPost {
  id: string;
  postUrl: string;
}

export interface SavedAdLibraryItem {
  id: string;
  adArchiveId: string;
}

export interface ManualBrandInput {
  sourceId: string;
  sourceUrl: string | null;
  text: string;
}

export interface MirroredVisualAsset {
  assetBucket: string;
  assetStoragePath: string;
  assetUrl: string | null;
  originalUrlHash: string;
}

export interface MirroredBrandVisualAsset extends MirroredVisualAsset {
  sourceId: string;
  sourceType: VisualAssetCandidate["sourceType"];
  sourceUrl: string | null;
  sourceItemId: string | null;
  captionContext: string;
}

export interface ClientIngestionStore {
  updateJobStatus(input: {
    jobId: string;
    status: IngestionJobStatus;
    currentStep: string;
    sourceStatus?: Record<string, unknown>;
    errorMessage?: string | null;
  }): Promise<void>;

  updateClientStatus(input: {
    clientId: string;
    status: IngestionJobStatus;
    errorMessage?: string | null;
  }): Promise<void>;

  saveBrandSource(input: {
    clientId: string;
    jobId: string;
    sourceType: "facebook_posts" | "facebook_ads_library" | "google_search";
    sourceUrl: string;
    status: "succeeded" | "partial" | "failed";
    rawPayload: unknown;
    errorMessage?: string | null;
  }): Promise<SavedBrandSource>;

  listManualBrandInputs(input: {
    clientId: string;
    jobId: string;
  }): Promise<readonly ManualBrandInput[]>;

  saveSocialPosts(input: {
    clientId: string;
    sourceId: string;
    posts: readonly NormalizedFacebookPost[];
  }): Promise<readonly SavedSocialPost[]>;

  saveAdLibraryItems(input: {
    clientId: string;
    sourceId: string;
    ads: readonly NormalizedFacebookAdLibraryItem[];
  }): Promise<readonly SavedAdLibraryItem[]>;

  saveVisualAsset(input: {
    clientId: string;
    sourceId: string;
    sourceType: VisualAssetCandidate["sourceType"];
    sourceUrl: string | null;
    sourceItemId: string | null;
    mirrored: MirroredVisualAsset;
    captionContext: string;
    ocrText?: string;
  }): Promise<void>;
}

export interface ImageMirror {
  mirror(input: {
    clientId: string;
    jobId: string;
    sourceType: VisualAssetCandidate["sourceType"];
    sourceItemId: string | null;
    index: number;
    imageUrl: string;
  }): Promise<MirroredVisualAsset>;
}

export interface SearchFallbackClient {
  search(input: {
    clientName: string;
    facebookUrl: string;
  }): Promise<unknown>;
}

export interface BrandVisualGuidance {
  mood: string[];
  colorPalette: string[];
  layoutPatterns: string[];
  textOverlay: string[];
  typographyFeel: string[];
  productPersonEnvironment: string[];
  dos: string[];
  donts: string[];
  sourceAssetPaths: string[];
}

export interface BrandSignalAnalysis {
  brandKitEntries: {
    title: string;
    description: string;
  }[];
  learning: {
    polarity: "working" | "avoid";
    note: string;
  }[];
  products: {
    name: string;
    description: string;
    offer: string;
    keyBenefit: string;
    audience: string;
    claimNotes: string;
  }[];
  visualGuidance: BrandVisualGuidance;
  needsReview: boolean;
  reviewReason?: string;
  rawOutput?: unknown;
}

export interface BrandVisualAnalyzer {
  analyze(input: {
    client: ClientIngestionClient;
    visualAssets: readonly MirroredBrandVisualAsset[];
    textEvidence: readonly {
      sourceType: "facebook_post" | "facebook_ad" | "manual_input";
      sourceId: string;
      text: string;
    }[];
    sourceSummary: {
      postsSaved: number;
      adsSaved: number;
      manualInputsSaved: number;
      usedFallbackSearch: boolean;
    };
  }): Promise<BrandSignalAnalysis>;
}

export interface BrandMemoryWriter {
  write(input: {
    clientId: string;
    jobId: string;
    analysis: BrandSignalAnalysis;
  }): Promise<void>;
}

export interface ClientIngestionHarnessDependencies {
  apify: ApifyClient;
  store: ClientIngestionStore;
  imageMirror: ImageMirror;
  searchFallback?: SearchFallbackClient;
  visualAnalyzer?: BrandVisualAnalyzer;
  brandMemoryWriter?: BrandMemoryWriter;
  maxPostImages?: number;
  maxAdImages?: number;
}

export interface ClientIngestionHarnessResult {
  postsSaved: number;
  adsSaved: number;
  visualAssetsMirrored: number;
  usedFallbackSearch: boolean;
  completed: boolean;
}

const FACEBOOK_ACCESS_ERROR = "Please check Facebook page URL.";

export async function runClientIngestionJob(
  job: ClientIngestionJob,
  client: ClientIngestionClient,
  {
    apify,
  store,
  imageMirror,
  searchFallback,
  visualAnalyzer,
  brandMemoryWriter,
  maxPostImages = 6,
  maxAdImages = 6
}: ClientIngestionHarnessDependencies
): Promise<ClientIngestionHarnessResult> {
  await setStatus(store, job, client, "validating_source");

  if (!client.facebookUrl.trim()) {
    await failJob(store, job, client, "Facebook URL is required.");
    return emptyResult(false);
  }

  const sourceStatus: Record<string, unknown> = {};
  let posts: readonly NormalizedFacebookPost[] = [];
  let ads: readonly NormalizedFacebookAdLibraryItem[] = [];
  let postSource: SavedBrandSource | null = null;
  let adSource: SavedBrandSource | null = null;
  let facebookSourceErrorDetected = false;

  await setStatus(store, job, client, "scraping_facebook_posts");
  try {
    const postsPayload = await apify.scrapeFacebookPosts(client.facebookUrl);
    const sourceError = getFacebookSourceError(postsPayload);
    facebookSourceErrorDetected ||= Boolean(sourceError);
    posts = sourceError ? [] : normalizeFacebookPosts(postsPayload);
    postSource = await store.saveBrandSource({
      clientId: client.id,
      jobId: job.id,
      sourceType: "facebook_posts",
      sourceUrl: client.facebookUrl,
      status: sourceError ? "failed" : posts.length ? "succeeded" : "partial",
      rawPayload: postsPayload,
      errorMessage: sourceError
    });
    sourceStatus.facebook_posts = sourceError
      ? "failed"
      : posts.length
        ? "succeeded"
        : "partial";
  } catch (error) {
    sourceStatus.facebook_posts = "failed";
    await store.saveBrandSource({
      clientId: client.id,
      jobId: job.id,
      sourceType: "facebook_posts",
      sourceUrl: client.facebookUrl,
      status: "failed",
      rawPayload: {},
      errorMessage: readableError(error)
    });
  }

  await setStatus(store, job, client, "scraping_facebook_ads", sourceStatus);
  try {
    const adsPayload = await apify.scrapeFacebookAdsLibrary(client.facebookUrl);
    const sourceError = getFacebookSourceError(adsPayload);
    facebookSourceErrorDetected ||= Boolean(sourceError);
    ads = sourceError ? [] : normalizeFacebookAdsLibraryItems(adsPayload);
    adSource = await store.saveBrandSource({
      clientId: client.id,
      jobId: job.id,
      sourceType: "facebook_ads_library",
      sourceUrl: client.facebookUrl,
      status: sourceError ? "failed" : ads.length ? "succeeded" : "partial",
      rawPayload: adsPayload,
      errorMessage: sourceError
    });
    sourceStatus.facebook_ads_library = sourceError
      ? "failed"
      : ads.length
        ? "succeeded"
        : "partial";
  } catch (error) {
    sourceStatus.facebook_ads_library = "failed";
    await store.saveBrandSource({
      clientId: client.id,
      jobId: job.id,
      sourceType: "facebook_ads_library",
      sourceUrl: client.facebookUrl,
      status: "failed",
      rawPayload: {},
      errorMessage: readableError(error)
    });
  }

  let usedFallbackSearch = false;
  if (!posts.length && !ads.length) {
    if (facebookSourceErrorDetected) {
      await failJob(store, job, client, FACEBOOK_ACCESS_ERROR, sourceStatus);
      return emptyResult(false);
    }

    if (!searchFallback) {
      await failJob(store, job, client, FACEBOOK_ACCESS_ERROR, sourceStatus);
      return emptyResult(false);
    }

    await setStatus(store, job, client, "searching_fallback", sourceStatus);
    const searchPayload = await searchFallback.search({
      clientName: client.name,
      facebookUrl: client.facebookUrl
    });
    await store.saveBrandSource({
      clientId: client.id,
      jobId: job.id,
      sourceType: "google_search",
      sourceUrl: client.facebookUrl,
      status: "succeeded",
      rawPayload: searchPayload
    });
    usedFallbackSearch = true;
    sourceStatus.google_search = "succeeded";
  }

  const savedPosts = postSource
    ? await store.saveSocialPosts({
        clientId: client.id,
        sourceId: postSource.id,
        posts
      })
    : [];
  const savedAds = adSource
    ? await store.saveAdLibraryItems({
        clientId: client.id,
        sourceId: adSource.id,
        ads
      })
    : [];

  await setStatus(store, job, client, "mirroring_images", sourceStatus);
  let mirroredVisualAssets: readonly MirroredBrandVisualAsset[];
  try {
    mirroredVisualAssets = await mirrorVisualAssets({
      job,
      client,
      store,
      imageMirror,
      postSource,
      adSource,
      posts,
      ads,
      maxPostImages,
      maxAdImages
    });
  } catch (error) {
    await failJob(store, job, client, readableError(error), {
      ...sourceStatus,
      visual_assets_mirrored: 0,
      brand_memory_written: false
    });
    return {
      postsSaved: savedPosts.length,
      adsSaved: savedAds.length,
      visualAssetsMirrored: 0,
      usedFallbackSearch,
      completed: false
    };
  }
  const visualAssetsMirrored = mirroredVisualAssets.length;
  const manualInputs = await store.listManualBrandInputs({
    clientId: client.id,
    jobId: job.id
  });
  const textEvidence = [
    ...manualInputs.map((input) => ({
      sourceType: "manual_input" as const,
      sourceId: input.sourceId,
      text: input.text
    })),
    ...buildTextEvidence(posts, ads)
  ];

  if (
    visualAnalyzer &&
    brandMemoryWriter &&
    (visualAssetsMirrored > 0 || textEvidence.length > 0)
  ) {
    try {
      await setStatus(store, job, client, "analyzing_visuals", {
        ...sourceStatus,
        visual_assets_mirrored: visualAssetsMirrored
      });
      const analysis = await visualAnalyzer.analyze({
        client,
        visualAssets: mirroredVisualAssets,
        textEvidence,
        sourceSummary: {
          postsSaved: savedPosts.length,
          adsSaved: savedAds.length,
          manualInputsSaved: manualInputs.length,
          usedFallbackSearch
        }
      });

      await setStatus(store, job, client, "writing_memory", {
        ...sourceStatus,
        visual_assets_mirrored: visualAssetsMirrored
      });
      await brandMemoryWriter.write({
        clientId: client.id,
        jobId: job.id,
        analysis
      });

      const finalStatus = analysis.needsReview ? "needs_review" : "ready";
      await setStatus(store, job, client, finalStatus, {
        ...sourceStatus,
        visual_assets_mirrored: visualAssetsMirrored,
        brand_memory_written: true,
        ...(analysis.reviewReason ? { review_reason: analysis.reviewReason } : {})
      });

      return {
        postsSaved: savedPosts.length,
        adsSaved: savedAds.length,
        visualAssetsMirrored,
        usedFallbackSearch,
        completed: !analysis.needsReview
      };
    } catch (error) {
      await failJob(store, job, client, readableError(error), {
        ...sourceStatus,
        visual_assets_mirrored: visualAssetsMirrored,
        brand_memory_written: false
      });
      return {
        postsSaved: savedPosts.length,
        adsSaved: savedAds.length,
        visualAssetsMirrored,
        usedFallbackSearch,
        completed: false
      };
    }
  }

  await setStatus(store, job, client, "needs_review", {
    ...sourceStatus,
    visual_assets_mirrored: visualAssetsMirrored,
    brand_memory_written: false
  });

  return {
    postsSaved: savedPosts.length,
    adsSaved: savedAds.length,
    visualAssetsMirrored,
    usedFallbackSearch,
    completed: false
  };
}

function buildTextEvidence(
  posts: readonly NormalizedFacebookPost[],
  ads: readonly NormalizedFacebookAdLibraryItem[]
): Parameters<BrandVisualAnalyzer["analyze"]>[0]["textEvidence"] {
  const postEvidence = posts
    .filter((post) => post.text.trim())
    .map((post) => ({
      sourceType: "facebook_post" as const,
      sourceId: post.postUrl,
      text: post.text.trim()
    }));
  const adEvidence = ads
    .map((ad) => ({
      sourceType: "facebook_ad" as const,
      sourceId: ad.adArchiveId,
      text: [ad.title, ad.bodyText, ad.caption, ad.ctaText]
        .filter(Boolean)
        .join("\n")
        .trim()
    }))
    .filter((ad) => ad.text);

  return [...postEvidence, ...adEvidence];
}

async function mirrorVisualAssets({
  job,
  client,
  store,
  imageMirror,
  postSource,
  adSource,
  posts,
  ads,
  maxPostImages,
  maxAdImages
}: {
  job: ClientIngestionJob;
  client: ClientIngestionClient;
  store: ClientIngestionStore;
  imageMirror: ImageMirror;
  postSource: SavedBrandSource | null;
  adSource: SavedBrandSource | null;
  posts: readonly NormalizedFacebookPost[];
  ads: readonly NormalizedFacebookAdLibraryItem[];
  maxPostImages: number;
  maxAdImages: number;
}): Promise<readonly MirroredBrandVisualAsset[]> {
  const mirroredAssets: MirroredBrandVisualAsset[] = [];
  const postAssets = posts.flatMap((post) => post.visualAssets).slice(0, maxPostImages);
  const adAssets = ads.flatMap((ad) => ad.visualAssets).slice(0, maxAdImages);
  const candidates = [...postAssets, ...adAssets].map((asset, index) => ({
    asset,
    index
  }));

  for (let offset = 0; offset < candidates.length; offset += 4) {
    const batch = candidates.slice(offset, offset + 4);
    const results = await Promise.all(
      batch.map(async ({ asset, index }) => {
        const sourceId =
          asset.sourceType === "facebook_post" ? postSource?.id : adSource?.id;
        if (!sourceId) return null;

        let mirrored: MirroredVisualAsset;
        try {
          mirrored = await imageMirror.mirror({
            clientId: client.id,
            jobId: job.id,
            sourceType: asset.sourceType,
            sourceItemId: asset.sourceItemId,
            index,
            imageUrl: asset.originalImageUrl
          });
        } catch {
          return null;
        }

        await store.saveVisualAsset({
          clientId: client.id,
          sourceId,
          sourceType: asset.sourceType,
          sourceUrl: asset.sourceUrl,
          sourceItemId: asset.sourceItemId,
          mirrored,
          captionContext: asset.captionContext,
          ...(asset.ocrText ? { ocrText: asset.ocrText } : {})
        });

        return {
          ...mirrored,
          sourceId,
          sourceType: asset.sourceType,
          sourceUrl: asset.sourceUrl,
          sourceItemId: asset.sourceItemId,
          captionContext: asset.captionContext
        } satisfies MirroredBrandVisualAsset;
      })
    );

    mirroredAssets.push(
      ...results.filter(
        (asset): asset is MirroredBrandVisualAsset => asset !== null
      )
    );
    await setStatus(store, job, client, "mirroring_images");
  }

  return mirroredAssets;
}

async function setStatus(
  store: ClientIngestionStore,
  job: ClientIngestionJob,
  client: ClientIngestionClient,
  status: IngestionJobStatus,
  sourceStatus?: Record<string, unknown>
): Promise<void> {
  await Promise.all([
    store.updateJobStatus({
      jobId: job.id,
      status,
      currentStep: status,
      ...(sourceStatus ? { sourceStatus } : {})
    }),
    store.updateClientStatus({ clientId: client.id, status })
  ]);
}

async function failJob(
  store: ClientIngestionStore,
  job: ClientIngestionJob,
  client: ClientIngestionClient,
  errorMessage: string,
  sourceStatus?: Record<string, unknown>
): Promise<void> {
  await Promise.all([
    store.updateJobStatus({
      jobId: job.id,
      status: "failed",
      currentStep: "failed",
      errorMessage,
      ...(sourceStatus ? { sourceStatus } : {})
    }),
    store.updateClientStatus({
      clientId: client.id,
      status: "failed",
      errorMessage
    })
  ]);
}

function emptyResult(usedFallbackSearch: boolean): ClientIngestionHarnessResult {
  return {
    postsSaved: 0,
    adsSaved: 0,
    visualAssetsMirrored: 0,
    usedFallbackSearch,
    completed: false
  };
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown ingestion error.";
}
