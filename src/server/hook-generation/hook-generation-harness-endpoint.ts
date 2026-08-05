import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  albumFormatPreferences,
  albumFormats,
  ctaActionTypes,
  defaultAlbumFormatPreference,
  defaultHookIdeaMode,
  hookGenerationModels,
  serviceTypes,
  type AlbumFormat,
  type AlbumFormatPreference,
  type CtaActionType,
  type HookIdeaMode,
  type HookGenerationModel,
  type ServiceType,
  type UgcVideoBrief
} from "../../domain/creative-run.js";
import type { Database } from "../../lib/supabase/database.types.js";
import type { HookGenerationHarnessRequest } from "../../services/creative-generation/harness-hook-generation.js";
import type { RawDirection } from "../../services/creative-generation/hook-generation-types.js";
import {
  resolveConvertCakeAuthorization,
  type ConvertCakeAuthorization
} from "../shared/convert-cake-auth.js";
import {
  writeHookGenerationDebugLog,
  type HookGenerationDebugLog,
  type HookGenerationDebugLogger
} from "./hook-generation-debug-log.js";
import {
  fetchPastPostExamples,
  type PastPostExample,
  type PastPostsClient
} from "./past-posts.js";

type FetchLike = typeof fetch;

export interface HookGenerationHarnessEndpointEnv {
  OPENAI_API_KEY?: string;
  OPENAI_HOOK_GENERATION_MODEL?: string;
  OPENAI_HOOK_SUPPORT_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_HOOK_GENERATION_MODEL?: string;
  HOOK_GENERATION_DEBUG_LOG_DIR?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

export interface HookGenerationHarnessEndpointOptions {
  request: Request;
  env: HookGenerationHarnessEndpointEnv;
  fetchImpl?: FetchLike;
  createPastPostsClient?: (options: {
    supabaseUrl: string;
    supabaseAnonKey: string;
    accessToken: string;
  }) => PastPostsClient;
  loadAgentHookPrompt?: () => Promise<string>;
  writeDebugLog?: HookGenerationDebugLogger;
}

type ResponseContent =
  | {
      type: "input_text";
      text: string;
    }
  | {
      type: "input_image";
      image_url: string;
      detail: "high";
    };

interface GeneratedDirection extends RawDirection {
  id: string;
  sourceCandidateId: string;
  service: ServiceType;
  hook: string;
  subheadline: string;
  concept: string;
  why: string;
  visual: string;
  cta: string;
  supportingPoints: readonly string[];
  formatBeats: readonly string[];
  albumFormat: AlbumFormat;
  ugcBrief?: UgcVideoBrief;
  ctaActionType: CtaActionType;
  ctaDestination: string;
  contactLine: string;
  caption: string;
  score: number;
  reasoning: string;
  citations: readonly string[];
}

interface HookGenerationResult {
  directions: readonly GeneratedDirection[];
}

interface TracedAgentResult<T> {
  inputText: string;
  output: T;
  rawResponse: unknown;
}

const DEFAULT_MODEL = "gpt-5.6-terra";
const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-sonnet-4.6";
const DEFAULT_SUPPORT_MODEL = "gpt-5.6-luna";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const OPENROUTER_CHAT_COMPLETIONS_ENDPOINT =
  "https://openrouter.ai/api/v1/chat/completions";
const HOOK_GENERATION_BATCH_SIZE = 12;
const HOOK_GENERATION_CONCURRENCY = 3;
const HOOK_GENERATION_REASONING_EFFORT = "high" as const;
const THAI_NATURALNESS_RULE =
  "ภาษาไทยห้ามใช้คำว่า ‘ฉัน’ ทุกกรณี. ให้ละประธานหรือเรียบเรียงใหม่ให้เหมือนภาษาพูดจริงก่อน ใช้ ‘เรา’ เฉพาะเมื่อเป็นธรรมชาติและตรงกับเสียงแบรนด์; ห้ามแทน ‘ฉัน’ ด้วย ‘เรา’ แบบอัตโนมัติทุกประโยค.";
const SUBHEADLINE_BATCH_SIZE = 24;
const THAI_WEB_SEARCH_TOOL = {
  type: "web_search_preview",
  user_location: {
    type: "approximate",
    country: "TH",
    timezone: "Asia/Bangkok"
  }
} as const;

export async function handleHookGenerationHarnessRequest({
  request,
  env,
  fetchImpl = fetch,
  createPastPostsClient = defaultCreatePastPostsClient,
  loadAgentHookPrompt = defaultLoadAgentHookPrompt,
  writeDebugLog = writeHookGenerationDebugLog
}: HookGenerationHarnessEndpointOptions): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  try {
    const openAiApiKey = env.OPENAI_API_KEY?.trim();
    if (!openAiApiKey) {
      return jsonResponse(
        { ok: false, error: "OPENAI_API_KEY is required." },
        500
      );
    }

    const auth = await resolveConvertCakeAuthorization(request, env, fetchImpl);
    if (!auth.authorized) {
      return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
    }

    const input = parseRequestBody(await request.json());
    const generationProvider =
      input.generationModel === DEFAULT_OPENROUTER_MODEL
        ? "openrouter"
        : "openai";
    const generationApiKey =
      generationProvider === "openrouter"
        ? env.OPENROUTER_API_KEY?.trim()
        : openAiApiKey;
    if (!generationApiKey) {
      return jsonResponse(
        { ok: false, error: "OPENROUTER_API_KEY is required." },
        500
      );
    }
    const model =
      generationProvider === "openrouter"
        ? env.OPENROUTER_HOOK_GENERATION_MODEL?.trim() ||
          input.generationModel ||
          DEFAULT_OPENROUTER_MODEL
        : env.OPENAI_HOOK_GENERATION_MODEL?.trim() ||
          input.generationModel ||
          DEFAULT_MODEL;
    const supportModel =
      env.OPENAI_HOOK_SUPPORT_MODEL?.trim() || DEFAULT_SUPPORT_MODEL;
    const agentHookPrompt = await loadAgentHookPrompt();
    const generationBatches = buildHookGenerationBatches(input);
    const pastPosts = await loadPastPostExamples({
      input,
      env,
      auth,
      createPastPostsClient
    });

    const directTraces = await mapWithConcurrency(
      generationBatches,
      HOOK_GENERATION_CONCURRENCY,
      (batch) =>
        withTransientRetry(() =>
          runDirectHookGenerationStep({
            input: batch,
            agentHookPrompt,
            pastPosts,
            apiKey: generationApiKey,
            model,
            provider: generationProvider,
            fetchImpl
          })
        )
    );
    const directions = makeDirectionIdsUnique(
      directTraces.flatMap((trace) => trace.output.directions)
    ).slice(0, input.quantity);
    validateGeneratedDirectionQuotas(directions, input);
    const highlightedDirections = await runSubheadlineHighlightStep({
      directions,
      apiKey: openAiApiKey,
      model: supportModel,
      fetchImpl
    });

    const debugLogDirectory = env.HOOK_GENERATION_DEBUG_LOG_DIR?.trim();
    if (debugLogDirectory) {
      await writeDebugLog(
        debugLogDirectory,
        buildDirectHookGenerationDebugLog({
          input,
          generationBatches,
          directTraces,
          generationProvider,
          generationModel: model,
          finalDirections: highlightedDirections
        })
      );
    }

    return jsonResponse({ ok: true, directions: highlightedDirections });
  } catch (error) {
    return jsonResponse({ ok: false, error: readableError(error) }, 500);
  }
}

