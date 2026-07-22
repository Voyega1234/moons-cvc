import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../config/env";
import type { LibraryItem } from "../../domain/brand";
import {
  isBrandDocumentType,
  type BrandDocument,
  type BrandDocumentType,
  type BrandPastWorkItem,
  type BrandProduct
} from "../../domain/brand-memory";
import { getSupabaseClient } from "../../lib/supabase/client";
import type { Database } from "../../lib/supabase/database.types";
import type {
  AnalyzeGuidelineInput,
  BrandMemoryRepository,
  CreateLearningEntryInput,
  CreateReferenceImageInput,
  GuidelineAnalysisResult,
  SaveBrandProductInput,
  SaveBrandRuleInput,
  SaveGuidelineInput,
  UpdateBrandProductInput,
  UpdateBrandRuleInput,
  UpdateGuidelineInput,
  UploadBrandDocumentInput
} from "../../ports/brand-memory-repository";

type BrandLibraryRow = Database["moons"]["Tables"]["brand_library"]["Row"];
type BrandDocumentRow =
  Database["moons"]["Tables"]["brand_documents"]["Row"];
type BrandProductRow = Database["moons"]["Tables"]["brand_products"]["Row"];

const MAX_DOCUMENT_SIZE_BYTES = 50 * 1024 * 1024;
const ALLOWED_DOCUMENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
]);
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const ASSET_SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
const MAX_GUIDELINE_SIZE_BYTES = 20 * 1024 * 1024;
const ALLOWED_GUIDELINE_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp"
]);

// `sort_order` columns are `integer` (max ~2.1 billion); Date.now() (ms since
// epoch) overflows that, so use seconds instead.
function nextSortOrder(): number {
  return Math.floor(Date.now() / 1000);
}

export class SupabaseBrandMemoryRepository implements BrandMemoryRepository {
  async listBrandRules(clientId: string): Promise<readonly LibraryItem[]> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .schema("moons")
      .from("brand_library")
      .select("*")
      .eq("client_id", clientId)
      .eq("section", "brand")
      .order("sort_order")
      .order("created_at");

    if (error) throw error;

