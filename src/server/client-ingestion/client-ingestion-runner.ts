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
  ...harnessDependencies
}: ClientIngestionRunnerDependencies): Promise<ClientIngestionRunnerResult> {
  const claimed = await queue.claimNextQueuedJob();

  if (!claimed) {
    return { claimed: false };
  }

  const result = await runClientIngestionJob(
    claimed.job,
    claimed.client,
    harnessDependencies
  );

  return {
    claimed: true,
    jobId: claimed.job.id,
    clientId: claimed.client.id,
    result
  };
}

export class SupabaseClientIngestionJobQueue
  implements ClientIngestionJobQueue
{
  constructor(private readonly client: SupabaseClient<Database>) {}

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
