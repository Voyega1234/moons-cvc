import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../../lib/supabase/database.types.js";
import type {
  ClientIngestionStore,
  IngestionJobStatus,
  MirroredVisualAsset,
  SavedAdLibraryItem,
  SavedBrandSource,
  SavedSocialPost
} from "./client-ingestion-harness.js";

type BrandSourceInsert =
  Database["moons"]["Tables"]["brand_sources"]["Insert"];
type SocialPostInsert =
  Database["moons"]["Tables"]["brand_social_posts"]["Insert"];
type AdLibraryItemInsert =
  Database["moons"]["Tables"]["brand_ad_library_items"]["Insert"];
type VisualAssetInsert =
  Database["moons"]["Tables"]["brand_visual_assets"]["Insert"];

export class SupabaseClientIngestionStore implements ClientIngestionStore {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async updateJobStatus({
    jobId,
    status,
    currentStep,
    sourceStatus,
    errorMessage = null
  }: {
    jobId: string;
    status: IngestionJobStatus;
    currentStep: string;
    sourceStatus?: Record<string, unknown>;
    errorMessage?: string | null;
  }): Promise<void> {
    const update = {
      status,
      current_step: currentStep,
      ...(sourceStatus ? { source_status: toJson(sourceStatus) } : {}),
      error_message: errorMessage,
      ...(status === "failed" ||
      status === "ready" ||
      status === "needs_review"
        ? { completed_at: new Date().toISOString() }
        : { started_at: new Date().toISOString() })
    };

    const { error } = await this.client
      .schema("moons")
      .from("brand_analysis_jobs")
      .update(update)
      .eq("id", jobId);

    if (error) throw error;
  }

  async updateClientStatus({
    clientId,
    status,
    errorMessage = null
  }: {
    clientId: string;
    status: IngestionJobStatus;
    errorMessage?: string | null;
  }): Promise<void> {
    const { error } = await this.client
      .schema("moons")
      .from("clients")
      .update({
        ingestion_status: status,
        ingestion_error: errorMessage,
        ...(status === "ready" || status === "needs_review"
          ? { last_ingested_at: new Date().toISOString() }
          : {})
      })
      .eq("id", clientId);

    if (error) throw error;
  }

  async saveBrandSource({
    clientId,
    jobId,
    sourceType,
    sourceUrl,
    status,
    rawPayload,
    errorMessage = null
  }: {
    clientId: string;
    jobId: string;
    sourceType: "facebook_posts" | "facebook_ads_library" | "google_search";
    sourceUrl: string;
    status: "succeeded" | "partial" | "failed";
    rawPayload: unknown;
    errorMessage?: string | null;
  }): Promise<SavedBrandSource> {
    const row: BrandSourceInsert = {
      client_id: clientId,
      job_id: jobId,
      source_type: sourceType,
      source_url: sourceUrl,
      status,
      raw_payload: toJson(rawPayload),
      error_message: errorMessage
    };

    const { data, error } = await this.client
      .schema("moons")
      .from("brand_sources")
      .insert(row)
      .select("id")
      .single();

    if (error) throw error;

    return { id: data.id };
  }

  async saveSocialPosts({
    clientId,
    sourceId,
    posts
  }: Parameters<ClientIngestionStore["saveSocialPosts"]>[0]): Promise<
    readonly SavedSocialPost[]
  > {
    if (!posts.length) return [];

    const rows: SocialPostInsert[] = posts.map((post) => ({
      client_id: clientId,
      source_id: sourceId,
      post_url: post.postUrl,
      text: post.text,
      likes: post.likes,
      shares: post.shares,
      comments: post.comments,
      media_count: post.mediaCount,
      image_count: post.imageCount,
      raw_payload: toJson(post.rawPayload)
    }));

    const { data, error } = await this.client
      .schema("moons")
      .from("brand_social_posts")
      .upsert(rows, { onConflict: "source_id,post_url" })
      .select("id, post_url");

    if (error) throw error;

    return data.map((row) => ({ id: row.id, postUrl: row.post_url }));
  }

  async saveAdLibraryItems({
    clientId,
    sourceId,
    ads
  }: Parameters<ClientIngestionStore["saveAdLibraryItems"]>[0]): Promise<
    readonly SavedAdLibraryItem[]
  > {
    if (!ads.length) return [];

    const rows: AdLibraryItemInsert[] = ads.map((ad) => ({
      client_id: clientId,
      source_id: sourceId,
      ad_archive_id: ad.adArchiveId,
      page_id: ad.pageId,
      page_name: ad.pageName,
      ad_library_url: ad.adLibraryUrl,
      page_url: ad.pageUrl,
      is_active: ad.isActive,
      started_at: ad.startedAt,
      ended_at: ad.endedAt,
      platforms: [...ad.platforms],
      display_format: ad.displayFormat,
      body_text: ad.bodyText,
      title: ad.title,
      caption: ad.caption,
      cta_text: ad.ctaText,
      cta_type: ad.ctaType,
      link_url: ad.linkUrl,
      image_count: ad.imageCount,
      raw_payload: toJson(ad.rawPayload)
    }));

    const { data, error } = await this.client
      .schema("moons")
      .from("brand_ad_library_items")
      .upsert(rows, { onConflict: "source_id,ad_archive_id" })
      .select("id, ad_archive_id");

    if (error) throw error;

    return data.map((row) => ({
      id: row.id,
      adArchiveId: row.ad_archive_id
    }));
  }

  async saveVisualAsset({
    clientId,
    sourceId,
    sourceType,
    sourceUrl,
    sourceItemId,
    mirrored,
    captionContext,
    ocrText
  }: {
    clientId: string;
    sourceId: string;
    sourceType: "facebook_post" | "facebook_ad";
    sourceUrl: string | null;
    sourceItemId: string | null;
    mirrored: MirroredVisualAsset;
    captionContext: string;
    ocrText?: string;
  }): Promise<void> {
    const row: VisualAssetInsert = {
      client_id: clientId,
      source_id: sourceId,
      source_type: sourceType,
      source_url: sourceUrl,
      source_item_id: sourceItemId,
      media_kind: "image",
      original_url_hash: mirrored.originalUrlHash,
      asset_bucket: mirrored.assetBucket,
      asset_storage_path: mirrored.assetStoragePath,
      asset_url: mirrored.assetUrl,
      caption_context: captionContext,
      ocr_text: ocrText ?? null,
      analysis_status: "pending"
    };

    const { error } = await this.client
      .schema("moons")
      .from("brand_visual_assets")
      .upsert(row, { onConflict: "asset_bucket,asset_storage_path" });

    if (error) throw error;
  }
}

export function toJson(value: unknown): Json {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as Json;
}
