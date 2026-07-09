import type { Brand, BrandLibrary, LibrarySection } from "../../domain/brand";
import type { BrandRepository } from "../../ports/brand-repository";
import { getSupabaseClient } from "../../lib/supabase/client";
import type { Database } from "../../lib/supabase/database.types";

type ClientRow = Database["moons"]["Tables"]["clients"]["Row"];
type LibraryRow = Database["moons"]["Tables"]["brand_library"]["Row"];
type LearningRow = Database["moons"]["Tables"]["brand_learning"]["Row"];
type ProductRow = Database["moons"]["Tables"]["brand_products"]["Row"];

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
      { data: products, error: productsError }
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
          .order("sort_order")
      ]);

    if (libraryError) throw libraryError;
    if (error) throw error;
    if (productsError) throw productsError;

    return clients.map((brand) =>
      mapBrand(brand, library ?? [], learning ?? [], products ?? [])
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
      { data: products, error: productsError }
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
          .order("sort_order")
      ]);

    if (libraryError) throw libraryError;
    if (error) throw error;
    if (productsError) throw productsError;

    return mapBrand(brand, library ?? [], learning ?? [], products ?? []);
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
  productRows: readonly ProductRow[]
): Brand {
  const library = emptyLibrary();

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
    library,
    memory: {
      working: learningRows
        .filter((row) => row.client_id === brand.id && row.polarity === "working")
        .map((row) => row.note),
      avoid: learningRows
        .filter((row) => row.client_id === brand.id && row.polarity === "avoid")
        .map((row) => row.note)
    }
  };
}
