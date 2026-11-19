export interface GeminiApiProviderEnv {
  GEMINI_API_PROVIDER?: string;
}

/** One server-side switch for all Gemini API traffic. */
export function geminiApiProvider(env: GeminiApiProviderEnv): "openrouter" | "gemini" {
  const provider = env.GEMINI_API_PROVIDER?.trim() || "openrouter";
  if (provider !== "openrouter" && provider !== "gemini") {
    throw new Error("GEMINI_API_PROVIDER must be openrouter or gemini.");
  }
  return provider;
}

export function openRouterGeminiModel(model: string): string {
  return model.startsWith("google/") ? model : `google/${model}`;
}