async function defaultLoadAgentHookPrompt(): Promise<string> {
  return readFile(join(process.cwd(), "agent_prompt", "agent_hook.md"), "utf8");
}

function defaultCreatePastPostsClient({
  supabaseUrl,
  supabaseAnonKey,
  accessToken
}: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessToken: string;
}): PastPostsClient {
  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  }) as unknown as PastPostsClient;
}

async function loadPastPostExamples({
  input,
  env,
  auth,
  createPastPostsClient
}: {
  input: HookGenerationHarnessRequest;
  env: HookGenerationHarnessEndpointEnv;
  auth: ConvertCakeAuthorization;
  createPastPostsClient: (options: {
    supabaseUrl: string;
    supabaseAnonKey: string;
    accessToken: string;
  }) => PastPostsClient;
}): Promise<readonly PastPostExample[]> {
  const supabaseUrl = env.SUPABASE_URL?.trim();
  const supabaseAnonKey = env.SUPABASE_ANON_KEY?.trim();
  if (!input.brand || !supabaseUrl || !supabaseAnonKey || !auth.accessToken) {
    return [];
  }

  try {
    const client = createPastPostsClient({
      supabaseUrl,
      supabaseAnonKey,
      accessToken: auth.accessToken
    });
    return await fetchPastPostExamples({ client, clientId: input.brand.id });
  } catch {
    return [];
  }
}

async function runDirectHookGenerationStep({
  input,
  agentHookPrompt,
  pastPosts,
  apiKey,
  model,
  provider,
  fetchImpl
}: {
  input: HookGenerationHarnessRequest;
  agentHookPrompt: string;
  pastPosts: readonly PastPostExample[];
  apiKey: string;
  model: string;
  provider: "openai" | "openrouter";
  fetchImpl: FetchLike;
}): Promise<TracedAgentResult<HookGenerationResult>> {
  const researchEnabled =
    input.hookIdeaMode === "fresh-research" && provider === "openai";
  const inputText = buildDirectHookGenerationPrompt(
    input,
    agentHookPrompt,
    pastPosts
  );
  const requestDirections = (requestInputText: string) =>
    callResponsesApi({
      apiKey,
      model,
      fetchImpl,
      content: [
        { type: "input_text", text: requestInputText },
        ...input.uploadedMaterials.map((material) => ({
          type: "input_image" as const,
          image_url: material.url,
          detail: "high" as const
        }))
      ],
      schemaName: "moons_hook_generation",
      schema: hookGenerationSchema,
      tools: researchEnabled ? [THAI_WEB_SEARCH_TOOL] : undefined,
      toolChoice: researchEnabled ? "required" : undefined,
      reasoningEffort:
        provider === "openai" ? HOOK_GENERATION_REASONING_EFFORT : undefined,
      provider
    });
  let finalInputText = inputText;
  let payload = await requestDirections(finalInputText);
  let result: HookGenerationResult | undefined;
  let repairedAlbumPanelCount = false;
  let repairedThaiNaturalness = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      result = parseHookGenerationResult(extractResponseText(payload));
    } catch (error) {
      if (
        repairedAlbumPanelCount ||
        !isAlbumPanelCountContractError(error)
      ) {
        throw error;
      }
      finalInputText = buildAlbumPanelCountRetryPrompt(
        finalInputText,
        readableError(error)
      );
      repairedAlbumPanelCount = true;
      payload = await requestDirections(finalInputText);
      continue;
    }

    if (
      !repairedThaiNaturalness &&
      containsForbiddenThaiFirstPerson(result)
    ) {
      finalInputText = buildThaiNaturalnessRetryPrompt(
        finalInputText,
        "direction"
      );
      repairedThaiNaturalness = true;
      result = undefined;
      payload = await requestDirections(finalInputText);
      continue;
    }
    break;
  }
  if (!result) throw new Error("Hook generation correction did not complete.");
  assertNoForbiddenThaiFirstPerson(result, "Creative directions");
  const preference = input.albumFormat ?? defaultAlbumFormatPreference;
  return {
    inputText: finalInputText,
    output: {
      directions: result.directions.map((direction) =>
        preference !== "auto" && direction.service === "album-post"
          ? { ...direction, albumFormat: preference }
          : direction
      )
    },
    rawResponse: payload
  };
}

function buildDirectHookGenerationDebugLog({
  input,
  generationBatches,
  directTraces,
  generationProvider,
  generationModel,
  finalDirections
}: {
  input: HookGenerationHarnessRequest;
  generationBatches: readonly HookGenerationHarnessRequest[];
  directTraces: readonly TracedAgentResult<HookGenerationResult>[];
  generationProvider: "openai" | "openrouter";
  generationModel: string;
  finalDirections: readonly GeneratedDirection[];
}): HookGenerationDebugLog {
  const endpoint =
    generationProvider === "openrouter"
      ? "/api/v1/chat/completions"
      : "/v1/responses";
  const researchEnabled =
    generationProvider === "openai" && input.hookIdeaMode === "fresh-research";
  return {
    kind: "hook-generation",
    createdAt: new Date().toISOString(),
    runId: input.runId,
    hookIdeaMode: input.hookIdeaMode,
    hookAgent: {
      provider: generationProvider,
      model: generationModel,
      promptSource: "agent_prompt/agent_hook.md",
      batches: directTraces.map((trace, index) => ({
        request: {
          endpoint,
          inputText: trace.inputText,
          tools: researchEnabled ? [THAI_WEB_SEARCH_TOOL] : [],
          ...(researchEnabled ? { toolChoice: "required" as const } : {}),
          ...(generationProvider === "openai"
            ? { reasoningEffort: HOOK_GENERATION_REASONING_EFFORT }
            : {}),
          attachedImages: (
            generationBatches[index]?.uploadedMaterials ?? []
          ).map((material) => ({
            id: material.id,
            name: material.name,
            mediaType: material.mediaType,
            role: material.role,
            description: material.description,
            detail: "high" as const
          })),
          responseSchema: "moons_hook_generation" as const
        },
        response: { parsed: trace.output, raw: trace.rawResponse }
      }))
    },
    finalResponse: { directions: finalDirections }
  };
}

async function runSubheadlineHighlightStep({
  directions,
  apiKey,
  model,
  fetchImpl
}: {
  directions: readonly GeneratedDirection[];
  apiKey: string;
  model: string;
  fetchImpl: FetchLike;
}): Promise<readonly GeneratedDirection[]> {
  const batches = chunk(directions, SUBHEADLINE_BATCH_SIZE);
  const highlightedBatches = await mapWithConcurrency(
    batches,
    HOOK_GENERATION_CONCURRENCY,
    (batch) =>
      withTransientRetry(() =>
        runSubheadlineHighlightBatch({
          directions: batch,
          apiKey,
          model,
          fetchImpl
        })
      )
  );
  return highlightedBatches.flat();
}

