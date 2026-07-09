import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/database.types";
import {
  buildClientIngestionWorkerDependencies,
  readRequiredClientIngestionWorkerEnv
} from "./client-ingestion-worker";
import { GeminiGroundingSearchFallback } from "./gemini-grounding-search-fallback";
import { OpenAiBrandVisualAnalyzer } from "./openai-brand-visual-analyzer";
import { SupabaseBrandMemoryWriter } from "./supabase-brand-memory-writer";
import { SupabaseClientIngestionStore } from "./supabase-client-ingestion-store";
import { SupabaseImageMirror } from "./supabase-image-mirror";
import { SupabaseClientIngestionJobQueue } from "./client-ingestion-runner";

const validEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  APIFY_TOKEN: "apify-token",
  OPENAI_API_KEY: "openai-key",
  OPENAI_BRAND_ANALYSIS_MODEL: "gpt-test"
};

describe("client ingestion worker env", () => {
  it("requires server-only secrets and applies the default OpenAI analysis model", () => {
    expect(
      readRequiredClientIngestionWorkerEnv({
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        APIFY_TOKEN: "apify-token",
        OPENAI_API_KEY: "openai-key"
      })
    ).toEqual({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      APIFY_TOKEN: "apify-token",
      OPENAI_API_KEY: "openai-key",
      OPENAI_BRAND_ANALYSIS_MODEL: "gpt-5.5"
    });
  });

  it("throws when a required worker secret is missing", () => {
    expect(() =>
      readRequiredClientIngestionWorkerEnv({
        ...validEnv,
        OPENAI_API_KEY: ""
      })
    ).toThrow("OPENAI_API_KEY is required.");
  });
});

describe("buildClientIngestionWorkerDependencies", () => {
  it("composes the queue, Apify client, image mirror, OpenAI analyzer, and Brand Memory writer", () => {
    const supabase = {} as SupabaseClient<Database>;
    const dependencies = buildClientIngestionWorkerDependencies({
      env: validEnv,
      supabase,
      fetchImpl: (() => Promise.reject(new Error("not called"))) as typeof fetch
    });

    expect(dependencies.queue).toBeInstanceOf(SupabaseClientIngestionJobQueue);
    expect(dependencies.store).toBeInstanceOf(SupabaseClientIngestionStore);
    expect(dependencies.imageMirror).toBeInstanceOf(SupabaseImageMirror);
    expect(dependencies.visualAnalyzer).toBeInstanceOf(OpenAiBrandVisualAnalyzer);
    expect(dependencies.brandMemoryWriter).toBeInstanceOf(
      SupabaseBrandMemoryWriter
    );
    expect(dependencies.searchFallback).toBeUndefined();
  });

  it("adds Gemini grounding search fallback when GEMINI_API_KEY is provided", () => {
    const supabase = {} as SupabaseClient<Database>;
    const dependencies = buildClientIngestionWorkerDependencies({
      env: {
        ...validEnv,
        GEMINI_API_KEY: "gemini-key",
        GEMINI_GROUNDING_MODEL: "gemini-test"
      },
      supabase,
      fetchImpl: (() => Promise.reject(new Error("not called"))) as typeof fetch
    });

    expect(dependencies.searchFallback).toBeInstanceOf(
      GeminiGroundingSearchFallback
    );
  });
});
