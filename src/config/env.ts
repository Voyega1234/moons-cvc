export interface PublicEnv {
  apiBaseUrl: string;
  dataSource: "mock" | "supabase";
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  brandAssetsBucket: string;
  hookGenerationMode: "n8n" | "harness";
  hookGenerationWebhookUrl: string;
  hookGenerationHarnessEndpoint: string;
  artworkGenerationEndpoint: string | null;
  brandLearningSuggestionEndpoint: string;
  qualityCheckEndpoint: string;
  guidelineAnalysisEndpoint: string;
}

function optional(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export const env: PublicEnv = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL?.trim() || "/api",
  dataSource:
    import.meta.env.VITE_DATA_SOURCE === "supabase" ? "supabase" : "mock",
  supabaseUrl: optional(
    import.meta.env.VITE_SUPABASE_URL || import.meta.env.SUPABASE_URL
  ),
  supabaseAnonKey: optional(
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
      import.meta.env.SUPABASE_ANON_KEY
  ),
  brandAssetsBucket:
    import.meta.env.VITE_BRAND_ASSETS_BUCKET ||
    import.meta.env.BRAND_ASSETS_BUCKET ||
    "brand-assets",
  hookGenerationMode:
    import.meta.env.VITE_HOOK_GENERATION_MODE === "harness"
      ? "harness"
      : "n8n",
  hookGenerationWebhookUrl:
    import.meta.env.VITE_N8N_HOOK_WEBHOOK_URL ||
    "https://n8n.srv934175.hstgr.cloud/webhook/moons-creative-ideas",
  hookGenerationHarnessEndpoint:
    import.meta.env.VITE_HOOK_GENERATION_HARNESS_ENDPOINT ||
    `${import.meta.env.VITE_API_BASE_URL?.trim() || "/api"}/hook-generation-harness`,
  artworkGenerationEndpoint: optional(
    import.meta.env.VITE_ARTWORK_GENERATION_ENDPOINT
  ),
  brandLearningSuggestionEndpoint:
    import.meta.env.VITE_BRAND_LEARNING_SUGGESTION_ENDPOINT ||
    `${import.meta.env.VITE_API_BASE_URL?.trim() || "/api"}/suggest-brand-learning`,
  qualityCheckEndpoint:
    import.meta.env.VITE_QUALITY_CHECK_ENDPOINT ||
    `${import.meta.env.VITE_API_BASE_URL?.trim() || "/api"}/quality-check`,
  guidelineAnalysisEndpoint:
    import.meta.env.VITE_GUIDELINE_ANALYSIS_ENDPOINT ||
    `${import.meta.env.VITE_API_BASE_URL?.trim() || "/api"}/analyze-brand-guideline`
};

export function hasSupabaseEnv(
  value: PublicEnv = env
): value is PublicEnv & {
  supabaseUrl: string;
  supabaseAnonKey: string;
} {
  return Boolean(value.supabaseUrl && value.supabaseAnonKey);
}