async function runSubheadlineHighlightBatch({
  directions,
  apiKey,
  model,
  fetchImpl
}: {
  directions: readonly GeneratedDirection[];
  apiKey: string;
  model: string;
  fetchImpl: FetchLike;
}): Promise<readonly GeneratedDirection[]> {
  const items = directions.map((direction) => ({
    id: direction.id,
    subheadline: direction.subheadline
  }));
  const payload = await callResponsesApi({
    apiKey,
    model,
    fetchImpl,
    content: [
      {
        type: "input_text",
        text: buildSubheadlineHighlightPrompt(items)
      }
    ],
    schemaName: "neo_subheadline_highlights",
    schema: subheadlineHighlightSchema
  });
  const highlights = parseSubheadlineHighlights(
    extractResponseText(payload),
    items
  );

  return directions.map((direction) => ({
    ...direction,
    subheadlineHighlight: highlights.get(direction.id) ?? ""
  }));
}

export function buildHookGenerationBatches(
  input: HookGenerationHarnessRequest,
  batchSize = HOOK_GENERATION_BATCH_SIZE
): readonly HookGenerationHarnessRequest[] {
  if (input.quantity <= batchSize) return [input];

  const batches = input.contentTypeQuotas.flatMap((quota) => {
    const counts: number[] = [];
    for (let remaining = quota.count; remaining > 0; remaining -= batchSize) {
      counts.push(Math.min(batchSize, remaining));
    }
    return counts.map((count) => ({
      ...input,
      service: quota.service,
      quantity: count,
      contentTypeQuotas: [{ service: quota.service, count }]
    }));
  });

  return batches.map((batch, index) => ({
    ...batch,
    extraInstructions: [
      batch.extraInstructions,
      `High-volume batch ${index + 1}/${batches.length}. Develop ideas that are meaningfully different from the supplied existing hooks.`
    ]
      .filter(Boolean)
      .join("\n")
  }));
}

function makeDirectionIdsUnique(
  directions: readonly GeneratedDirection[]
): readonly GeneratedDirection[] {
  const seen = new Map<string, number>();
  return directions.map((direction) => {
    const count = (seen.get(direction.id) ?? 0) + 1;
    seen.set(direction.id, count);
    return count === 1
      ? direction
      : { ...direction, id: `${direction.id}-batch-${count}` };
  });
}

function chunk<T>(items: readonly T[], size: number): readonly T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function mapWithConcurrency<Input, Output>(
  items: readonly Input[],
  concurrency: number,
  task: (item: Input, index: number) => Promise<Output>
): Promise<readonly Output[]> {
  const results = new Array<Output>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await task(item, index);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), items.length) },
      () => worker()
    )
  );
  return results;
}

async function withTransientRetry<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    const message = readableError(error);
    if (!/\b(429|500|502|503|504)\b/.test(message)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 600));
    return task();
  }
}

function containsForbiddenThaiFirstPerson(value: unknown): boolean {
  return JSON.stringify(value).includes("ฉัน");
}

function buildThaiNaturalnessRetryPrompt(
  inputText: string,
  stage: "candidate" | "direction" | "caption"
): string {
  return [
    inputText,
    "",
    "# THAI NATURALNESS CORRECTION — REQUIRED",
    `คำตอบ ${stage} ก่อนหน้าถูกปฏิเสธเพราะมีคำว่า “ฉัน”.`,
    THAI_NATURALNESS_RULE,
    "เขียนใหม่ทั้ง JSON โดยรักษา facts, strategic angle, quota, ids และ schema เดิม."
  ].join("\n");
}

function isAlbumPanelCountContractError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /^directions\[\d+\]\.formatBeats must contain exactly \d+ items for (?:three|four)-(?:vertical|horizontal|grid)\.$/.test(
      error.message
    )
  );
}

function buildAlbumPanelCountRetryPrompt(
  inputText: string,
  validationError: string
): string {
  return [
    inputText,
    "",
    "# ALBUM PANEL COUNT CORRECTION — REQUIRED",
    `คำตอบก่อนหน้าถูกปฏิเสธ: ${validationError}`,
    "เขียนใหม่ทั้ง JSON โดยรักษา Direction, facts, quota, ids และ schema เดิม.",
    "สำหรับ album-post เท่านั้น: three-vertical และ three-horizontal ต้องมี formatBeats 2 ข้อ; four-vertical และ four-grid ต้องมี formatBeats 3 ข้อ. หนึ่งข้อต่อหนึ่ง supporting panel และไม่นับ cover."
  ].join("\n");
}

function assertNoForbiddenThaiFirstPerson(
  value: unknown,
  outputName: string
): void {
  if (containsForbiddenThaiFirstPerson(value)) {
    throw new Error(`${outputName} still contains forbidden Thai copy: ฉัน.`);
  }
}

function buildSubheadlineHighlightPrompt(
  items: readonly { id: string; subheadline: string }[]
): string {
  return [
    "Bold the sentence of this text that you think it's a highlight of this sub-headline",
    "Rules:",
    "- Return JSON only.",
    "- Use exact text spans from subheadline. Do not rewrite.",
    "- Prefer only the strongest strategic noun, product/service term, audience pain, proof, or conversion angle.",
    "- Avoid generic words, filler, conjunctions, and common Thai particles.",
    "- If the subheadline has no clearly important term, return an empty array.",
    "",
    "Return this exact shape:",
    "{",
    '  "items": [',
    '    { "id": "same id", "highlights": ["one exact continuous clause"] }',
    "  ]",
    "}",
    "",
    "Items:",
    JSON.stringify(items, null, 2)
  ].join("\n");
}

