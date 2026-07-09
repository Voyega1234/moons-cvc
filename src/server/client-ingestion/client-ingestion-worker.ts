import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/database.types";
import { createApifyClient } from "./apify-client";
import { GeminiGroundingSearchFallback } from "./gemini-grounding-search-fallback";
import {
  runNextClientIngestionJob,
  SupabaseClientIngestionJobQueue
} from "./client-ingestion-runner";
import type { ClientIngestionRunnerDependencies } from "./client-ingestion-runner";
import { OpenAiBrandVisualAnalyzer } from "./openai-brand-visual-analyzer";
import { SupabaseBrandMemoryWriter } from "./supabase-brand-memory-writer";
import { SupabaseClientIngestionStore } from "./supabase-client-ingestion-store";
import { SupabaseImageMirror } from "./supabase-image-mirror";

type FetchLike = typeof fetch;

export interface ClientIngestionWorkerEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  APIFY_TOKEN?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BRAND_ANALYSIS_MODEL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_GROUNDING_MODEL?: string;
}

export interface ClientIngestionWorkerOptions {
  env: ClientIngestionWorkerEnv;
  fetchImpl?: FetchLike;
}

export interface ClientIngestionWorkerDependencyOptions
  extends ClientIngestionWorkerOptions {
  supabase: SupabaseClient<Database>;
}

export function createServiceRoleSupabaseClient(
  env: ClientIngestionWorkerEnv
): SupabaseClient<Database> {
  const requiredEnv = readRequiredClientIngestionWorkerEnv(env);

  return createClient<Database>(
    requiredEnv.SUPABASE_URL,
    requiredEnv.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    }
  );
}

export function buildClientIngestionWorkerDependencies({
  env,
  supabase,
  fetchImpl = fetch
}: ClientIngestionWorkerDependencyOptions): ClientIngestionRunnerDependencies {
  const requiredEnv = readRequiredClientIngestionWorkerEnv(env);

  const geminiApiKey = env.GEMINI_API_KEY?.trim();

  return {
    queue: new SupabaseClientIngestionJobQueue(supabase),
    apify: createApifyClient({
      token: requiredEnv.APIFY_TOKEN,
      fetchImpl
    }),
    store: new SupabaseClientIngestionStore(supabase),
    imageMirror: new SupabaseImageMirror({
      client: supabase,
      fetchImpl
    }),
    visualAnalyzer: new OpenAiBrandVisualAnalyzer({
      apiKey: requiredEnv.OPENAI_API_KEY,
      model: requiredEnv.OPENAI_BRAND_ANALYSIS_MODEL,
      fetchImpl
    }),
    ...(geminiApiKey
      ? {
          searchFallback: new GeminiGroundingSearchFallback({
            apiKey: geminiApiKey,
            model: env.GEMINI_GROUNDING_MODEL?.trim() || "gemini-3.5-flash",
            fetchImpl
          })
        }
      : {}),
    brandMemoryWriter: new SupabaseBrandMemoryWriter(supabase)
  };
}

export async function runClientIngestionWorkerOnce({
  env,
  fetchImpl = fetch
}: ClientIngestionWorkerOptions) {
  const supabase = createServiceRoleSupabaseClient(env);
  const dependencies = buildClientIngestionWorkerDependencies({
    env,
    supabase,
    fetchImpl
  });

  return runNextClientIngestionJob(dependencies);
}

export function readRequiredClientIngestionWorkerEnv(
  env: ClientIngestionWorkerEnv
): Required<
  Pick<
    ClientIngestionWorkerEnv,
    | "SUPABASE_URL"
    | "SUPABASE_SERVICE_ROLE_KEY"
    | "APIFY_TOKEN"
    | "OPENAI_API_KEY"
    | "OPENAI_BRAND_ANALYSIS_MODEL"
  >
> {
  const SUPABASE_URL = readRequiredEnv(env.SUPABASE_URL, "SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = readRequiredEnv(
    env.SUPABASE_SERVICE_ROLE_KEY,
    "SUPABASE_SERVICE_ROLE_KEY"
  );
  const APIFY_TOKEN = readRequiredEnv(env.APIFY_TOKEN, "APIFY_TOKEN");
  const OPENAI_API_KEY = readRequiredEnv(env.OPENAI_API_KEY, "OPENAI_API_KEY");

  return {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    APIFY_TOKEN,
    OPENAI_API_KEY,
    OPENAI_BRAND_ANALYSIS_MODEL:
      env.OPENAI_BRAND_ANALYSIS_MODEL?.trim() || "gpt-5.5"
  };
}

function readRequiredEnv(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${name} is required.`);
  return trimmed;
}
