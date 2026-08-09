import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/database.types.js";
import {
  runClientIngestionJob,
  type ClientIngestionClient,
  type ClientIngestionHarnessDependencies,
  type ClientIngestionHarnessResult,
  type ClientIngestionJob
} from "./client-ingestion-harness.js";

export interface ClaimedClientIngestionJob {
  job: ClientIngestionJob;
  client: ClientIngestionClient;
}

export interface ClientIngestionJobQueue {
  failStalledJobs?(): Promise<number>;
  claimNextQueuedJob(): Promise<ClaimedClientIngestionJob | null>;
}

export interface ClientIngestionRunnerDependencies
  extends ClientIngestionHarnessDependencies {
  queue: ClientIngestionJobQueue;
}

export type ClientIngestionRunnerResult =
  | {
      claimed: false;
    }
  | {
      claimed: true;
      jobId: string;
      clientId: string;
      result: ClientIngestionHarnessResult;
    };

export async function runNextClientIngestionJob({
  queue,
  store,
  ...harnessDependencies
}: ClientIngestionRunnerDependencies): Promise<ClientIngestionRunnerResult> {
  await queue.failStalledJobs?.();
  const claimed = await queue.claimNextQueuedJob();

  if (!claimed) {
    return { claimed: false };
  }

  let result: ClientIngestionHarnessResult;
  try {
    result = await runClientIngestionJob(claimed.job, claimed.client, {
      store,
      ...harnessDependencies
    });
  } catch (error) {
    const errorMessage = readableError(error);
    await Promise.all([
      store.updateJobStatus({
        jobId: claimed.job.id,
        status: "failed",
        currentStep: "failed",
        errorMessage
      }),
      store.updateClientStatus({
        clientId: claimed.client.id,
        status: "failed",
        errorMessage
      })
    ]);
    result = {
      postsSaved: 0,
      adsSaved: 0,
      visualAssetsMirrored: 0,
      usedFallbackSearch: false,
      completed: false
    };
  }

  return {
    claimed: true,
    jobId: claimed.job.id,
    clientId: claimed.client.id,
    result
  };
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : "Brand setup failed.";
}

export class SupabaseClientIngestionJobQueue
  implements ClientIngestionJobQueue
{
  constructor(private readonly client: SupabaseClient<Database>) {}

  async failStalledJobs(): Promise<number> {
    const cutoff = new Date(Date.now() - STALLED_JOB_THRESHOLD_MS).toISOString();
    const errorMessage =
      "Brand setup stopped after making no progress for 10 minutes. Please retry.";
    const completedAt = new Date().toISOString();
    const { data, error } = await this.client
      .schema("moons")
      .from("brand_analysis_jobs")
      .update({
        status: "failed",
        current_step: "failed",
        error_message: errorMessage,
        completed_at: completedAt
      })
      .in("status", ACTIVE_JOB_STATUSES)
      .lt("updated_at", cutoff)
      .select("client_id");

    if (error) throw error;

    const clientIds = [...new Set((data ?? []).map((job) => job.client_id))];
    if (!clientIds.length) return 0;

    const { error: clientError } = await this.client
      .schema("moons")
      .from("clients")
      .update({
        ingestion_status: "failed",
        ingestion_error: errorMessage
      })
      .in("id", clientIds)
      .in("ingestion_status", ACTIVE_JOB_STATUSES);

    if (clientError) throw clientError;
    return clientIds.length;
  }

  async claimNextQueuedJob(): Promise<ClaimedClientIngestionJob | null> {
    const { data, error } = await this.client
      .schema("moons")
      .rpc("claim_next_brand_analysis_job");

    if (error) throw error;

    const row = data[0];
    if (!row) return null;

    return {
      job: {
        id: row.job_id,
        clientId: row.client_id
      },
      client: {
        id: row.client_id,
        name: row.client_name,
        facebookUrl: row.facebook_url ?? ""
      }
    };
  }
}

const STALLED_JOB_THRESHOLD_MS = 10 * 60 * 1_000;
const ACTIVE_JOB_STATUSES = [
  "queued",
  "validating_source",
  "scraping_facebook_posts",
  "scraping_facebook_ads",
  "searching_fallback",
  "mirroring_images",
  "analyzing_visuals",
  "analyzing_brand",
  "writing_memory"
] as const;