async function callResponsesApi({
  apiKey,
  model,
  fetchImpl,
  content,
  schemaName,
  schema,
  tools,
  toolChoice,
  reasoningEffort,
  provider = "openai"
}: {
  apiKey: string;
  model: string;
  fetchImpl: FetchLike;
  content: readonly ResponseContent[];
  schemaName: string;
  schema: unknown;
  tools?: readonly Record<string, unknown>[];
  toolChoice?: "required";
  reasoningEffort?: "high";
  provider?: "openai" | "openrouter";
}): Promise<unknown> {
  const providerLabel = provider === "openrouter" ? "OpenRouter" : "OpenAI";
  const endpoint =
    provider === "openrouter"
      ? OPENROUTER_CHAT_COMPLETIONS_ENDPOINT
      : OPENAI_RESPONSES_ENDPOINT;
  const buildBody = (requestContent: readonly ResponseContent[]) =>
    provider === "openrouter"
      ? {
          model,
          messages: [
            {
              role: "user",
              content: requestContent.map((item) =>
                item.type === "input_text"
                  ? { type: "text" as const, text: item.text }
                  : {
                      type: "image_url" as const,
                      image_url: { url: item.image_url }
                    }
              )
            }
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: schemaName,
              strict: true,
              schema
            }
          },
          provider: {
            require_parameters: true
          }
        }
      : {
          model,
          store: false,
          input: [
            {
              role: "user",
              content: requestContent
            }
          ],
          ...(tools?.length ? { tools } : {}),
          ...(toolChoice ? { tool_choice: toolChoice } : {}),
          ...(reasoningEffort
            ? { reasoning: { effort: reasoningEffort } }
            : {}),
          text: {
            format: {
              type: "json_schema",
              name: schemaName,
              strict: true,
              schema
            }
          }
        };
  const send = (requestContent: readonly ResponseContent[]) =>
    fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(buildBody(requestContent))
    });

  let response = await send(content);

  if (!response.ok) {
    let detail = await readProviderErrorDetail(response);
    if (
      provider === "openrouter" &&
      response.status === 400 &&
      isImageDownloadError(detail) &&
      content.some(
        (item) =>
          item.type === "input_image" && /^https?:\/\//i.test(item.image_url)
      )
    ) {
      try {
        const inlinedContent = await inlineRemoteImages(content, fetchImpl);
        response = await send(inlinedContent);
        if (response.ok) {
          return readJsonResponse(response, `${providerLabel} hook harness`);
        }
        detail = await readProviderErrorDetail(response);
      } catch (error) {
        detail = `${detail} Retrying with an inline image failed: ${readableError(error)}`;
      }
    }

    throw new Error(
      `${providerLabel} hook harness failed: ${response.status}${detail ? ` — ${detail}` : ""}`
    );
  }

  return readJsonResponse(response, `${providerLabel} hook harness`);
}

function buildDirectHookGenerationPrompt(
  input: HookGenerationHarnessRequest,
  agentHookPrompt: string,
  pastPosts: readonly PastPostExample[]
): string {
  const pastPostExamples = selectPastPostsForCaption(pastPosts);
  const researchInstructions =
    input.hookIdeaMode === "fresh-research"
      ? [
          "Research status: enabled. ใช้ Web Search ในบริบทประเทศไทยและทำตาม ## Research ใน agent_hook.md.",
          "citations ใส่เฉพาะแหล่งที่ถูกใช้เป็นหลักฐานของข้อมูลใน Direction จริง."
        ]
      : [
          "Research status: disabled. ใช้เฉพาะข้อมูลที่ยืนยันใน input นี้และห้ามค้นเว็บ.",
          "citations ต้องเป็น []. ห้ามเดา external fact, offer หรือ claim ที่ไม่มีใน input."
        ];
  return [
    agentHookPrompt.trim(),
    "",
    "# ONE CREATIVE PASS — FINISHED OPTIONS ONLY",
    ...researchInstructions,
    "คิดและเปรียบเทียบทางเลือกภายในก่อนตอบ แล้วคืน directions ที่ผลิตต่อได้จริงครบตาม quota รวมตัวเลือกเพิ่ม — ห้ามคืน brainstorm หรือ candidate pool.",
    "",
    buildInputBlock(input),
    ...(pastPostExamples.length
      ? [
          "",
          "# Past posts — direct brand evidence",
          "ใช้โพสต์เหล่านี้เพื่อเข้าใจ mood, style, language, rhythm, personality, CTA behavior และรายละเอียดที่แบรนด์เคยสื่อสาร โดยให้ Current Brief มีลำดับสูงสุด.",
          "ห้ามนำ Hook, slogan, joke, campaign angle, narrative structure, content format หรือ creative execution จากโพสต์เก่ามาทำซ้ำ. Past posts ไม่ใช่ตัวอย่างที่ต้องทำตาม.",
          ...pastPostExamples.map(
            (post, index) =>
              `${index + 1}. [${post.source === "organic_post" ? "โพสต์ organic" : "แคปชั่นโฆษณา"}] ${post.text}`
          )
        ]
      : []),
    "",
    "# Quality gate",
    "ตัด Direction ที่ซ้ำ Generic ไม่ตรง Brief ไม่เหมาะกับแบรนด์ ผลิตไม่ได้ หรือใช้ข้อมูลที่ยืนยันไม่ได้.",
    "อย่านำวิธีคิดหรือวิธีเล่าชุดเดียวมาเป็นค่าเริ่มต้นของทั้งชุด. ให้เนื้อหาและแบรนด์เป็นตัวกำหนดรูปแบบของแต่ละ Direction.",
    "",
    "# Required output mix",
    `คืน ${input.quantity} directions ให้ครบและเรียงตาม quota นี้: ${JSON.stringify(contentTypeQuotasForPrompt(input))}`,
    "sourceCandidateId ใช้ id ภายในแบบ direct-01, direct-02 และห้ามซ้ำกัน.",
    "",
    "# Format",
    "- single-static และ resize: formatBeats = [], albumFormat = null และ ugcBrief = null.",
    albumHookInstruction(
      input.albumFormat ?? defaultAlbumFormatPreference
    ),
    "- album-post: ugcBrief = null.",
    "- ugc-video: albumFormat = null. ส่ง ugcBrief ที่คนพูดและถ่ายตามได้จริง แต่เลือกวิธีเล่า จังหวะ ลำดับ และจำนวน formatBeats ตามความเหมาะสมของ Direction โดยไม่มี narrative sequence บังคับ.",
    "- motion-static: albumFormat = null, ugcBrief = null และใช้ formatBeats เท่าที่จำเป็นต่อแนวคิด ไม่มีจำนวนหรือ narrative sequence บังคับ.",
    "Format เป็นข้อกำหนดการผลิต ไม่ใช่ Creative Framework. ให้ Creative Mechanism ของ Album และ UGC เกิดจาก Direction นั้นเอง ไม่ใช่รูปแบบเริ่มต้นที่ใช้ซ้ำทุกไอเดีย.",
    "",
    "# Copy",
    THAI_NATURALNESS_RULE,
    "เลือกภาษา น้ำเสียง ความยาว จังหวะ และระดับการขายตาม Current Brief, audience และเสียงจริงของแบรนด์ โดยไม่ใช้ Copy template เดียวกันทั้งชุด.",
    "Hook ต้องเป็น final consumer-facing copy ไม่ใช่ชื่อ strategy หรือบทสรุปงานวิจัย. Caption และ CTA ต้องเป็นส่วนหนึ่งของ Direction เดียวกันอย่างเป็นธรรมชาติ.",
    "caption และ cta ภาษาไทยห้ามมีคำลงท้าย ‘ครับ’ หรือ ‘ค่ะ’.",
    "",
    "# Output",
    "ตอบเฉพาะ JSON schema. ตรวจ quota, ความไม่ซ้ำ, Brand/Campaign Truth, ความเหมาะสมกับ Format และความสอดคล้องภายใน Direction ก่อนส่ง.",
    "score สะท้อนคุณภาพจริงของ Direction และ reasoning อธิบายสั้น ๆ ว่าทำไมแนวคิดนี้เหมาะกับแบรนด์ ผู้ชม และโจทย์ โดยไม่ต้องใช้โครงคำตอบตายตัว."
  ].join("\n");
}

