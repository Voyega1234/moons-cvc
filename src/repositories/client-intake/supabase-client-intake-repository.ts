import type { Brand } from "../../domain/brand";
import {
  initialsFromClientName,
  validateClientCategory,
  validateFacebookUrl,
  type CreateClientDraftInput,
  type CreateClientDraftResult,
  type QueueClientIngestionInput,
  type QueueClientIngestionResult
} from "../../domain/client-ingestion";
import { getSupabaseClient } from "../../lib/supabase/client";
import type { Database, Json } from "../../lib/supabase/database.types";
import type { ClientIntakeRepository } from "../../ports/client-intake-repository";
import { triggerClientIngestion } from "../../services/client-ingestion/trigger-client-ingestion";
import { slugify } from "../../shared/utils/text";

type ClientRow = Database["moons"]["Tables"]["clients"]["Row"];

export class SupabaseClientIntakeRepository implements ClientIntakeRepository {
  async createDraftClient({
    name,
    facebookUrl,
    category,
    questionnaire
  }: CreateClientDraftInput): Promise<CreateClientDraftResult> {
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error("Client name is required.");

    const urlError = validateFacebookUrl(facebookUrl);
    if (urlError) throw new Error(urlError);
    const categoryError = validateClientCategory(category ?? "");
    if (categoryError) throw new Error(categoryError);

    const client = getSupabaseClient();
    const { data: userData } = await client.auth.getUser();
    const clientId = createClientId(trimmedName);
    const { data: clientRow, error: clientError } = await client
      .schema("moons")
      .from("clients")
      .insert({
        id: clientId,
        name: trimmedName,
        category: category?.trim() || "Awaiting brand ingestion",
        initials: initialsFromClientName(trimmedName),
        source: "facebook_ingestion",
        is_active: true,
        facebook_url: facebookUrl.trim(),
        ingestion_status: "draft"
      })
      .select("*")
      .single();

    if (clientError) throw clientError;

    const { data: job, error: jobError } = await client
      .schema("moons")
      .from("brand_analysis_jobs")
      .insert({
        client_id: clientRow.id,
        status: "queued",
        current_step: "queued",
        source_status: {},
        created_by: userData.user?.id ?? null
      })
      .select("id")
      .single();

    if (jobError) throw jobError;

    await saveQuestionnaireSource({
      client,
      clientId: clientRow.id,
      jobId: job.id,
      questionnaire
    });

    const { data: updatedClient, error: updateError } = await client
      .schema("moons")
      .from("clients")
      .update({ ingestion_status: "queued", ingestion_error: null })
      .eq("id", clientRow.id)
      .select("*")
      .single();

    if (updateError) throw updateError;

    const { data: sessionData } = await client.auth.getSession();
    await triggerClientIngestion({
      accessToken: sessionData.session?.access_token
    });

    return {
      brand: mapBrand(updatedClient),
      jobId: job.id
    };
  }

  async queueExistingClient({
    clientId,
    facebookUrl,
    questionnaire
  }: QueueClientIngestionInput): Promise<QueueClientIngestionResult> {
    const urlError = validateFacebookUrl(facebookUrl);
    if (urlError) throw new Error(urlError);

    const client = getSupabaseClient();
    const { data: jobId, error } = await client
      .schema("moons")
      .rpc("queue_brand_analysis", {
        p_client_id: clientId,
        p_facebook_url: facebookUrl.trim()
      });

    if (error) throw error;
    await saveQuestionnaireSource({
      client,
      clientId,
      jobId,
      questionnaire
    });
    const { data: sessionData } = await client.auth.getSession();
    await triggerClientIngestion({
      accessToken: sessionData.session?.access_token
    });
    return { jobId };
  }
}

async function saveQuestionnaireSource({
  client,
  clientId,
  jobId,
  questionnaire
}: {
  client: ReturnType<typeof getSupabaseClient>;
  clientId: string;
  jobId: string;
  questionnaire: CreateClientDraftInput["questionnaire"];
}): Promise<void> {
  const text = questionnaire?.text.trim();
  if (!text) return;

  const { error } = await client
    .schema("moons")
    .from("brand_sources")
    .insert({
      client_id: clientId,
      job_id: jobId,
      source_type: "manual_input",
      source_url: questionnaire?.sourceUrl?.trim() || null,
      status: "succeeded",
      raw_payload: {
        kind: "mapping_questionnaire",
        text
      } satisfies Json
    });

  if (error) throw error;
}

function mapBrand(row: ClientRow): Brand {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    initials: row.initials,
    facebookUrl: row.facebook_url ?? undefined,
    ingestionStatus: row.ingestion_status,
    ingestionError: row.ingestion_error ?? undefined,
    ingestionUpdatedAt: row.updated_at,
    library: { brand: [], products: [], docs: [], refs: [] },
    memory: { working: [], avoid: [] },
    existsInSystem: true,
    source: "system"
  };
}

function createClientId(name: string): string {
  const base = slugify(name) || "client";
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}
