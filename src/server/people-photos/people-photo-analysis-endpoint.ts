import { createClient } from "@supabase/supabase-js";
import { PEOPLE_PHOTO_FOLDER, peopleAgeBands, readPeoplePhotoAnalysis } from "../../domain/people-photos.js";
import { resolveConvertCakeAuthorization, type ConvertCakeAuthEnv } from "../shared/convert-cake-auth.js";
import { geminiApiProvider, openRouterGeminiModel, type GeminiApiProviderEnv } from "../shared/gemini-api-provider.js";
import { callGoogleHookApi } from "../hook-generation/google-hook-provider.js";
import { extractStructuredJsonText, StructuredOutputError } from "../shared/structured-output.js";
import { withAiRetry } from "../shared/ai-retry.js";
import { openRouterCompatibleSchema } from "../shared/openrouter-schema.js";
import { createAiUsageTrackingFetch } from "../shared/ai-usage-recorder.js";
import { resolvePeoplePhotoCandidates } from "../artwork-generation/people-photo-library.js";
import type { ArtworkStorageClient } from "../artwork-generation/artwork-generation-types.js";

export interface PeoplePhotoAnalysisEnv extends ConvertCakeAuthEnv, GeminiApiProviderEnv {
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  PEOPLE_PHOTO_LABEL_MODEL?: string;
}

const prompt = `Label this uploaded photograph for an optional real-people casting library. Inspect the actual image.
Describe only visible pose, clothing, setting, activity, props, framing and number of people. Return a concise English description (96 ASCII characters maximum), up to six short Thai search tags (each 10 characters maximum, e.g. นั่งโต๊ะ, เสื้อเชิ้ต, กลางแจ้ง), and an apparent age BAND. English descriptions plus Thai keywords support searching with briefs in either language. Age is only a visual estimate, never actual age; use unknown when unclear and mixed for groups of clearly different age bands. If no person is clearly visible, say so and use unknown.
Do not identify the person. Do not infer or label gender identity, race/ethnicity, nationality, religion, health, personality or professional qualifications. Use neutral person/people nouns, not man/woman/boy/girl or gendered Thai labels. Describe visible clothing such as a white coat rather than asserting someone is a doctor. Gender metadata is supplied separately by the team and must not be guessed. No marketing claims or invented facts. Return only the required JSON.`;

const schema = {
  type: "object", additionalProperties: false,
  properties: {
    description: { type: "string", maxLength: 96 },
    tags: { type: "array", items: { type: "string", maxLength: 10 }, maxItems: 6 },
    apparentAgeBand: { type: "string", enum: Object.keys(peopleAgeBands) }
  }, required: ["description", "tags", "apparentAgeBand"]
};

export async function handlePeoplePhotoAnalysis({ request, env, fetchImpl = fetch, createStorageClient }: {
  request: Request; env: PeoplePhotoAnalysisEnv; fetchImpl?: typeof fetch;
  createStorageClient?: (accessToken: string) => ArtworkStorageClient;
}): Promise<Response> {
  const json = (value: unknown, status = 200) => Response.json(value, { status });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  try {
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return json({ ok: false, error: "People photo storage is not configured." }, 500);
    const auth = await resolveConvertCakeAuthorization(request, env, fetchImpl);
    if (!auth.authorized || !auth.accessToken) return json({ ok: false, error: "Unauthorized." }, 401);
    let body: unknown;
    try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON request." }, 400); }
    const path = body && typeof body === "object" && "path" in body ? body.path : undefined;
    if (typeof path !== "string" || path.length > 1000 || !new RegExp(`^${PEOPLE_PHOTO_FOLDER}/[A-Za-z0-9_-]+\\.(?:png|jpg|jpeg|webp)$`, "i").test(path)) return json({ ok: false, error: "Choose a photo from the shared people library." }, 400);
    const configuredModel = env.PEOPLE_PHOTO_LABEL_MODEL?.trim() || "openai/gpt-5.6-luna";
    const model = configuredModel.includes("/") ? configuredModel : openRouterGeminiModel(configuredModel);
    const provider = model.startsWith("google/gemini-") ? geminiApiProvider(env) : "openrouter";
    const apiKey = (provider === "gemini" ? env.GEMINI_API_KEY : env.OPENROUTER_API_KEY)?.trim();
    if (!apiKey) return json({ ok: false, error: `${provider === "gemini" ? "GEMINI_API_KEY" : "OPENROUTER_API_KEY"} is required.` }, 500);
    const storage = createStorageClient?.(auth.accessToken) ?? createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${auth.accessToken}` } }
    }) as unknown as ArtworkStorageClient;
    const [image] = await resolvePeoplePhotoCandidates(storage, [path], "", new Map(), 1);
    if (!image) throw new Error("The photo is unavailable.");
    const trackedFetch = createAiUsageTrackingFetch({ fetchImpl, context: { supabaseUrl: env.SUPABASE_URL, supabaseAnonKey: env.SUPABASE_ANON_KEY,
      accessToken: auth.accessToken, ownerUserId: auth.userId, clientId: null, workspaceRunId: "people-photo-library", operation: "artwork-generation" } });
    const analysis = await withAiRetry(async () => {
      const result = provider === "gemini" ? await callGoogleHookApi({ provider, apiKey, model: model.replace(/^google\//, ""), fetchImpl: (url, init) => trackedFetch(url, { ...init, signal: AbortSignal.timeout(45_000) }),
        text: prompt, images: [{ mimeType: image.mimeType, data: image.bytes.toString("base64") }], schema: openRouterCompatibleSchema(schema), schemaName: "moons_people_photo_labels", maxTokens: 8192, search: false
      }) : await (async () => {
        const response = await trackedFetch("https://openrouter.ai/api/v1/responses", {
          method: "POST", signal: AbortSignal.timeout(45_000), headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, store: false, max_output_tokens: 2048, reasoning: { effort: model === "openai/gpt-5.6-luna" ? "none" : "low" },
            input: [{ role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_image", image_url: `data:${image.mimeType};base64,${image.bytes.toString("base64")}`, detail: "high" }] }],
            text: { format: { type: "json_schema", name: "moons_people_photo_labels", strict: true, schema: openRouterCompatibleSchema(schema) } }
          })
        });
        if (!response.ok) throw new StructuredOutputError("provider_error", `Photo labeling failed: HTTP ${response.status}`, String(response.status));
        return response.json();
      })();
      const labels = readPeoplePhotoAnalysis(JSON.parse(extractStructuredJsonText(result, "People photo labels")));
      if (!/^[\x20-\x7E]*$/.test(labels.description)) throw new StructuredOutputError("invalid_json", "Photo descriptions must be concise English text.");
      return labels;
    });
    return json({ ok: true, analysis, model });
  } catch (caught) {
    return json({ ok: false, error: caught instanceof Error ? caught.message : "Could not analyze the photo." }, 500);
  }
}
