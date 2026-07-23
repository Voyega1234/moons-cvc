import type {
  Brand,
  BrandLibrary,
  LibrarySection,
  QuestionnaireExtractedField
} from "../../domain/brand";
import type { BrandRepository } from "../../ports/brand-repository";
import { getSupabaseClient } from "../../lib/supabase/client";
import type { Database, Json } from "../../lib/supabase/database.types";

type ClientRow = Database["moons"]["Tables"]["clients"]["Row"];
type LibraryRow = Database["moons"]["Tables"]["brand_library"]["Row"];
type LearningRow = Database["moons"]["Tables"]["brand_learning"]["Row"];
type ProductRow = Database["moons"]["Tables"]["brand_products"]["Row"];
type BrandSourceRow = Database["moons"]["Tables"]["brand_sources"]["Row"];

export class SupabaseBrandRepository implements BrandRepository {
  async list(): Promise<readonly Brand[]> {
    const client = getSupabaseClient();
    const schema = client.schema("moons");
    const { data: clients, error: clientsError } = await schema
      .from("clients")
      .select("*")
      .eq("is_active", true)
      .order("name");

    if (clientsError) throw clientsError;
    if (!clients.length) return [];

    const clientIds = clients.map((brand) => brand.id);
    const [
      { data: library, error: libraryError },
      { data: learning, error },
      { data: products, error: productsError },
      { data: sources, error: sourcesError }
    ] = await Promise.all([
        client
          .schema("moons")
          .from("brand_library")
          .select("*")
          .in("client_id", clientIds)
          .order("sort_order"),
        client
          .schema("moons")
          .from("brand_learning")
          .select("*")
          .in("client_id", clientIds)
          .order("created_at", { ascending: false }),
        client
          .schema("moons")
          .from("brand_products")
          .select("*")
          .in("client_id", clientIds)
          .eq("is_active", true)
          .order("sort_order"),
        client
          .schema("moons")
          .from("brand_sources")
          .select("*")
          .in("client_id", clientIds)
          .eq("source_type", "manual_input")
          .order("collected_at", { ascending: false })
      ]);

    if (libraryError) throw libraryError;
    if (error) throw error;
    if (productsError) throw productsError;
    if (sourcesError) throw sourcesError;

    return clients.map((brand) =>
      mapBrand(
        brand,
        library ?? [],
        learning ?? [],
        products ?? [],
        sources ?? []
      )
    );
  }

  async getById(id: string): Promise<Brand | null> {
    const client = getSupabaseClient();
    const schema = client.schema("moons");
    const { data: brand, error: brandError } = await schema
      .from("clients")
      .select("*")
      .eq("id", id)
      .eq("is_active", true)
      .maybeSingle();

    if (brandError) throw brandError;
    if (!brand) return null;

    const [
      { data: library, error: libraryError },
      { data: learning, error },
      { data: products, error: productsError },
      { data: sources, error: sourcesError }
    ] = await Promise.all([
        client
          .schema("moons")
          .from("brand_library")
          .select("*")
          .eq("client_id", id)
          .order("sort_order"),
        client
          .schema("moons")
          .from("brand_learning")
          .select("*")
          .eq("client_id", id)
          .order("created_at", { ascending: false }),
        client
          .schema("moons")
          .from("brand_products")
          .select("*")
          .eq("client_id", id)
          .eq("is_active", true)
          .order("sort_order"),
        client
          .schema("moons")
          .from("brand_sources")
          .select("*")
          .eq("client_id", id)
          .eq("source_type", "manual_input")
          .order("collected_at", { ascending: false })
      ]);

    if (libraryError) throw libraryError;
    if (error) throw error;
    if (productsError) throw productsError;
    if (sourcesError) throw sourcesError;

    return mapBrand(
      brand,
      library ?? [],
      learning ?? [],
      products ?? [],
      sources ?? []
    );
  }
}

function emptyLibrary(): BrandLibrary {
  return {
    brand: [],
    products: [],
    docs: [],
    refs: []
  };
}

function mapBrand(
  brand: ClientRow,
  libraryRows: readonly LibraryRow[],
  learningRows: readonly LearningRow[],
  productRows: readonly ProductRow[],
  sourceRows: readonly BrandSourceRow[]
): Brand {
  const library = emptyLibrary();
  const onboardingQuestionnaire = mapOnboardingQuestionnaire(
    brand.id,
    sourceRows
  );

  for (const row of libraryRows) {
    if (row.client_id !== brand.id) continue;
    const section = row.section as LibrarySection;
    library[section] = [
      ...library[section],
      {
        id: row.id,
        title: row.title,
        description: row.description,
        ...(row.asset_url ? { assetUrl: row.asset_url } : {})
      }
    ];
  }

  library.products = productRows
    .filter((row) => row.client_id === brand.id)
    .map((row) => ({
      id: row.id,
      title: row.name,
      description: [
        row.offer ? `Offer: ${row.offer}` : "",
        row.key_benefit ? `Benefit: ${row.key_benefit}` : "",
        row.audience ? `Audience: ${row.audience}` : "",
        row.claim_notes ? `Claim notes: ${row.claim_notes}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    }));

  return {
    id: brand.id,
    name: brand.name,
    category: brand.category,
    initials: brand.initials,
    ...(brand.facebook_url ? { facebookUrl: brand.facebook_url } : {}),
    ingestionStatus: brand.ingestion_status,
    ...(brand.ingestion_error ? { ingestionError: brand.ingestion_error } : {}),
    ingestionUpdatedAt: brand.updated_at,
    library,
    memory: {
      working: learningRows
        .filter((row) => row.client_id === brand.id && row.polarity === "working")
        .map((row) => row.note),
      avoid: learningRows
        .filter((row) => row.client_id === brand.id && row.polarity === "avoid")
        .map((row) => row.note)
    },
    ...(onboardingQuestionnaire ? { onboardingQuestionnaire } : {})
  };
}

function mapOnboardingQuestionnaire(
  clientId: string,
  rows: readonly BrandSourceRow[]
): Brand["onboardingQuestionnaire"] {
  for (const row of rows) {
    if (row.client_id !== clientId || !isJsonRecord(row.raw_payload)) continue;
    const kind = row.raw_payload.kind;
    const text = row.raw_payload.text;
    if (
      (kind !== "onboarding_questionnaire" &&
        kind !== "mapping_questionnaire") ||
      typeof text !== "string" ||
      !text.trim()
    ) {
      continue;
    }

    const normalizedText = text.trim();
    const sheetTitle =
      typeof row.raw_payload.sheetTitle === "string"
        ? row.raw_payload.sheetTitle.trim()
        : "";
    const extractedFields = mapQuestionnaireExtractedFields(
      row.raw_payload.extractedFields
    );
    return {
      ...(row.source_url ? { sourceUrl: row.source_url } : {}),
      text: normalizedText,
      preview: normalizedText.slice(0, 280),
      facebookUrls: [],
      ...(sheetTitle ? { sheetTitle } : {}),
      ...(extractedFields.length ? { extractedFields } : {})
    };
  }

  return undefined;
}

function mapQuestionnaireExtractedFields(
  value: Json | undefined
): readonly QuestionnaireExtractedField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((field) => {
    if (
      !isJsonRecord(field) ||
      typeof field.key !== "string" ||
      typeof field.label !== "string" ||
      typeof field.value !== "string"
    ) {
      return [];
    }
    return [
      {
        key: field.key,
        label: field.label,
        value: field.value
      }
    ];
  });
}

function isJsonRecord(value: Json): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