    return data.map(mapLibraryItem);
  }

  async createBrandRule({
    clientId,
    title,
    description,
    assetFile
  }: SaveBrandRuleInput): Promise<LibraryItem> {
    const client = getSupabaseClient();
    const assetUrl = assetFile
      ? await uploadBrandImage(client, clientId, assetFile)
      : undefined;

    const { data, error } = await client
      .schema("moons")
      .from("brand_library")
      .insert({
        client_id: clientId,
        section: "brand",
        title: title.trim(),
        description: description.trim(),
        sort_order: nextSortOrder(),
        ...(assetUrl ? { asset_url: assetUrl } : {})
      })
      .select("*")
      .single();

    if (error) throw error;

    return mapLibraryItem(data);
  }

  async updateBrandRule({
    id,
    title,
    description,
    assetFile
  }: UpdateBrandRuleInput): Promise<LibraryItem> {
    const client = getSupabaseClient();
    const { data: existing, error: existingError } = await client
      .schema("moons")
      .from("brand_library")
      .select("client_id")
      .eq("id", id)
      .single();
    if (existingError) throw existingError;

    const assetUrl = assetFile
      ? await uploadBrandImage(client, existing.client_id, assetFile)
      : undefined;

    const { data, error } = await client
      .schema("moons")
      .from("brand_library")
      .update({
        title: title.trim(),
        description: description.trim(),
        ...(assetUrl ? { asset_url: assetUrl } : {})
      })
      .eq("id", id)
      .eq("section", "brand")
      .select("*")
      .single();

    if (error) throw error;

    return mapLibraryItem(data);
  }

  async deleteBrandRule(id: string): Promise<void> {
    const client = getSupabaseClient();
    const { error } = await client
      .schema("moons")
      .from("brand_library")
      .delete()
      .eq("id", id)
      .eq("section", "brand");

    if (error) throw error;
  }

  async listGuidelines(clientId: string): Promise<readonly LibraryItem[]> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .schema("moons")
      .from("brand_library")
      .select("*")
      .eq("client_id", clientId)
      .eq("section", "docs")
      .order("sort_order")
      .order("created_at");

    if (error) throw error;
    return data.map(mapLibraryItem);
  }

  async createGuideline({
    clientId,
    title,
    description
  }: SaveGuidelineInput): Promise<LibraryItem> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .schema("moons")
      .from("brand_library")
      .insert({
        client_id: clientId,
        section: "docs",
        title: title.trim(),
        description: description.trim(),
        sort_order: nextSortOrder()
      })
      .select("*")
      .single();

    if (error) throw error;
    return mapLibraryItem(data);
  }

  async updateGuideline({
    id,
    title,
    description
  }: UpdateGuidelineInput): Promise<LibraryItem> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .schema("moons")
      .from("brand_library")
      .update({ title: title.trim(), description: description.trim() })
      .eq("id", id)
      .eq("section", "docs")
      .select("*")
      .single();

    if (error) throw error;
    return mapLibraryItem(data);
  }

  async deleteGuideline(id: string): Promise<void> {
    const client = getSupabaseClient();
    const { error } = await client
      .schema("moons")
      .from("brand_library")
      .delete()
      .eq("id", id)
      .eq("section", "docs");

    if (error) throw error;
  }

  async listProducts(clientId: string): Promise<readonly BrandProduct[]> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .schema("moons")
      .from("brand_products")
      .select("*")
      .eq("client_id", clientId)
      .eq("is_active", true)
      .order("sort_order")
      .order("created_at");

    if (error) throw error;
    return data.map(mapProduct);
  }

  async createProduct(
    input: SaveBrandProductInput
  ): Promise<BrandProduct> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .schema("moons")
      .from("brand_products")
      .insert({
        client_id: input.clientId,
        name: input.name.trim(),
        description: input.description.trim(),
        offer: nullable(input.offer),
        key_benefit: nullable(input.keyBenefit),
        audience: nullable(input.audience),
        claim_notes: nullable(input.claimNotes),
        sort_order: nextSortOrder()
      })
      .select("*")
      .single();

    if (error) throw error;
    return mapProduct(data);
  }

  async updateProduct(
    input: UpdateBrandProductInput
  ): Promise<BrandProduct> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .schema("moons")
      .from("brand_products")
      .update({
        name: input.name.trim(),
        description: input.description.trim(),
        offer: nullable(input.offer),
        key_benefit: nullable(input.keyBenefit),
        audience: nullable(input.audience),
        claim_notes: nullable(input.claimNotes)
      })
      .eq("id", input.id)
      .select("*")
      .single();

    if (error) throw error;
    return mapProduct(data);
  }

  async deleteProduct(id: string): Promise<void> {
    const client = getSupabaseClient();
    const { error } = await client
      .schema("moons")
      .from("brand_products")
      .delete()
      .eq("id", id);

    if (error) throw error;
  }

  async listPastWork(
    clientId: string
  ): Promise<readonly BrandPastWorkItem[]> {
    const client = getSupabaseClient();
    const [assetsResult, postsResult, adsResult] = await Promise.all([
      client
        .schema("moons")
        .from("brand_visual_assets")
        .select(
          "id, source_type, source_item_id, source_url, asset_bucket, asset_storage_path, caption_context, created_at"
        )
        .eq("client_id", clientId)
        .in("source_type", ["facebook_post", "facebook_ad"])
        .order("created_at", { ascending: false })
        .limit(200),
      client
        .schema("moons")
        .from("brand_social_posts")
        .select("id, post_url, text, created_at")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(100),
      client
        .schema("moons")
        .from("brand_ad_library_items")
        .select(
          "ad_archive_id, page_name, title, body_text, ad_library_url, created_at"
        )
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
    ]);

    if (assetsResult.error) throw assetsResult.error;
    if (postsResult.error) throw postsResult.error;
    if (adsResult.error) throw adsResult.error;

    const adsByArchiveId = new Map<
      string,
      (typeof adsResult.data)[number]
    >();
    for (const ad of adsResult.data) {
      if (!adsByArchiveId.has(ad.ad_archive_id)) {
        adsByArchiveId.set(ad.ad_archive_id, ad);
      }
    }
    const assets = selectLatestUniquePastWorkAssets(assetsResult.data);
    const imageUrlByAssetId = await resolvePastWorkSignedUrls(
      assets,
      async (asset) => {
        const { data, error } = await client.storage
          .from(asset.asset_bucket)
          .createSignedUrl(asset.asset_storage_path, 60 * 60);

        if (error) throw error;
        return data.signedUrl;
      }
    );
    const postAssetByUrl = new Map(
      assets
        .filter(
          (asset) => asset.source_type === "facebook_post" && asset.source_url
        )
        .map((asset) => [asset.source_url as string, asset])
    );
    const seenPostUrls = new Set<string>();
    const posts = postsResult.data
      .filter((post) => {
        if (seenPostUrls.has(post.post_url)) return false;
        seenPostUrls.add(post.post_url);
        return hasUsablePastWorkPost(
          post,
          postAssetByUrl.has(post.post_url)
        );
      })
      .slice(0, 12)
      .map((post, index) => {
        const asset = postAssetByUrl.get(post.post_url);
        return {
          id: `facebook-post-${post.id}`,
          title: `Facebook post ${index + 1}`,
          description: post.text || asset?.caption_context || "",
          imageUrl: asset ? imageUrlByAssetId.get(asset.id) ?? null : null,
          sourceUrl: post.post_url,
          sourceType: "facebook_post" as const
        };
      });

    const ads = assets
      .filter((asset) => asset.source_type === "facebook_ad")
      .map((asset, index) => {
        const ad = asset.source_item_id
          ? adsByArchiveId.get(asset.source_item_id)
          : undefined;

        return {
          id: asset.id,
          title:
            ad?.title || ad?.page_name || `Ads Library creative ${index + 1}`,
          description: ad?.body_text || asset.caption_context,
          imageUrl: imageUrlByAssetId.get(asset.id) ?? null,
          sourceUrl: ad?.ad_library_url || asset.source_url,
          sourceType: "ads_library" as const
        };
      });

    return [...posts, ...ads];
  }

  async listDocuments(clientId: string): Promise<readonly BrandDocument[]> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .schema("moons")
      .from("brand_documents")
      .select("*")
      .eq("client_id", clientId)
      .order("uploaded_at", { ascending: false });

    if (error) throw error;

    return data.map(mapDocument);
  }

  async uploadDocument({
    clientId,
    file,
    documentType
  }: UploadBrandDocumentInput): Promise<BrandDocument> {
    validateDocument(file);

    const client = getSupabaseClient();
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError) throw userError;
    if (!userData.user) throw new Error("Sign in before uploading documents.");

    const storagePath = `${clientId}/documents/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    const uploadResult = await client.storage
      .from(env.brandAssetsBucket)
      .upload(storagePath, file, {
        contentType: file.type || undefined,
        upsert: false
      });

    if (uploadResult.error) throw uploadResult.error;

    const { data, error } = await client
      .schema("moons")
      .from("brand_documents")
      .insert({
        client_id: clientId,
        title: file.name,
        document_type: documentType,
        storage_path: storagePath,
        mime_type: file.type || null,
        processing_status: "uploaded",
        usable_for_ai: false,
        uploaded_by: userData.user.id
      })
      .select("*")
      .single();

    if (error) {
      await client.storage.from(env.brandAssetsBucket).remove([storagePath]);
      throw error;
    }

    return mapDocument(data);
  }

  async createLearningEntry({
    clientId,
    polarity,
    note,
    sourceRunId
  }: CreateLearningEntryInput): Promise<void> {
    const client = getSupabaseClient();
    const { error } = await client
      .schema("moons")
      .from("brand_learning")
      .insert({
        client_id: clientId,
        polarity,
        note: note.trim(),
        ...(sourceRunId ? { source_run_id: sourceRunId } : {})
      });

    if (error) throw error;
  }

  async createReferenceImage({
    clientId,
    file,
    label
  }: CreateReferenceImageInput): Promise<LibraryItem> {
    const client = getSupabaseClient();
    const assetUrl = await uploadBrandImage(client, clientId, file);

    const { data, error } = await client
      .schema("moons")
      .from("brand_library")
      .insert({
        client_id: clientId,
        section: "refs",
        title: label?.trim() || file.name,
        description: "",
        sort_order: nextSortOrder(),
        asset_url: assetUrl
      })
      .select("*")
      .single();

    if (error) throw error;
    return mapLibraryItem(data);
  }

  async analyzeGuideline(input: AnalyzeGuidelineInput): Promise<GuidelineAnalysisResult> {
    if (input.text !== undefined) {
      return callGuidelineAnalysisEndpoint({ text: input.text });
    }

    const { clientId, file } = input;
    if (file.size > MAX_GUIDELINE_SIZE_BYTES) {
      throw new Error("Guideline file is too large. Maximum upload size is 20MB.");
    }
    if (file.type && !ALLOWED_GUIDELINE_TYPES.has(file.type)) {
      throw new Error("Upload a PDF, PNG, JPEG, or WEBP guideline file.");
    }

    const client = getSupabaseClient();
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError) throw userError;
    if (!userData.user) throw new Error("Sign in before uploading documents.");

    // Same storage path convention as uploadDocument() so this also appears
    // in the Documents tab, not just Brand kit.
    const storagePath = `${clientId}/documents/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    const uploadResult = await client.storage
      .from(env.brandAssetsBucket)
      .upload(storagePath, file, {
        contentType: file.type || undefined,
        upsert: false
      });
    if (uploadResult.error) throw uploadResult.error;

    const { data: documentRow, error: documentError } = await client
      .schema("moons")
      .from("brand_documents")
      .insert({
        client_id: clientId,
        title: file.name,
        document_type: "brand_guideline",
        storage_path: storagePath,
        mime_type: file.type || null,
        processing_status: "uploaded",
        usable_for_ai: false,
        uploaded_by: userData.user.id
      })
      .select("id")
      .single();
    if (documentError) {
      await client.storage.from(env.brandAssetsBucket).remove([storagePath]);
      throw documentError;
    }

    const signedUrlResult = await client.storage
      .from(env.brandAssetsBucket)
      .createSignedUrl(storagePath, ASSET_SIGNED_URL_EXPIRES_IN_SECONDS);
    if (signedUrlResult.error) throw signedUrlResult.error;

    try {
      const result = await callGuidelineAnalysisEndpoint({
        fileUrl: signedUrlResult.data.signedUrl,
        mimeType: file.type || "application/octet-stream"
      });

      await client
        .schema("moons")
        .from("brand_documents")
        .update({ processing_status: "ready_for_ai", usable_for_ai: true })
        .eq("id", documentRow.id);

      return result;
    } catch (error) {
      await client
        .schema("moons")
        .from("brand_documents")
        .update({ processing_status: "failed" })
        .eq("id", documentRow.id);
      throw error;
    }
  }
}