function selectPastPostsForCaption(
  pastPosts: readonly PastPostExample[]
): readonly PastPostExample[] {
  const adCaptions = pastPosts.filter((post) => post.source === "ad_caption");
  const organicPosts = pastPosts.filter(
    (post) => post.source === "organic_post"
  );
  return [
    ...adCaptions.slice(0, 4),
    ...organicPosts.slice(0, 2),
    ...adCaptions.slice(4),
    ...organicPosts.slice(2)
  ].slice(0, 6);
}

function buildInputBlock(input: HookGenerationHarnessRequest): string {
  const brief = hookRelevantBrief(input.brief);
  const roundInstructions = hookRelevantRoundInstructions(
    input.extraInstructions
  );
  const brandContext = input.brandLibrary.brand.filter(
    isHookRelevantLibraryItem
  );
  const supportingDocuments = input.brandLibrary.docs.filter(
    isHookRelevantLibraryItem
  );

  return [
    "## Creative Compass current input",
    `Hook idea mode: ${input.hookIdeaMode}`,
    `Brand: ${input.brand?.name ?? "Unknown"}`,
    `Category: ${input.brand?.category ?? "Unknown"}`,
    `Service: ${input.service}`,
    `Content-type quotas: ${JSON.stringify(contentTypeQuotasForPrompt(input))}`,
    `Album layout preference: ${input.albumFormat ?? defaultAlbumFormatPreference}`,
    "",
    "User Brief — HIGHEST PRIORITY:",
    brief,
    "",
    ...(input.onboardingQuestionnaire.trim()
      ? [
          "Onboarding Questionnaire — standing brand context; use every run, but never override the current User Brief:",
          input.onboardingQuestionnaire.trim(),
          ""
        ]
      : []),
    ...(roundInstructions
      ? [
          "Additional direction for this round — HIGH PRIORITY, on top of the brief above:",
          roundInstructions,
          ""
        ]
      : []),
    ...(input.existingHooks.length
      ? [
          "Hooks already generated and shown to the user in this run — DO NOT repeat these hooks, concepts, or angles. Every new idea must be meaningfully different (new audience moment, new angle, new proof point, new visual metaphor — not just reworded):",
          ...input.existingHooks.map(
            (item, index) => `${index + 1}. Hook: ${item.hook} — Concept: ${item.concept}`
          ),
          ""
        ]
      : []),
    "Brand Memory — What's working:",
    ...input.brandMemory.working.map(
      (item) => `- ${cleanHookContextText(item)}`
    ),
    "",
    "Brand Memory — What to avoid:",
    ...input.brandMemory.avoid.map(
      (item) => `- ${cleanHookContextText(item)}`
    ),
    "",
    ...(brandContext.length
      ? [
          "Brand context — strategy and voice only:",
          ...brandContext.map(
            (item) =>
              `- ${item.title}: ${cleanHookContextText(item.description)}`
          ),
          ""
        ]
      : []),
    "Products / offers / benefits / audience / claim notes:",
    ...input.brandLibrary.products.map(
      (item) =>
        `- ${item.title}: ${cleanHookContextText(item.description)}`
    ),
    "",
    ...(supportingDocuments.length
      ? [
          "Supporting factual documents:",
          ...supportingDocuments.map(
            (item) =>
              `- ${item.title}: ${cleanHookContextText(item.description)}`
          ),
          ""
        ]
      : []),
    "Uploaded creative image materials (the images follow this text in the same order):",
    ...input.uploadedMaterials.map(
      (item, index) =>
        `${index + 1}. ${item.name} | role=${item.role} | usage note=${item.description || "No additional note"}`
    )
  ].join("\n");
}

function hookRelevantBrief(value: string): string {
  const trimmed = value.trim();
  const questionnaireMarkers = [
    /launch questionnaire/i,
    /please complete the questionnaire/i,
    /about your (?:brand|business)/i,
    /products, customers\s*&\s*competitors/i
  ];
  const markerCount = questionnaireMarkers.filter((pattern) =>
    pattern.test(trimmed)
  ).length;
  if (markerCount < 2) return trimmed;

  return "ไม่มี Current Campaign Brief แยกจากข้อมูล Onboarding. ให้สร้างไอเดียจาก Brand context, Products, audience, content-type quotas และ success metric ที่ยืนยันแล้ว โดยห้ามเดา offer หรือ campaign claim.";
}

function hookRelevantRoundInstructions(value: string): string {
  return value
    .split("\n")
    .filter((line) => !line.trim().startsWith("Creative mix quota:"))
    .join("\n")
    .trim();
}

function isHookRelevantLibraryItem(item: {
  title: string;
  description: string;
}): boolean {
  return !/(?:^logo$|visual guidance|brand ci|brand guideline|style guide|identity guideline|art direction|typography|font|colou?r system|graphic system|layout)/i.test(
    item.title.trim()
  );
}

function cleanHookContextText(value: string): string {
  return value
    .split("\n")
    .filter(
      (line) => !/^source:\s*brand_analysis_jobs\//i.test(line.trim())
    )
    .join("\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
}

const servicePromptLabels: Record<ServiceType, string> = {
  "single-static": "STATIC AD",
  "album-post": "ALBUM AD",
  "motion-static": "SHORT VIDEO",
  resize: "RESIZE",
  "ugc-video": "UGC VIDEO"
};

function contentTypeQuotasForPrompt(input: HookGenerationHarnessRequest) {
  return input.contentTypeQuotas.map((quota) => ({
    service: quota.service,
    type: servicePromptLabels[quota.service],
    count: quota.count
  }));
}


const stringArraySchema = {
  type: "array",
  items: { type: "string" }
} as const;


const hookGenerationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    directions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          sourceCandidateId: { type: "string" },
          service: { type: "string", enum: serviceTypes },
          hook: { type: "string" },
          subheadline: { type: "string" },
          concept: { type: "string" },
          why: { type: "string" },
          visual: { type: "string" },
          cta: { type: "string" },
          supportingPoints: stringArraySchema,
          albumFormat: {
            type: ["string", "null"],
            enum: [...albumFormats, null]
          },
          formatBeats: {
            type: "array",
            items: { type: "string" }
          },
          ugcBrief: {
            type: ["object", "null"],
            additionalProperties: false,
            properties: {
              product: { type: "string" },
              duration: { type: "string" },
              objective: { type: "string" },
              moodAndTone: { type: "string" },
              productionStyle: { type: "string" },
              referenceDirection: { type: "string" }
            },
            required: [
              "product",
              "duration",
              "objective",
              "moodAndTone",
              "productionStyle",
              "referenceDirection"
            ]
          },
          ctaActionType: { type: "string", enum: ctaActionTypes },
          ctaDestination: { type: "string" },
          contactLine: { type: "string" },
          caption: { type: "string" },
          score: { type: "number" },
          reasoning: { type: "string" },
          citations: stringArraySchema
        },
        required: [
          "id",
          "sourceCandidateId",
          "service",
          "hook",
          "subheadline",
          "concept",
          "why",
          "visual",
          "cta",
          "supportingPoints",
          "albumFormat",
          "formatBeats",
          "ugcBrief",
          "ctaActionType",
          "ctaDestination",
          "contactLine",
          "caption",
          "score",
          "reasoning",
          "citations"
        ]
      }
    }
  },
  required: ["directions"]
} as const;



const subheadlineHighlightSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          highlights: {
            type: "array",
            maxItems: 1,
            items: { type: "string" }
          }
        },
        required: ["id", "highlights"]
      }
    }
  },
  required: ["items"]
} as const;

function parseRequestBody(value: unknown): HookGenerationHarnessRequest {
  if (!isRecord(value)) throw new Error("Invalid hook generation request.");

  const runId = readString(value.runId, "runId");
  const service = readString(value.service, "service");
  const quantity = readNumber(value.quantity, "quantity");
  const brief = readString(value.brief, "brief");
  const attachments = readStringArray(value.attachments, "attachments");
  const uploadedMaterials = readUploadedMaterials(value.uploadedMaterials);
  const brandMemory = readRecord(value.brandMemory, "brandMemory");
  const brandLibrary = readRecord(value.brandLibrary, "brandLibrary");

  const contentTypeQuotas = readContentTypeQuotas(
    value.contentTypeQuotas,
    service as ServiceType,
    quantity
  );

  return {
    runId,
    hookIdeaMode: readHookIdeaMode(value.hookIdeaMode),
    generationModel: readHookGenerationModel(value.generationModel),
    albumFormat: readAlbumFormat(value.albumFormat),
    brand: value.brand === null ? null : parseBrand(value.brand),
    service: service as HookGenerationHarnessRequest["service"],
    quantity,
    contentTypeQuotas,
    brief,
    onboardingQuestionnaire:
      typeof value.onboardingQuestionnaire === "string"
        ? value.onboardingQuestionnaire.trim()
        : "",
    extraInstructions:
      typeof value.extraInstructions === "string"
        ? value.extraInstructions
        : "",
    existingHooks: readExistingHooks(value.existingHooks),
    attachments,
    uploadedMaterials,
    brandMemory: {
      working: readStringArray(brandMemory.working, "brandMemory.working"),
      avoid: readStringArray(brandMemory.avoid, "brandMemory.avoid")
    },
    brandLibrary: {
      brand: readLibraryItems(brandLibrary.brand, "brandLibrary.brand"),
      products: readLibraryItems(
        brandLibrary.products,
        "brandLibrary.products"
      ),
      docs: readLibraryItems(brandLibrary.docs, "brandLibrary.docs"),
      refs: readLibraryItems(brandLibrary.refs, "brandLibrary.refs")
    }
  };
}

function readAlbumFormat(value: unknown): AlbumFormatPreference {
  if (value === undefined) return defaultAlbumFormatPreference;
  if (
    typeof value === "string" &&
    albumFormatPreferences.includes(value as AlbumFormatPreference)
  ) {
    return value as AlbumFormatPreference;
  }
  throw new Error("albumFormat is invalid.");
}

function albumHookInstruction(
  preference: AlbumFormatPreference
): string {
  if (preference === "auto") {
    return [
      "- album-post: เลือก albumFormat ที่รองรับ Direction ได้เหมาะที่สุด โดยใช้ Format เป็นพื้นที่จัดวาง ไม่ใช่สูตรความคิด:",
      "  - three-vertical: vertical cover + 2 supporting panels; formatBeats ต้องมี 2 ข้อ หนึ่งข้อต่อ supporting panel.",
      "  - three-horizontal: horizontal cover + 2 supporting panels; formatBeats ต้องมี 2 ข้อ หนึ่งข้อต่อ supporting panel.",
      "  - four-vertical: vertical cover + 3 supporting panels; formatBeats ต้องมี 3 ข้อ หนึ่งข้อต่อ supporting panel.",
      "  - four-grid: cover + 3 supporting panels; formatBeats ต้องมี 3 ข้อ หนึ่งข้อต่อ supporting panel.",
      "  ให้แต่ละ Panel มีหน้าที่ใน Direction เดียวกัน แต่เลือกสาร ลำดับ จังหวะ และวิธีชวนดูต่อได้อย่างอิสระ โดยไม่ใช้ Creative Mechanism สำเร็จรูปเป็นค่าเริ่มต้น."
    ].join("\n");
  }
  const format = preference;
  const layout =
    format === "three-vertical"
      ? "3 images: vertical cover on the left with two square panels on the right"
      : format === "three-horizontal"
        ? "3 images: horizontal cover on top with two square panels below"
        : format === "four-vertical"
          ? "4 images: vertical cover on the left with three square panels on the right"
          : "4 images: four square panels in a 2 by 2 grid";
  const supportingPanelCount = format.startsWith("three-") ? 2 : 3;
  return `- album-post: Selected layout is ${layout}. ใช้ Format เป็นพื้นที่จัดวาง ไม่ใช่สูตรความคิด. formatBeats ต้องมี ${supportingPanelCount} ข้อ หนึ่งข้อต่อ supporting panel. ให้แต่ละ Panel มีหน้าที่ใน Direction เดียวกัน แต่เลือกสาร ลำดับ จังหวะ และวิธีชวนดูต่อได้อย่างอิสระ โดยไม่ใช้ Creative Mechanism สำเร็จรูปเป็นค่าเริ่มต้น.`;
}

function readHookIdeaMode(value: unknown): HookIdeaMode {
  if (value === undefined) return defaultHookIdeaMode;
  if (value === "standard" || value === "fresh-research") return value;
  throw new Error("hookIdeaMode is invalid.");
}

function readHookGenerationModel(value: unknown): HookGenerationModel {
  if (value === undefined) return DEFAULT_MODEL;
  if (
    typeof value === "string" &&
    hookGenerationModels.includes(value as HookGenerationModel)
  ) {
    return value as HookGenerationModel;
  }
  throw new Error("generationModel is invalid.");
}

function readUploadedMaterials(
  value: unknown
): HookGenerationHarnessRequest["uploadedMaterials"] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error("uploadedMaterials must be an array.");
  }
  if (value.length > 8) {
    throw new Error("uploadedMaterials supports up to 8 images.");
  }

  const roles = new Set([
    "main-object",
    "product",
    "supporting-component",
    "client-context"
  ]);
  return value.map((candidate, index) => {
    const item = readRecord(candidate, `uploadedMaterials[${index}]`);
    const role = readString(item.role, `uploadedMaterials[${index}].role`);
    const url = readString(item.url, `uploadedMaterials[${index}].url`);
    if (!roles.has(role)) {
      throw new Error(`uploadedMaterials[${index}].role is invalid.`);
    }
    if (!/^https?:\/\//i.test(url) && !/^data:image\//i.test(url)) {
      throw new Error(`uploadedMaterials[${index}].url must be an image URL.`);
    }
    return {
      id: readString(item.id, `uploadedMaterials[${index}].id`),
      name: readString(item.name, `uploadedMaterials[${index}].name`),
      mediaType: readString(
        item.mediaType,
        `uploadedMaterials[${index}].mediaType`
      ),
      role: role as HookGenerationHarnessRequest["uploadedMaterials"][number]["role"],
      description:
        typeof item.description === "string" ? item.description.trim() : "",
      url
    };
  });
}

