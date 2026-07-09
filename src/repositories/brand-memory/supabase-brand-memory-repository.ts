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
  BrandMemoryRepository,
  SaveBrandProductInput,
  SaveBrandRuleInput,
  UpdateBrandProductInput,
  UpdateBrandRuleInput,
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
    description
  }: SaveBrandRuleInput): Promise<LibraryItem> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .schema("moons")
      .from("brand_library")
      .insert({
        client_id: clientId,
        section: "brand",
        title: title.trim(),
        description: description.trim(),
        sort_order: Date.now()
      })
      .select("*")
      .single();

    if (error) throw error;

    return mapLibraryItem(data);
  }

  async updateBrandRule({
    id,
    title,
    description
  }: UpdateBrandRuleInput): Promise<LibraryItem> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .schema("moons")
      .from("brand_library")
      .update({
        title: title.trim(),
        description: description.trim()
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
        sort_order: Date.now()
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

  async listAdsLibraryPastWork(
    clientId: string
  ): Promise<readonly BrandPastWorkItem[]> {
    const client = getSupabaseClient();
    const [assetsResult, adsResult] = await Promise.all([
      client
        .schema("moons")
        .from("brand_visual_assets")
        .select(
          "id, source_item_id, source_url, asset_bucket, asset_storage_path, caption_context, created_at"
        )
        .eq("client_id", clientId)
        .eq("source_type", "facebook_ad")
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
    const assets = selectLatestUniqueAdAssets(assetsResult.data);
    const signedUrls = await Promise.all(
      assets.map(async (asset) => {
        const { data, error } = await client.storage
          .from(asset.asset_bucket)
          .createSignedUrl(asset.asset_storage_path, 60 * 60);

        if (error) throw error;
        return data.signedUrl;
      })
    );

    return assets.map((asset, index) => {
      const ad = asset.source_item_id
        ? adsByArchiveId.get(asset.source_item_id)
        : undefined;

      return {
        id: asset.id,
        title: ad?.title || ad?.page_name || `Ads Library creative ${index + 1}`,
        description: ad?.body_text || asset.caption_context,
        imageUrl: signedUrls[index] ?? "",
        sourceUrl: ad?.ad_library_url || asset.source_url,
        sourceType: "ads_library"
      };
    });
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
