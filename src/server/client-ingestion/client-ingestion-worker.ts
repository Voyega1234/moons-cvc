import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/database.types.js";
import { createApifyClient } from "./apify-client.js";
import { GeminiGroundingSearchFallback } from "./gemini-grounding-search-fallback.js";
import {
  runNextClientIngestionJob,
  SupabaseClientIngestionJobQueue
} from "./client-ingestion-runner.js";
import type { ClientIngestionRunnerDependencies } from "./client-ingestion-runner.js";
import { OpenAiBrandVisualAnalyzer } from "./openai-brand-visual-analyzer.js";
import { OpenAiBrandDiscoverySearch } from "./openai-brand-discovery-search.js";
import { SupabaseBrandMemoryWriter } from "./supabase-brand-memory-writer.js";
import { SupabaseClientIngestionStore } from "./supabase-client-ingestion-store.js";
import { SupabaseImageMirror } from "./supabase-image-mirror.js";

type FetchLike = typeof fetch;

export interface ClientIngestionWorkerEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  APIFY_TOKEN?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_BRAND_ANALYSIS_MODEL?: string;
  OPENROUTER_TERRA_MODEL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_GROUNDING_MODEL?: string;
}

const OPENROUTER_RESPONSES_ENDPOINT = "https://openrouter.ai/api/v1/responses";

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
      apiKey: requiredEnv.OPENROUTER_API_KEY,
      model: requiredEnv.OPENROUTER_BRAND_ANALYSIS_MODEL,
      provider: "openrouter",
      endpoint: OPENROUTER_RESPONSES_ENDPOINT,
      fetchImpl
    }),
    brandDiscoverySearch: new OpenAiBrandDiscoverySearch({
      apiKey: requiredEnv.OPENROUTER_API_KEY,
      model: requiredEnv.OPENROUTER_BRAND_ANALYSIS_MODEL,
      provider: "openrouter",
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
): {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  APIFY_TOKEN: string;
  OPENROUTER_API_KEY: string;
  OPENROUTER_BRAND_ANALYSIS_MODEL: string;
} {
  const SUPABASE_URL = readRequiredEnv(env.SUPABASE_URL, "SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = readRequiredEnv(
    env.SUPABASE_SERVICE_ROLE_KEY,
    "SUPABASE_SERVICE_ROLE_KEY"
  );
  const APIFY_TOKEN = readRequiredEnv(env.APIFY_TOKEN, "APIFY_TOKEN");
  const OPENROUTER_API_KEY = readRequiredEnv(
    env.OPENROUTER_API_KEY,
    "OPENROUTER_API_KEY"
  );
  const OPENROUTER_BRAND_ANALYSIS_MODEL = readRequiredEnv(
    env.OPENROUTER_BRAND_ANALYSIS_MODEL?.trim() ||
      env.OPENROUTER_TERRA_MODEL?.trim(),
    "OPENROUTER_BRAND_ANALYSIS_MODEL or OPENROUTER_TERRA_MODEL"
  );

  return {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    APIFY_TOKEN,
    OPENROUTER_API_KEY,
    OPENROUTER_BRAND_ANALYSIS_MODEL
  };
}

function readRequiredEnv(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${name} is required.`);
  return trimmed;
}