function readExistingHooks(
  value: unknown
): HookGenerationHarnessRequest["existingHooks"] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(isRecord)
    .filter(
      (item) =>
        typeof item.hook === "string" && typeof item.concept === "string"
    )
    .map((item) => ({
      hook: item.hook as string,
      concept: item.concept as string
    }));
}

function readContentTypeQuotas(
  value: unknown,
  fallbackService: ServiceType,
  expectedTotal: number
): HookGenerationHarnessRequest["contentTypeQuotas"] {
  if (value === undefined) {
    return [{ service: fallbackService, count: expectedTotal }];
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("contentTypeQuotas must be a non-empty array.");
  }

  const quotas = value.map((item, index) => {
    const quota = readRecord(item, `contentTypeQuotas[${index}]`);
    const count = readNumber(quota.count, `contentTypeQuotas[${index}].count`);
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(`contentTypeQuotas[${index}].count must be a positive integer.`);
    }
    return {
      service: readServiceType(
        quota.service,
        `contentTypeQuotas[${index}].service`
      ),
      count
    };
  });

  const total = quotas.reduce((sum, quota) => sum + quota.count, 0);
  if (total !== expectedTotal) {
    throw new Error(
      `contentTypeQuotas total ${total} does not match quantity ${expectedTotal}.`
    );
  }
  return quotas;
}

function parseBrand(value: unknown): HookGenerationHarnessRequest["brand"] {
  const brand = readRecord(value, "brand");
  return {
    id: readString(brand.id, "brand.id"),
    name: readString(brand.name, "brand.name"),
    category: readString(brand.category, "brand.category")
  };
}

function readLibraryItems(
  value: unknown,
  field: string
): HookGenerationHarnessRequest["brandLibrary"]["brand"] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);

  return value.map((item, index) => {
    const record = readRecord(item, `${field}[${index}]`);
    return {
      title: readString(record.title, `${field}[${index}].title`),
      description: readString(
        record.description,
        `${field}[${index}].description`
      )
    };
  });
}



function validateGeneratedDirectionQuotas(
  directions: readonly GeneratedDirection[],
  input: HookGenerationHarnessRequest
): void {
  if (directions.length !== input.quantity) {
    throw new Error(
      `Hook generation returned ${directions.length} of ${input.quantity} requested ideas. Please retry the run.`
    );
  }
  for (const quota of input.contentTypeQuotas) {
    const actualCount = directions.filter(
      (direction) => direction.service === quota.service
    ).length;
    if (actualCount !== quota.count) {
      throw new Error(
        `Hook generation returned ${actualCount} of ${quota.count} required directions for ${quota.service}.`
      );
    }
  }
}

function parseHookGenerationResult(text: string): HookGenerationResult {
  const parsed = JSON.parse(text) as unknown;
  const value = readRecord(parsed, "hookGeneration");

  if (!Array.isArray(value.directions)) {
    throw new Error("directions must be an array.");
  }

  return {
    directions: value.directions.map((item, index) => {
      const direction = readRecord(item, `directions[${index}]`);
      const service = readServiceType(
        direction.service,
        `directions[${index}].service`
      );
      const rawFormatBeats =
        direction.formatBeats === undefined
          ? []
          : readStringArray(
              direction.formatBeats,
              `directions[${index}].formatBeats`
            );
      const hook = readString(direction.hook, `directions[${index}].hook`);
      const concept = readString(
        direction.concept,
        `directions[${index}].concept`
      );
      const why = readString(direction.why, `directions[${index}].why`);
      const visual = readString(direction.visual, `directions[${index}].visual`);
      const cta = readString(direction.cta, `directions[${index}].cta`);
      const caption = readString(
        direction.caption,
        `directions[${index}].caption`
      );
      const albumFormat =
        service === "album-post"
          ? readGeneratedAlbumFormat(
              direction.albumFormat,
              `directions[${index}].albumFormat`
            )
          : "three-horizontal";
      const formatBeats = validateFormatBeats(
        service,
        rawFormatBeats,
        index,
        albumFormat
      );
      const ugcBrief =
        service === "ugc-video"
          ? readUgcVideoBrief(direction.ugcBrief, `directions[${index}].ugcBrief`, {
              hook,
              concept,
              why,
              visual,
              cta,
              caption,
              formatBeats
            })
          : undefined;
      return {
        id: readString(direction.id, `directions[${index}].id`),
        sourceCandidateId: readString(
          direction.sourceCandidateId,
          `directions[${index}].sourceCandidateId`
        ),
        service,
        hook,
        subheadline: readString(
          direction.subheadline,
          `directions[${index}].subheadline`
        ),
        concept,
        why,
        visual,
        cta,
        supportingPoints:
          direction.supportingPoints === undefined
            ? []
            : readStringArray(
                direction.supportingPoints,
                `directions[${index}].supportingPoints`
              ),
        albumFormat,
        formatBeats,
        ...(ugcBrief ? { ugcBrief } : {}),
        ctaActionType:
          direction.ctaActionType === undefined
            ? "other"
            : readCtaActionType(
                direction.ctaActionType,
                `directions[${index}].ctaActionType`
              ),
        ctaDestination:
          direction.ctaDestination === undefined
            ? ""
            : readString(
                direction.ctaDestination,
                `directions[${index}].ctaDestination`
              ),
        contactLine:
          direction.contactLine === undefined
            ? ""
            : readString(
                direction.contactLine,
                `directions[${index}].contactLine`
              ),
        caption,
        score: readNumber(direction.score, `directions[${index}].score`),
        reasoning: readString(
          direction.reasoning,
          `directions[${index}].reasoning`
        ),
        citations: readStringArray(
          direction.citations,
          `directions[${index}].citations`
        )
      };
    })
  };
}

function readGeneratedAlbumFormat(
  value: unknown,
  field: string
): AlbumFormat {
  if (
    typeof value !== "string" ||
    !albumFormats.includes(value as AlbumFormat)
  ) {
    throw new Error(`${field} is invalid.`);
  }
  return value as AlbumFormat;
}

function validateFormatBeats(
  service: ServiceType,
  beats: readonly string[],
  index: number,
  albumFormat: AlbumFormat
): readonly string[] {
  if (service === "single-static" || service === "resize") return [];
  const normalized = beats.map((beat) => beat.trim()).filter(Boolean);
  if (service !== "album-post") return normalized;

  const expectedCount = albumFormat.startsWith("three-") ? 2 : 3;
  if (normalized.length !== expectedCount) {
    throw new Error(
      `directions[${index}].formatBeats must contain exactly ${expectedCount} items for ${albumFormat}.`
    );
  }
  return normalized;
}

