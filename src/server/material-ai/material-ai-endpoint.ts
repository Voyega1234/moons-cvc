import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { resolveConvertCakeAuthorization, type ConvertCakeAuthEnv } from "../shared/convert-cake-auth.js";
import { extractStructuredJsonText, StructuredOutputError } from "../shared/structured-output.js";
import { withAiRetry } from "../shared/ai-retry.js";
import { openRouterCompatibleSchema } from "../shared/openrouter-schema.js";
import { createAiUsageTrackingFetch } from "../shared/ai-usage-recorder.js";

export interface MaterialAiEnv extends ConvertCakeAuthEnv {
  OPENROUTER_API_KEY?: string;
  MATERIAL_AI_MODEL?: string;
  BRAND_ASSETS_BUCKET?: string;
}

export const MAX_MATCH_HOOKS = 40;
export const MAX_MATCH_MATERIALS = 150;
export const MAX_MATERIALS_PER_HOOK = 3;

const labelPrompt = `Label this uploaded marketing material image so a copywriter can later match it to campaign ideas. Inspect the actual image.
Say what it is in ONE concise line (140 characters maximum): the product (type, name or variant, colour, visible text on pack), or the person/people (visible clothing, activity, setting), or the scene/graphic. Use the language of any visible product text, otherwise English.
Do not identify real people by name, and do not guess gender identity, race, age or health. No marketing claims or invented facts. Return only the required JSON.`;

const labelSchema = {
  type: "object", additionalProperties: false,
  properties: { label: { type: "string", maxLength: 140 } }, required: ["label"]
};

const matchPrompt = `You prefill Materials (source images) for advertising ideas. Each material has an id, a short label of what the image shows, and optionally the library folder it was filed in. The folder name was chosen by the team and often names the product or kind of image, so treat it as a strong hint alongside the label (if they conflict, trust what the label says the image shows). For EACH idea choose the materials whose subject the idea is actually about or needs on screen: the product/variant it promotes, or the kind of person/scene it describes.
Rules: choose at most ${MAX_MATERIALS_PER_HOOK} materials per idea; several angles of the same product count as one subject, so prefer the best one or two; return an empty list when nothing in the library fits (never pad); only use ids from the library; do not give every idea the same materials unless they truly promote the same subject. Return only the required JSON.`;

const matchSchema = {
  type: "object", additionalProperties: false,
  properties: { assignments: { type: "array", items: {
    type: "object", additionalProperties: false,
    properties: { hookId: { type: "string" }, materialIds: { type: "array", items: { type: "string" } } },
    required: ["hookId", "materialIds"] } } },
  required: ["assignments"]
};

export interface MaterialMatchResult { assignments: { hookId: string; materialIds: string[] }[] }

/** Keeps only known hooks/materials, dedupes, and caps picks per hook. */
export function sanitizeMatch(raw: unknown, hookIds: ReadonlySet<string>, materialIds: ReadonlySet<string>): MaterialMatchResult {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { assignments?: unknown }).assignments)
    ? (raw as { assignments: unknown[] }).assignments : [];
  const seen = new Set<string>();
  const assignments: MaterialMatchResult["assignments"] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const { hookId, materialIds: ids } = item as { hookId?: unknown; materialIds?: unknown };
    if (typeof hookId !== "string" || !hookIds.has(hookId) || seen.has(hookId) || !Array.isArray(ids)) continue;
    seen.add(hookId);
    const picked = [...new Set(ids.filter((id): id is string => typeof id === "string" && materialIds.has(id)))].slice(0, MAX_MATERIALS_PER_HOOK);
    assignments.push({ hookId, materialIds: picked });
  }
  return { assignments };
}

export function callLunaJson({ fetchImpl, apiKey, model, content, name, schema, label }: {
  fetchImpl: typeof fetch; apiKey: string; model: string; content: unknown[]; name: string; schema: object; label: string;
}): Promise<unknown> {
  return withAiRetry(async () => {
    const response = await fetchImpl("https://openrouter.ai/api/v1/responses", {
      method: "POST", signal: AbortSignal.timeout(45_000), headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, store: false, max_output_tokens: 4096, reasoning: { effort: "none" },
        input: [{ role: "user", content }], text: { format: { type: "json_schema", name, strict: true, schema: openRouterCompatibleSchema(schema) } } })
    });
    if (!response.ok) throw new StructuredOutputError("provider_error", `${label} failed: HTTP ${response.status}`, String(response.status));
    return JSON.parse(extractStructuredJsonText(await response.json(), label));
  });
}

