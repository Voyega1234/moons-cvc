import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/database.types.js";
import type {
  BrandMemoryWriter,
  BrandSignalAnalysis,
  BrandVisualGuidance
} from "./client-ingestion-harness.js";

type BrandLibraryInsert =
  Database["moons"]["Tables"]["brand_library"]["Insert"];
type BrandLearningInsert =
  Database["moons"]["Tables"]["brand_learning"]["Insert"];
type BrandProductInsert =
  Database["moons"]["Tables"]["brand_products"]["Insert"];

export class SupabaseBrandMemoryWriter implements BrandMemoryWriter {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async write({
    clientId,
    jobId,
    analysis
  }: Parameters<BrandMemoryWriter["write"]>[0]): Promise<void> {
    const libraryRows = buildBrandLibraryRows(clientId, jobId, analysis);
    const learningRows = buildBrandLearningRows(clientId, jobId, analysis);

    if (libraryRows.length) {
      const { error } = await this.client
        .schema("moons")
        .from("brand_library")
        .insert(libraryRows);

      if (error) throw error;
    }

    if (learningRows.length) {
      const { error } = await this.client
        .schema("moons")
        .from("brand_learning")
        .insert(learningRows);

      if (error) throw error;
    }

    await this.writeProducts(clientId, analysis);
    await this.deletePreviousGeneratedMemory(clientId, jobId);
  }

  private async writeProducts(
    clientId: string,
    analysis: BrandSignalAnalysis
  ): Promise<void> {
    if (!analysis.products.length) return;

    const { data: existing, error: existingError } = await this.client
      .schema("moons")
      .from("brand_products")
      .select("name")
      .eq("client_id", clientId);

    if (existingError) throw existingError;

    const rows = buildBrandProductRows(
      clientId,
      analysis,
      existing.map((product) => product.name)
    );

    if (!rows.length) return;

    const { error } = await this.client
      .schema("moons")
      .from("brand_products")
      .insert(rows);

    if (error) throw error;
  }

  private async deletePreviousGeneratedMemory(
    clientId: string,
    currentJobId: string
  ): Promise<void> {
    const generatedPattern = "%Source: brand_analysis_jobs/%";
    const currentJobPattern = `%Source: brand_analysis_jobs/${currentJobId}%`;
    const [libraryResult, learningResult] = await Promise.all([
      this.client
        .schema("moons")
        .from("brand_library")
        .delete()
        .eq("client_id", clientId)
        .like("description", generatedPattern)
        .not("description", "like", currentJobPattern),
      this.client
        .schema("moons")
        .from("brand_learning")
        .delete()
        .eq("client_id", clientId)
        .like("note", generatedPattern)
        .not("note", "like", currentJobPattern)
    ]);

    if (libraryResult.error) throw libraryResult.error;
    if (learningResult.error) throw learningResult.error;
  }
}

export function buildBrandProductRows(
  clientId: string,
  analysis: BrandSignalAnalysis,
  existingProductNames: readonly string[]
): BrandProductInsert[] {
  const existingNames = new Set(
    existingProductNames.map(normalizeProductName)
  );

  return analysis.products
    .filter(
      (product) => !existingNames.has(normalizeProductName(product.name))
    )
    .map((product, index) => ({
      client_id: clientId,
      name: product.name.trim(),
      description: product.description.trim(),
      offer: nullable(product.offer),
      key_benefit: nullable(product.keyBenefit),
      audience: nullable(product.audience),
      claim_notes: nullable(product.claimNotes),
      sort_order: index
    }));
}

function normalizeProductName(value: string): string {
  return value.trim().toLocaleLowerCase("th");
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

export function buildBrandLibraryRows(
  clientId: string,
  jobId: string,
  analysis: BrandSignalAnalysis
): BrandLibraryInsert[] {
  const sourceLine = sourceReferenceLine(
    jobId,
    analysis.visualGuidance.sourceAssetPaths.length
  );
  const rows = analysis.brandKitEntries.map((entry, index) => ({
    client_id: clientId,
    section: "brand" as const,
    title: entry.title,
    description: `${entry.description.trim()}\n\n${sourceLine}`,
    sort_order: index
  }));

  rows.push({
    client_id: clientId,
    section: "brand",
    title: "Visual guidance",
    description: `${formatVisualGuidance(analysis.visualGuidance)}\n\n${sourceLine}`,
    sort_order: rows.length
  });

  return rows;
}

export function buildBrandLearningRows(
  clientId: string,
  jobId: string,
  analysis: BrandSignalAnalysis
): BrandLearningInsert[] {
  const sourceLine = sourceReferenceLine(
    jobId,
    analysis.visualGuidance.sourceAssetPaths.length
  );

  return analysis.learning.map((item) => ({
    client_id: clientId,
    polarity: item.polarity,
    note: `${item.note.trim()}\n${sourceLine}`,
    source_run_id: null
  }));
}

function formatVisualGuidance(guidance: BrandVisualGuidance): string {
  return [
    formatList("Mood", guidance.mood),
    formatList("Color palette", guidance.colorPalette),
    formatList("Layout", guidance.layoutPatterns),
    formatList("Text overlay", guidance.textOverlay),
    formatList("Typography feel", guidance.typographyFeel),
    formatList("Product / person / environment", guidance.productPersonEnvironment),
    formatList("Do", guidance.dos),
    formatList("Don't", guidance.donts)
  ]
    .filter(Boolean)
    .join("\n");
}

function formatList(label: string, values: readonly string[]): string {
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  if (!cleaned.length) return "";
  return `${label}: ${cleaned.join(", ")}`;
}

function sourceReferenceLine(jobId: string, imageCount: number): string {
  return `Source: brand_analysis_jobs/${jobId} · ${imageCount} images`;
}