function readUgcVideoBrief(
  value: unknown,
  field: string,
  fallback: {
    hook: string;
    concept: string;
    why: string;
    visual: string;
    cta: string;
    caption: string;
    formatBeats: readonly string[];
  }
): UgcVideoBrief {
  const openingScript =
    fallback.formatBeats[0] ?? fallback.hook;
  const showcaseScript =
    fallback.formatBeats.length > 2
      ? fallback.formatBeats.slice(1, -1).join(" / ")
      : fallback.concept;
  const closingScript =
    fallback.formatBeats.length > 1
      ? fallback.formatBeats[fallback.formatBeats.length - 1]!
      : fallback.cta;

  if (value === undefined) {
    return {
      product: "สินค้า/บริการตาม Brief",
      duration: "15–30 วินาที",
      objective: fallback.why,
      moodAndTone: fallback.visual,
      productionStyle: "Creator-led vertical video ที่เป็นธรรมชาติและตัดต่อกระชับ",
      referenceDirection: fallback.visual,
      openingScript,
      showcaseScript,
      closingScript
    };
  }

  const record = readRecord(value, field);
  return {
    product: readString(record.product, `${field}.product`),
    duration: readString(record.duration, `${field}.duration`),
    objective: readString(record.objective, `${field}.objective`),
    moodAndTone: readString(record.moodAndTone, `${field}.moodAndTone`),
    productionStyle: readString(
      record.productionStyle,
      `${field}.productionStyle`
    ),
    referenceDirection: readString(
      record.referenceDirection,
      `${field}.referenceDirection`
    ),
    openingScript,
    showcaseScript,
    closingScript
  };
}

function parseSubheadlineHighlights(
  text: string,
  items: readonly { id: string; subheadline: string }[]
): ReadonlyMap<string, string> {
  const parsed = JSON.parse(text) as unknown;
  const value = readRecord(parsed, "subheadlineHighlights");
  if (!Array.isArray(value.items)) {
    throw new Error("highlight items must be an array.");
  }

  const subheadlineById = new Map(
    items.map((item) => [item.id, item.subheadline])
  );
  const highlights = new Map<string, string>();

  value.items.forEach((item, index) => {
    const record = readRecord(item, `items[${index}]`);
    const id = readString(record.id, `items[${index}].id`);
    const candidates = readStringArray(
      record.highlights,
      `items[${index}].highlights`
    );
    const subheadline = subheadlineById.get(id);
    if (subheadline === undefined) return;

    const candidate = candidates[0]?.replace(/\s+/g, " ").trim() ?? "";
    const normalizedSubheadline = subheadline.replace(/\s+/g, " ").trim();
    highlights.set(
      id,
      candidate && normalizedSubheadline.includes(candidate) ? candidate : ""
    );
  });

  return highlights;
}

function extractResponseText(payload: unknown): string {
  if (isRecord(payload) && typeof payload.output_text === "string") {
    return payload.output_text;
  }

  if (isRecord(payload) && Array.isArray(payload.choices)) {
    for (const choice of payload.choices) {
      if (!isRecord(choice) || !isRecord(choice.message)) continue;
      if (typeof choice.message.content === "string") {
        return choice.message.content;
      }
    }
  }

  if (!isRecord(payload) || !Array.isArray(payload.output)) {
    throw new Error("Hook generation response did not include output text.");
  }

  for (const item of payload.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;

    for (const content of item.content) {
      if (
        isRecord(content) &&
        content.type === "output_text" &&
        typeof content.text === "string"
      ) {
        return content.text;
      }
    }
  }

  throw new Error("Hook generation response did not include output text.");
}

async function readProviderErrorDetail(response: Response): Promise<string> {
  const text = await response.text();
  if (!text.trim()) return "";

  let detail = text;
  try {
    const payload = JSON.parse(text) as unknown;
    if (isRecord(payload)) {
      if (typeof payload.message === "string") {
        detail = payload.message;
      } else if (typeof payload.error === "string") {
        detail = payload.error;
      } else if (isRecord(payload.error)) {
        detail = providerErrorMessage(payload.error) ?? detail;
      }
    }
  } catch {
    // Plain-text provider errors are already safe to summarize below.
  }

  return sanitizeProviderError(detail);
}

function providerErrorMessage(error: Record<string, unknown>): string | null {
  const direct =
    typeof error.message === "string" ? error.message.trim() : "";
  const metadata = isRecord(error.metadata) ? error.metadata : null;

  if (metadata && typeof metadata.raw === "string") {
    try {
      const raw = JSON.parse(metadata.raw) as unknown;
      if (
        isRecord(raw) &&
        isRecord(raw.error) &&
        typeof raw.error.message === "string"
      ) {
        return raw.error.message;
      }
    } catch {
      if (metadata.raw.trim()) return metadata.raw.trim();
    }
  }

  if (metadata && Array.isArray(metadata.previous_errors)) {
    for (const item of metadata.previous_errors) {
      if (
        isRecord(item) &&
        typeof item.message === "string" &&
        item.message !== "Provider returned error"
      ) {
        return item.message;
      }
    }
  }

  return direct || null;
}

function sanitizeProviderError(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"'<>]+/gi, (match) => {
      try {
        const url = new URL(match.replace(/[),.;]+$/, ""));
        return `${url.origin}${url.pathname}`;
      } catch {
        return "[image URL]";
      }
    })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function isImageDownloadError(detail: string): boolean {
  return /unable to download (?:the )?(?:file|image)|fetching image from url|image_download_failed/i.test(
    detail
  );
}

async function inlineRemoteImages(
  content: readonly ResponseContent[],
  fetchImpl: FetchLike
): Promise<readonly ResponseContent[]> {
  return Promise.all(
    content.map(async (item): Promise<ResponseContent> => {
      if (
        item.type !== "input_image" ||
        !/^https?:\/\//i.test(item.image_url)
      ) {
        return item;
      }

      const response = await fetchImpl(item.image_url);
      if (!response.ok) {
        throw new Error(`material download returned ${response.status}`);
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > 10 * 1024 * 1024) {
        throw new Error("material image is larger than 10MB");
      }

      const contentType = response.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase();
      if (!contentType?.startsWith("image/")) {
        throw new Error("material URL did not return an image");
      }

      return {
        ...item,
        image_url: `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`
      };
    })
  );
}

function readRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  return value;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  return value;
}

function readNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a number.`);
  }
  return value;
}

function readServiceType(value: unknown, field: string): ServiceType {
  if (
    typeof value !== "string" ||
    !serviceTypes.includes(value as ServiceType)
  ) {
    throw new Error(`${field} is invalid.`);
  }
  return value as ServiceType;
}

function readCtaActionType(value: unknown, field: string): CtaActionType {
  if (
    typeof value !== "string" ||
    !ctaActionTypes.includes(value as CtaActionType)
  ) {
    throw new Error(`${field} is invalid.`);
  }
  return value as CtaActionType;
}

function readStringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be a string array.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown hook harness error.";
}

async function readJsonResponse(response: Response, label: string): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(`${label} returned an empty response body.`);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} returned a non-JSON response.`);
  }
}