/** One-line Luna description of an image; shared by the API endpoint and the backfill script. */
export async function labelMaterialImage({ fetchImpl, apiKey, model = "openai/gpt-5.6-luna", image }: {
  fetchImpl: typeof fetch; apiKey: string; model?: string; image: Buffer;
}): Promise<string> {
  const bytes = await sharp(image).rotate()
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  const result = await callLunaJson({ fetchImpl, apiKey, model, name: "moons_material_label", schema: labelSchema, label: "Material label",
    content: [{ type: "input_text", text: labelPrompt }, { type: "input_image", image_url: `data:image/jpeg;base64,${bytes.toString("base64")}`, detail: "high" }] }) as { label?: unknown };
  const label = typeof result.label === "string" ? result.label.trim().slice(0, 140) : "";
  if (!label) throw new StructuredOutputError("invalid_json", "Material label was empty.");
  return label;
}

/** Luna picks library materials per idea. Input is untrusted; output only contains known ids. */
export async function matchHooksToMaterials({ fetchImpl, apiKey, model = "openai/gpt-5.6-luna", hooks, materials }: {
  fetchImpl: typeof fetch; apiKey: string; model?: string; hooks: unknown[]; materials: unknown[];
}): Promise<MaterialMatchResult> {
  const str = (v: unknown, max: number) => typeof v === "string" ? v.trim().slice(0, max) : "";
  const cleanHooks = hooks.slice(0, MAX_MATCH_HOOKS).flatMap((h: any) => str(h?.id, 200) ? [{ id: str(h.id, 200), hook: str(h.hook, 300), concept: str(h.concept, 600) }] : []);
  const cleanMaterials = materials.slice(0, MAX_MATCH_MATERIALS).flatMap((m: any) => str(m?.id, 200) && str(m?.label, 140) ? [{ id: str(m.id, 200), label: str(m.label, 140), ...(str(m?.folder, 120) ? { folder: str(m.folder, 120) } : {}) }] : []);
  if (!cleanHooks.length || !cleanMaterials.length) return { assignments: [] };
  const text = `${matchPrompt}\n\nMATERIAL LIBRARY:\n${JSON.stringify(cleanMaterials)}\n\nIDEAS:\n${JSON.stringify(cleanHooks)}`;
  const raw = await callLunaJson({ fetchImpl, apiKey, model, content: [{ type: "input_text", text }], name: "moons_material_match", schema: matchSchema, label: "Material match" });
  return sanitizeMatch(raw, new Set(cleanHooks.map((h) => h.id)), new Set(cleanMaterials.map((m) => m.id)));
}

export async function handleMaterialAi({ request, env, fetchImpl = fetch, createStorageClient }: {
  request: Request; env: MaterialAiEnv; fetchImpl?: typeof fetch;
  createStorageClient?: (accessToken: string) => Pick<ReturnType<typeof createClient>, "storage">;
}): Promise<Response> {
  const json = (value: unknown, status = 200) => Response.json(value, { status });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  try {
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return json({ ok: false, error: "Material AI is not configured." }, 500);
    const auth = await resolveConvertCakeAuthorization(request, env, fetchImpl);
    if (!auth.authorized || !auth.accessToken) return json({ ok: false, error: "Unauthorized." }, 401);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; } catch { return json({ ok: false, error: "Invalid JSON request." }, 400); }
    const apiKey = env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) return json({ ok: false, error: "OPENROUTER_API_KEY is required." }, 500);
    const model = env.MATERIAL_AI_MODEL?.trim() || "openai/gpt-5.6-luna";
    const trackedFetch = createAiUsageTrackingFetch({ fetchImpl, context: { supabaseUrl: env.SUPABASE_URL, supabaseAnonKey: env.SUPABASE_ANON_KEY,
      accessToken: auth.accessToken, ownerUserId: auth.userId, clientId: null, workspaceRunId: "material-ai", operation: "hook-generation" } });

    if (body.action === "label") {
      const path = body.storagePath;
      if (typeof path !== "string" || !/^[A-Za-z0-9_-]+\/asset-library\/material\/[\w.-]+\.(?:png|jpe?g|webp)$/i.test(path)) return json({ ok: false, error: "Choose a material from the brand library." }, 400);
      const storage = createStorageClient?.(auth.accessToken) ?? createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${auth.accessToken}` } } });
      const { data, error } = await storage.storage.from(env.BRAND_ASSETS_BUCKET?.trim() || "brand-assets").download(path);
      if (error || !data) throw new Error("The material is unavailable.");
      const label = await labelMaterialImage({ fetchImpl: trackedFetch, apiKey, model, image: Buffer.from(await data.arrayBuffer()) });
      return json({ ok: true, label, model });
    }

    if (body.action === "match") {
      const hooks = Array.isArray(body.hooks) ? body.hooks : [];
      const materials = Array.isArray(body.materials) ? body.materials : [];
      const result = await matchHooksToMaterials({ fetchImpl: trackedFetch, apiKey, model, hooks, materials });
      return json({ ok: true, ...result, model });
    }
    return json({ ok: false, error: "Unknown action." }, 400);
  } catch (caught) {
    return json({ ok: false, error: caught instanceof Error ? caught.message : "Material AI failed." }, 500);
  }
}