async function callGuidelineAnalysisEndpoint(
  body: { text: string } | { fileUrl: string; mimeType: string }
): Promise<GuidelineAnalysisResult> {
  const client = getSupabaseClient();
  const { data: sessionData } = await client.auth.getSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (sessionData.session?.access_token) {
    headers.Authorization = `Bearer ${sessionData.session.access_token}`;
  }

  const response = await fetch(env.guidelineAnalysisEndpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  const text = await response.text();
  if (!text.trim()) {
    throw new Error("Guideline analysis returned an empty response.");
  }

  const payload = JSON.parse(text) as {
    ok?: boolean;
    summary?: string;
    generationContext?: string;
    primaryColors?: string[];
    secondaryColors?: string[];
    error?: string;
  };

  if (!response.ok || !payload.ok) {
    throw new Error(
      payload.error ?? `Guideline analysis failed (${response.status}).`
    );
  }

  return {
    summary: payload.summary ?? "",
    generationContext: payload.generationContext ?? "",
    primaryColors: payload.primaryColors ?? [],
    secondaryColors: payload.secondaryColors ?? []
  };
}

export function selectLatestUniqueAdAssets<
  T extends { source_item_id: string | null }
>(assets: readonly T[], limit = 12): T[] {
  const seenAdIds = new Set<string>();

  return assets
    .filter((asset) => {
      const adId = asset.source_item_id;
      if (!adId || seenAdIds.has(adId)) return false;
      seenAdIds.add(adId);
      return true;
    })
    .slice(0, limit);
}

export function selectLatestUniquePastWorkAssets<
  T extends {
    source_type: "facebook_post" | "facebook_ad" | "google_search";
    source_item_id: string | null;
    source_url: string | null;
  }
>(assets: readonly T[], limitPerType = 12): T[] {
  const seen = new Set<string>();
  const counts = { facebook_post: 0, facebook_ad: 0 };

  return assets.filter((asset) => {
    if (asset.source_type === "google_search") return false;
    const sourceKey =
      asset.source_type === "facebook_post"
        ? asset.source_url ?? asset.source_item_id
        : asset.source_item_id ?? asset.source_url;
    if (!sourceKey || counts[asset.source_type] >= limitPerType) return false;

    const key = `${asset.source_type}:${sourceKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    counts[asset.source_type] += 1;
    return true;
  });
}

export async function resolvePastWorkSignedUrls<
  T extends { id: string }
>(
  assets: readonly T[],
  signAsset: (asset: T) => Promise<string>
): Promise<Map<string, string | null>> {
  const resolved = await Promise.all(
    assets.map(async (asset) => {
      try {
        return await signAsset(asset);
      } catch {
        return null;
      }
    })
  );

  return new Map(
    assets.map((asset, index) => [asset.id, resolved[index] ?? null])
  );
}

export function hasUsablePastWorkPost(
  post: { text: string | null },
  hasVisualAsset: boolean
): boolean {
  return Boolean(post.text?.trim()) || hasVisualAsset;
}

function mapLibraryItem(row: BrandLibraryRow): LibraryItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    ...(row.asset_url ? { assetUrl: row.asset_url } : {})
  };
}

function mapDocument(row: BrandDocumentRow): BrandDocument {
  return {
    id: row.id,
    clientId: row.client_id,
    title: row.title,
    documentType: mapDocumentType(row.document_type),
    fileUrl: row.file_url,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    processingStatus: row.processing_status,
    usableForAi: row.usable_for_ai,
    uploadedAt: row.uploaded_at
  };
}

function mapProduct(row: BrandProductRow): BrandProduct {
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    description: row.description,
    offer: row.offer ?? "",
    keyBenefit: row.key_benefit ?? "",
    audience: row.audience ?? "",
    claimNotes: row.claim_notes ?? "",
    price: row.price ?? "",
    landingUrl: row.landing_url ?? "",
    isActive: row.is_active,
    sortOrder: row.sort_order
  };
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function mapDocumentType(documentType: string): BrandDocumentType {
  return isBrandDocumentType(documentType) ? documentType : "other";
}

function validateDocument(file: File): void {
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    throw new Error("File is too large. Maximum upload size is 50MB.");
  }

  if (file.type && !ALLOWED_DOCUMENT_TYPES.has(file.type)) {
    throw new Error("This file type is not supported yet.");
  }
}

function safeFileName(fileName: string): string {
  return fileName
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

async function uploadBrandImage(
  client: SupabaseClient<Database>,
  clientId: string,
  file: File
): Promise<string> {
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error("Image is too large. Maximum upload size is 10MB.");
  }
  if (file.type && !ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Upload a PNG, JPEG, or WEBP image.");
  }

  const storagePath = `${clientId}/brand-kit/${crypto.randomUUID()}-${safeFileName(file.name)}`;
  const uploadResult = await client.storage
    .from(env.brandAssetsBucket)
    .upload(storagePath, file, {
      contentType: file.type || undefined,
      upsert: false
    });
  if (uploadResult.error) throw uploadResult.error;

  const signedUrlResult = await client.storage
    .from(env.brandAssetsBucket)
    .createSignedUrl(storagePath, ASSET_SIGNED_URL_EXPIRES_IN_SECONDS);
  if (signedUrlResult.error) {
    await client.storage.from(env.brandAssetsBucket).remove([storagePath]);
    throw signedUrlResult.error;
  }

  return signedUrlResult.data.signedUrl;
}
