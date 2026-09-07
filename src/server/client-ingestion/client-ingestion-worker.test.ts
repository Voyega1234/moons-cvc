import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/database.types";
import {
  buildClientIngestionWorkerDependencies,
  readRequiredClientIngestionWorkerEnv
} from "./client-ingestion-worker";
import { GeminiGroundingSearchFallback } from "./gemini-grounding-search-fallback";
import { OpenAiBrandVisualAnalyzer } from "./openai-brand-visual-analyzer";
import { OpenAiBrandDiscoverySearch } from "./openai-brand-discovery-search";
import { SupabaseBrandMemoryWriter } from "./supabase-brand-memory-writer";
import { SupabaseClientIngestionStore } from "./supabase-client-ingestion-store";
import { SupabaseImageMirror } from "./supabase-image-mirror";
import { SupabaseClientIngestionJobQueue } from "./client-ingestion-runner";

const validEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  APIFY_TOKEN: "apify-token",
  OPENROUTER_API_KEY: "openrouter-key",
  OPENROUTER_TERRA_MODEL: "openai/gpt-test"
};

describe("client ingestion worker env", () => {
  it("requires server-only secrets and reuses the shared OpenRouter Terra model", () => {
    expect(
      readRequiredClientIngestionWorkerEnv({
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        APIFY_TOKEN: "apify-token",
        OPENROUTER_API_KEY: "openrouter-key",
        OPENROUTER_TERRA_MODEL: "openai/gpt-test"
      })
    ).toEqual({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      APIFY_TOKEN: "apify-token",
      OPENROUTER_API_KEY: "openrouter-key",
      OPENROUTER_BRAND_ANALYSIS_MODEL: "openai/gpt-test"
    });
  });

  it("throws when a required worker secret is missing", () => {
    expect(() =>
      readRequiredClientIngestionWorkerEnv({
        ...validEnv,
        OPENROUTER_API_KEY: ""
      })
    ).toThrow("OPENROUTER_API_KEY is required.");
  });
});

describe("buildClientIngestionWorkerDependencies", () => {
  it("routes visual analysis through OpenRouter using the shared Terra model", async () => {
    const supabase = {} as SupabaseClient<Database>;
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    const dependencies = buildClientIngestionWorkerDependencies({
      env: validEnv,
      supabase,
      fetchImpl: (async (url, init) => {
        requests.push({
          url: String(url),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>
        });
        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              brandKitEntries: [],
              learning: [],
              products: [],
              visualGuidance: {
                mood: [],
                colorPalette: [],
                layoutPatterns: [],
                textOverlay: [],
                typographyFeel: [],
                productPersonEnvironment: [],
                dos: [],
                donts: [],
                sourceAssetPaths: []
              },
              needsReview: false,
              reviewReason: ""
            })
          }),
          { status: 200 }
        );
      }) as typeof fetch
    });

    expect(dependencies.queue).toBeInstanceOf(SupabaseClientIngestionJobQueue);
    expect(dependencies.store).toBeInstanceOf(SupabaseClientIngestionStore);
    expect(dependencies.imageMirror).toBeInstanceOf(SupabaseImageMirror);
    expect(dependencies.visualAnalyzer).toBeInstanceOf(OpenAiBrandVisualAnalyzer);
    expect(dependencies.brandDiscoverySearch).toBeInstanceOf(
      OpenAiBrandDiscoverySearch
    );
    expect(dependencies.brandMemoryWriter).toBeInstanceOf(
      SupabaseBrandMemoryWriter
    );
    expect(dependencies.searchFallback).toBeUndefined();

    await dependencies.visualAnalyzer?.analyze({
      client: { id: "client-1", name: "Client One", facebookUrl: "" },
      visualAssets: [],
      textEvidence: [
        {
          sourceType: "manual_input",
          sourceId: "source-1",
          text: "Brand evidence"
        }
      ],
      sourceSummary: {
        postsSaved: 0,
        adsSaved: 0,
        manualInputsSaved: 1,
        usedFallbackSearch: false
      }
    });
    await dependencies.brandDiscoverySearch?.search({
      clientName: "Client One",
      facebookUrl: ""
    });

    expect(requests).toEqual([
      expect.objectContaining({
        url: "https://openrouter.ai/api/v1/responses",
        body: expect.objectContaining({ model: "openai/gpt-test" })
      }),
      expect.objectContaining({
        url: "https://openrouter.ai/api/v1/responses",
        body: expect.objectContaining({
          model: "openai/gpt-test",
          tools: [
            expect.objectContaining({ type: "openrouter:web_search" })
          ]
        })
      })
    ]);
  });

  it("does not fall back to direct OpenAI visual analysis", () => {
    const supabase = {} as SupabaseClient<Database>;

    expect(() =>
      buildClientIngestionWorkerDependencies({
        env: { ...validEnv, OPENROUTER_API_KEY: "" },
        supabase
      })
    ).toThrow("OPENROUTER_API_KEY is required.");
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
