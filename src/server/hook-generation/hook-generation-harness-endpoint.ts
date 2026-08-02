import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  albumFormatPreferences,
  albumFormats,
  ctaActionTypes,
  defaultAlbumFormatPreference,
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

interface HookCandidate {
  id: string;
  service: ServiceType;
  hook: string;
  premise: string;
  primaryBenefit: string;
  creativePattern: string;
  languageDevice: string;
  audienceReason: string;
  formatIdea: string;
  citations: readonly string[];
}

interface HookCandidateResult {
  candidates: readonly HookCandidate[];
}

interface CaptionStyleResult {
  items: readonly {
    id: string;
    caption: string;
    contactLine: string;
  }[];
}

interface PastContentProfile {
  styleSignals: readonly string[];
  creativePatterns: readonly {
    pattern: string;
    whyItFitsBrand: string;
    sourcePostIndexes: readonly number[];
  }[];
  reusableDetails: readonly {
    detail: string;
    sourcePostIndexes: readonly number[];
  }[];
}

interface TracedAgentResult<T> {
  inputText: string;
  output: T;
  rawResponse: unknown;
}

interface HookGenerationBatchResult {
  candidateTrace: TracedAgentResult<HookCandidateResult>;
  directorTrace: TracedAgentResult<HookGenerationResult>;
}

const DEFAULT_MODEL = "gpt-5.6-terra";
const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-sonnet-4.6";
const DEFAULT_SUPPORT_MODEL = "gpt-5.6-luna";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const OPENROUTER_CHAT_COMPLETIONS_ENDPOINT =
  "https://openrouter.ai/api/v1/chat/completions";
const HOOK_GENERATION_BATCH_SIZE = 12;
const HOOK_GENERATION_CONCURRENCY = 3;
const HOOK_CANDIDATE_MULTIPLIER = 3;
const MIN_HOOK_CANDIDATES_PER_SERVICE = 4;
const MAX_HOOK_CANDIDATES_PER_BATCH = 36;
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
    const pastPosts = await loadPastPostExamples({
      input,
      env,
      auth,
      createPastPostsClient
    });
    const agentHookPrompt = await loadAgentHookPrompt();
    const pastContentTrace = pastPosts.length
      ? await withTransientRetry(() =>
          runPastContentProfileStep({
            input,
            pastPosts,
            apiKey: openAiApiKey,
            model: supportModel,
            fetchImpl
          })
        )
      : undefined;
    const pastContentProfile = pastContentTrace?.output;
    const generationBatches = buildHookGenerationBatches(input);
    const batchResults = await mapWithConcurrency(
      generationBatches,
      HOOK_GENERATION_CONCURRENCY,
      async (batch) => {
        const candidateTrace = await withTransientRetry(() =>
          runCandidateGenerationStep({
            input: batch,
            agentHookPrompt,
            pastContentProfile,
            apiKey: generationApiKey,
            model,
            provider: generationProvider,
            fetchImpl
          })
        );
        const directorTrace = await withTransientRetry(() =>
          runCreativeDirectorStep({
            input: batch,
            agentHookPrompt,
            pastContentProfile,
            candidates: candidateTrace.output,
            apiKey: generationApiKey,
            model,
            provider: generationProvider,
            fetchImpl
          })
        );
        return { candidateTrace, directorTrace };
      }
    );
    const directions = makeDirectionIdsUnique(
      batchResults.flatMap((result) => result.directorTrace.output.directions)
    ).slice(0, input.quantity);
    if (
      input.quantity > HOOK_GENERATION_BATCH_SIZE &&
      directions.length < input.quantity
    ) {
      throw new Error(
        `Hook generation returned ${directions.length} of ${input.quantity} requested ideas. Please retry the run.`
      );
    }
    const captionStyleTrace = pastPosts.length
      ? await withTransientRetry(() =>
          runCaptionStyleStep({
            directions,
            pastPosts,
            pastContentProfile,
            apiKey: openAiApiKey,
            model: supportModel,
            fetchImpl
          })
        )
      : undefined;
    const captionStyledDirections = captionStyleTrace
      ? applyCaptionStyles(directions, captionStyleTrace.output)
      : directions;
    const highlightedDirections = await runSubheadlineHighlightStep({
      directions: captionStyledDirections,
      apiKey: openAiApiKey,
      model: supportModel,
      fetchImpl
    });

    const debugLogDirectory = env.HOOK_GENERATION_DEBUG_LOG_DIR?.trim();
    if (debugLogDirectory) {
      await writeDebugLog(
        debugLogDirectory,
        buildHookGenerationDebugLog({
          input,
          generationBatches,
          batchResults,
          generationProvider,
          generationModel: model,
          pastContentTrace,
          captionStyleTrace,
          supportModel,
          finalDirections: highlightedDirections
        })
      );
    }

    return jsonResponse({
      ok: true,
      directions: highlightedDirections
    });
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

async function runCandidateGenerationStep({
  input,
  agentHookPrompt,
  pastContentProfile,
  apiKey,
  model,
  provider,
  fetchImpl
}: {
  input: HookGenerationHarnessRequest;
  agentHookPrompt: string;
  pastContentProfile?: PastContentProfile;
  apiKey: string;
  model: string;
  provider: "openai" | "openrouter";
  fetchImpl: FetchLike;
}): Promise<TracedAgentResult<HookCandidateResult>> {
  const inputText = buildCandidateGenerationPrompt(
    input,
    agentHookPrompt,
    pastContentProfile
  );
  const requestCandidates = (requestInputText: string) =>
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
      schemaName: "moons_hook_candidates",
      schema: hookCandidateSchema,
      tools: provider === "openai" ? [THAI_WEB_SEARCH_TOOL] : undefined,
      toolChoice: provider === "openai" ? "required" : undefined,
      provider
    });
  let finalInputText = inputText;
  let payload = await requestCandidates(finalInputText);
  let result = parseHookCandidateResult(extractResponseText(payload));
  if (containsForbiddenThaiFirstPerson(result)) {
    finalInputText = buildThaiNaturalnessRetryPrompt(inputText, "candidate");
    payload = await requestCandidates(finalInputText);
    result = parseHookCandidateResult(extractResponseText(payload));
  }
  assertNoForbiddenThaiFirstPerson(result, "Hook candidates");
  validateHookCandidateQuotas(result, input);
  return { inputText: finalInputText, output: result, rawResponse: payload };
}

async function runCreativeDirectorStep({
  input,
  agentHookPrompt,
  pastContentProfile,
  candidates,
  apiKey,
  model,
  provider,
  fetchImpl
}: {
  input: HookGenerationHarnessRequest;
  agentHookPrompt: string;
  pastContentProfile?: PastContentProfile;
  candidates: HookCandidateResult;
  apiKey: string;
  model: string;
  provider: "openai" | "openrouter";
  fetchImpl: FetchLike;
}): Promise<TracedAgentResult<HookGenerationResult>> {
  const inputText = buildCreativeDirectorPrompt(
    input,
    agentHookPrompt,
    candidates,
    pastContentProfile
  );
  const requestDirections = (requestInputText: string) =>
    callResponsesApi({
      apiKey,
      model,
      fetchImpl,
      content: [{ type: "input_text", text: requestInputText }],
      schemaName: "moons_hook_generation",
      schema: hookGenerationSchema,
      provider
    });
  let finalInputText = inputText;
  let payload = await requestDirections(finalInputText);
  let result = parseHookGenerationResult(extractResponseText(payload));
  if (containsForbiddenThaiFirstPerson(result)) {
    finalInputText = buildThaiNaturalnessRetryPrompt(inputText, "direction");
    payload = await requestDirections(finalInputText);
    result = parseHookGenerationResult(extractResponseText(payload));
  }
  assertNoForbiddenThaiFirstPerson(result, "Creative directions");
  validateCreativeDirectorSelection(result, candidates);
  const preference = input.albumFormat ?? defaultAlbumFormatPreference;
  if (preference === "auto") {
    return { inputText: finalInputText, output: result, rawResponse: payload };
  }
  return {
    inputText: finalInputText,
    output: {
      directions: result.directions.map((direction) =>
        direction.service === "album-post"
          ? { ...direction, albumFormat: preference }
          : direction
      )
    },
    rawResponse: payload
  };
}

async function runPastContentProfileStep({
  input,
  pastPosts,
  apiKey,
  model,
  fetchImpl
}: {
  input: HookGenerationHarnessRequest;
  pastPosts: readonly PastPostExample[];
  apiKey: string;
  model: string;
  fetchImpl: FetchLike;
}): Promise<TracedAgentResult<PastContentProfile>> {
  const selectedPosts = selectPastPostsForProfile(pastPosts);
  const inputText = buildPastContentProfilePrompt(input, selectedPosts);
  const payload = await callResponsesApi({
    apiKey,
    model,
    fetchImpl,
    content: [{ type: "input_text", text: inputText }],
    schemaName: "moons_past_content_profile",
    schema: pastContentProfileSchema
  });
  const output = parsePastContentProfile(
    extractResponseText(payload),
    selectedPosts.length
  );
  return { inputText, output, rawResponse: payload };
}

async function runCaptionStyleStep({
  directions,
  pastPosts,
  pastContentProfile,
  apiKey,
  model,
  fetchImpl
}: {
  directions: readonly GeneratedDirection[];
  pastPosts: readonly PastPostExample[];
  pastContentProfile?: PastContentProfile;
  apiKey: string;
  model: string;
  fetchImpl: FetchLike;
}): Promise<TracedAgentResult<CaptionStyleResult>> {
  const selectedPosts = selectPastPostsForCaption(pastPosts);
  const inputText = buildCaptionStylePrompt(
    directions,
    selectedPosts,
    pastContentProfile
  );
  const requestCaptions = (requestInputText: string) =>
    callResponsesApi({
      apiKey,
      model,
      fetchImpl,
      content: [{ type: "input_text", text: requestInputText }],
      schemaName: "moons_caption_style",
      schema: captionStyleSchema
    });
  let finalInputText = inputText;
  let payload = await requestCaptions(finalInputText);
  let output = parseCaptionStyleResult(
    extractResponseText(payload),
    directions,
    selectedPosts
  );
  if (containsForbiddenThaiFirstPerson(output)) {
    finalInputText = buildThaiNaturalnessRetryPrompt(inputText, "caption");
    payload = await requestCaptions(finalInputText);
    output = parseCaptionStyleResult(
      extractResponseText(payload),
      directions,
      selectedPosts
    );
  }
  assertNoForbiddenThaiFirstPerson(output, "Styled captions");
  return { inputText: finalInputText, output, rawResponse: payload };
}

function applyCaptionStyles(
  directions: readonly GeneratedDirection[],
  result: CaptionStyleResult
): readonly GeneratedDirection[] {
  const stylesById = new Map(result.items.map((item) => [item.id, item]));
  return directions.map((direction) => {
    const style = stylesById.get(direction.id);
    return style
      ? {
          ...direction,
          caption: style.caption,
          contactLine: style.contactLine
        }
      : direction;
  });
}

function buildHookGenerationDebugLog({
  input,
  generationBatches,
  batchResults,
  generationProvider,
  generationModel,
  pastContentTrace,
  captionStyleTrace,
  supportModel,
  finalDirections
}: {
  input: HookGenerationHarnessRequest;
  generationBatches: readonly HookGenerationHarnessRequest[];
  batchResults: readonly HookGenerationBatchResult[];
  generationProvider: "openai" | "openrouter";
  generationModel: string;
  pastContentTrace?: TracedAgentResult<PastContentProfile>;
  captionStyleTrace?: TracedAgentResult<CaptionStyleResult>;
  supportModel: string;
  finalDirections: readonly GeneratedDirection[];
}): HookGenerationDebugLog {
  return {
    kind: "hook-generation",
    createdAt: new Date().toISOString(),
    runId: input.runId,
    hookIdeaMode: input.hookIdeaMode,
    candidateAgent: {
      provider: generationProvider,
      model: generationModel,
      promptSource: "agent_prompt/agent_hook.md",
      batches: batchResults.map((result, index) => ({
        request: {
          endpoint:
            generationProvider === "openrouter"
              ? "/api/v1/chat/completions"
              : "/v1/responses",
          inputText: result.candidateTrace.inputText,
          tools:
            generationProvider === "openai" ? [THAI_WEB_SEARCH_TOOL] : [],
          ...(generationProvider === "openai"
            ? { toolChoice: "required" as const }
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
          responseSchema: "moons_hook_candidates" as const
        },
        response: {
          parsed: result.candidateTrace.output,
          raw: result.candidateTrace.rawResponse
        }
      }))
    },
    hookAgent: {
      provider: generationProvider,
      model: generationModel,
      promptSource: "agent_prompt/agent_hook.md",
      batches: batchResults.map((result) => ({
        request: {
          endpoint:
            generationProvider === "openrouter"
              ? "/api/v1/chat/completions"
              : "/v1/responses",
          inputText: result.directorTrace.inputText,
          tools: [],
          attachedImages: [],
          responseSchema: "moons_hook_generation"
        },
        response: {
          parsed: result.directorTrace.output,
          raw: result.directorTrace.rawResponse
        }
      }))
    },
    ...(pastContentTrace
      ? {
          pastContentAgent: {
            provider: "openai" as const,
            model: supportModel,
            request: {
              endpoint: "/v1/responses" as const,
              inputText: pastContentTrace.inputText,
              responseSchema: "moons_past_content_profile" as const
            },
            response: {
              parsed: pastContentTrace.output,
              raw: pastContentTrace.rawResponse
            }
          }
        }
      : {}),
    ...(captionStyleTrace
      ? {
          captionAgent: {
            provider: "openai" as const,
            model: supportModel,
            request: {
              endpoint: "/v1/responses" as const,
              inputText: captionStyleTrace.inputText,
              responseSchema: "moons_caption_style" as const
            },
            response: {
              parsed: captionStyleTrace.output,
              raw: captionStyleTrace.rawResponse
            }
          }
        }
      : {}),
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
      `High-volume batch ${index + 1}/${batches.length}. Explore a distinct strategic territory for this batch and avoid repeating any supplied existing hook.`
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

function buildCandidateGenerationPrompt(
  input: HookGenerationHarnessRequest,
  agentHookPrompt: string,
  pastContentProfile?: PastContentProfile
): string {
  return [
    agentHookPrompt.trim(),
    "",
    "# งานรอบนี้",
    buildInputBlock(input),
    ...(pastContentProfile
      ? ["", buildPastContentProfileBlock(pastContentProfile)]
      : []),
    "",
    hookSearchInstruction(input.hookIdeaMode),
    "",
    "# Divergent ideation",
    `สร้าง candidate สั้นๆ ตาม quota นี้: ${JSON.stringify(candidateTypeQuotasForPrompt(input))}`,
    "รอบนี้ยังไม่เขียน direction เต็ม, Caption, CTA หรือ production brief. หน้าที่คือเปิดพื้นที่ความคิดให้กว้างก่อนคัด.",
    "- กระจาย content archetype, จุดตั้งต้น, primary benefit, emotional entry และ language device; ห้ามเปลี่ยนเพียงคน ฉาก หรือ occasion แล้วขาย feature เดิมซ้ำ.",
    "- จุดตั้งต้นเลือกได้จาก product truth, desire, identity, useful education, demonstration, occasion, cultural observation, tension, objection, social proof, brand belief, humor หรือ wordplay เมื่อมีเหตุผลกับ Brief.",
    "- creativePattern ต้องอธิบายโครงวิธีคิดเชิงนามธรรม ไม่ใช่ชื่อฉาก เช่น visual proof, expert warning, identity listicle, product declaration หรือ occasion ritual.",
    "- ใช้ creativePatterns และ styleSignals จาก Past Content Profile เป็น evidence ว่าแบรนด์ชอบคิดและพูดแบบใด แต่ห้ามคัดลอกหัวข้อ Hook slogan มุก หรือ campaign angle เก่า.",
    "- Hook ต้องเข้าใจได้ในหนึ่งรอบอ่าน เป็นภาษาไทยธรรมชาติ มี specific tension, desire, surprise, utility หรือ identity ที่ชวนหยุดอ่าน โดยไม่ clickbait.",
    `- ${THAI_NATURALNESS_RULE}`,
    "- สำหรับ UGC ให้กระจายระหว่าง demonstration, observation, direct address, checklist, conversation, product reveal และ personal experience. ห้ามใช้ first-person confession/testimonial เป็นค่าเริ่มต้นของทั้งชุด.",
    "- audienceReason อธิบายสั้นๆ ว่าทำไมคนกลุ่มนี้จึงสนใจ; formatIdea บอกว่าความคิดทำงานกับ format นี้อย่างไร; citations ใส่เฉพาะแหล่ง Search ที่ candidate ใช้จริง.",
    "",
    ...(input.uploadedMaterials.length
      ? [
          "รูป materials ที่แนบมาคือวัตถุดิบจริงของงาน ใช้สินค้า/วัตถุที่มองเห็นได้ตาม role และห้ามเดารายละเอียดที่ไม่เห็นหรือไม่มีใน input.",
          ""
        ]
      : []),
    "# Output",
    "ตอบเฉพาะ JSON schema ที่กำหนด และคืน candidate ครบตาม quota. อย่าจัดอันดับหรือเลือกผู้ชนะในรอบนี้."
  ].join("\n");
}

function buildCreativeDirectorPrompt(
  input: HookGenerationHarnessRequest,
  agentHookPrompt: string,
  candidateResult: HookCandidateResult,
  pastContentProfile?: PastContentProfile
): string {
  return [
    agentHookPrompt.trim(),
    "",
    "# CREATIVE DIRECTOR — SELECT, SHARPEN, EXPAND",
    "Candidates ด้านล่างผ่านการค้นและแตกความคิดมาแล้ว. เปรียบเทียบทั้งชุดก่อนเลือก ห้ามเลือกตามลำดับ และห้ามสร้าง strategic angle ใหม่ที่ไม่มีใน candidates.",
    "",
    "# Current input",
    buildInputBlock(input),
    ...(pastContentProfile
      ? ["", buildPastContentProfileBlock(pastContentProfile)]
      : []),
    "",
    "# Candidate pool",
    JSON.stringify(candidateResult.candidates, null, 2),
    "",
    "# Selection test",
    `เลือกและขยาย ${input.quantity} directions ตาม quota นี้และตามลำดับ: ${JSON.stringify(contentTypeQuotasForPrompt(input))}`,
    "ผู้ชนะต้องผ่านพร้อมกัน: เข้าใจทันที, specific กับ audience/สินค้า, มีแรงให้หยุดอ่าน, เป็นเสียงของแบรนด์, format-native, ใช้ facts ถูกต้อง และช่วยให้ชุดนี้ต่างกันจริง.",
    "เปรียบเทียบแบบ relative ทั้งชุด. ตัด candidate ที่ generic, ต้องอธิบายเพิ่มจึงเข้าใจ, เล่นคำแต่ไม่ขายความคิด, คล้าย Hook เดิม หรือซ้ำ primary benefit / creativePattern / sentence template กับผู้ชนะตัวอื่น.",
    "ถ้า candidate แข็งแรงแต่ Hook ยังไม่คม ให้ sharpen ถ้อยคำได้โดยคง premise, primaryBenefit และ creativePattern เดิม. อ่านออกเสียงและตรวจคำปฏิเสธไม่ให้ความหมายกลับด้าน.",
    "อย่าบังคับทุก direction ให้เป็น pain → feature → CTA; เลือกส่วนผสมที่เหมาะกับแบรนด์และ Brief จริง.",
    "",
    "# Format",
    "คิดแต่ละ format ตามธรรมชาติของมัน ห้ามนำ Static concept เดิมไปเปลี่ยน label:",
    "- single-static: หนึ่งความคิดที่จบในภาพเดียว; formatBeats = [].",
    albumHookInstruction(
      input.albumFormat ?? defaultAlbumFormatPreference
    ),
    "- ugc-video: creator-led vertical video; formatBeats = opening tension → demo/proof → close/CTA. ugcBrief ต้องระบุ product, duration, objective, moodAndTone, productionStyle, referenceDirection และ scripts ช่วง opening/showcase/closing ที่คนถ่ายตามได้จริง.",
    "- motion-static: ความคิดต้องใช้ movement/reveal; formatBeats = opening frame → reveal → message/CTA.",
    "- resize: รักษาสารหลักของงานเดิม; formatBeats = [].",
    "- album-post, ugc-video และ motion-static ต้องมี formatBeats 3 ข้อพอดี; format อื่นต้องเป็น []. ugcBrief ของงานที่ไม่ใช่ UGC ให้ทุก field เป็น string ว่าง.",
    "",
    "# Copy และความถูกต้อง",
    `- ${THAI_NATURALNESS_RULE}`,
    "- subheadline เป็นหนึ่งประโยคสั้นที่ช่วยให้ Hook ชัดขึ้น ไม่ซ้ำ Hook และไม่อธิบาย strategy.",
    "- visual บอก mood, tone, polish และ information hierarchy 1–2 ประโยค; ไม่ล็อกฉาก ตัวละคร มุมกล้อง props หรือ layout.",
    "- supportingPoints มี 0–3 facts ที่ช่วยผลิตงาน. ใช้ reusable details ได้เมื่อเกี่ยวข้อง; ราคา โปรโมชัน หรือข้อมูลตามเวลาต้องยืนยันใน current input เท่านั้น.",
    "- Caption และ CTA ต้องฟังเหมือนแบรนด์นี้เขียนเอง. Caption เป็น draft จาก direction และข้อมูลแบรนด์ปัจจุบันเท่านั้น; ห้ามดึงหัวข้อ ข้อเสนอ หรือ claim จาก campaign เก่ามาปน. contactLine ใช้เฉพาะข้อมูลที่ยืนยัน; ไม่แน่ใจให้เป็น string ว่าง.",
    "- CTA เป็น action + object ที่ชัด 2–7 คำ. ห้ามใช้ ‘ดูที่นี่’, ‘คลิกที่นี่’, ‘สนใจทัก’ หรือ ‘ดูเพิ่มเติม’. ctaDestination ต้องมีหลักฐานหรือเป็น string ว่าง.",
    "- caption และ cta ห้ามมีคำลงท้าย ‘ครับ’ หรือ ‘ค่ะ’. ตอบภาษาไทย ยกเว้นชื่อแบรนด์ สินค้า Tagline แพลตฟอร์ม และศัพท์เฉพาะ.",
    "",
    "# Output",
    "ตอบเฉพาะ JSON schema. service ต้องตรง quota. งานที่ไม่ใช่ Album ใช้ albumFormat=three-horizontal.",
    "sourceCandidateId ต้องเป็น id ของ candidate ที่เลือกจริง เพื่อให้ตรวจย้อนกลับได้.",
    "citations ส่งต่อเฉพาะแหล่งจาก candidate ที่ direction นั้นใช้จริง. score 0–100 ต้องสะท้อนการเปรียบเทียบจริง ไม่ใช่ให้ทุกตัวเกิน 85; reasoning ระบุทั้งจุดแข็งและเหตุผลที่ตัวนี้ชนะตัวใกล้เคียงอย่างสั้นๆ."
  ].join("\n");
}

function buildPastContentProfileBlock(profile: PastContentProfile): string {
  return [
    "# Past Content Profile",
    "ใช้ส่วนนี้เป็น brand memory สำหรับ mood/style และรายละเอียดข้อมูลเท่านั้น ห้ามสร้าง Hook, Concept หรือ campaign angle จากงานเก่า.",
    "Style signals:",
    ...profile.styleSignals.map((signal) => `- ${signal}`),
    "Creative patterns:",
    ...profile.creativePatterns.map(
      (item) => `- ${item.pattern}: ${item.whyItFitsBrand}`
    ),
    "Reusable details:",
    ...profile.reusableDetails.map((item) => `- ${item.detail}`)
  ].join("\n");
}

function hookSearchInstruction(mode: HookIdeaMode): string {
  const modeInstruction =
    mode === "fresh-research"
      ? "FRESH RESEARCH MODE: ค้นหลาย query ภาษาไทยที่เจาะจงกับ Brief, audience และ category ในประเทศไทย."
      : "STANDARD MODE: ค้นอย่างน้อยหนึ่ง query ภาษาไทยที่เจาะจงกับ Brief, audience, product หรือ category ในประเทศไทย.";

  return [
    "# Search — required",
    modeInstruction,
    "ต้องเรียก Web Search ก่อน final JSON ทุก batch. ใช้เฉพาะข้อมูลปัจจุบันที่ตรวจสอบได้และเกี่ยวข้องจริง; ห้ามแต่ง trend, สถิติ, วันที่, ranking, publisher หรือผลวิจัย.",
    "THAILAND FIRST: หาก Brief ไม่ระบุประเทศอื่น ให้ถือว่ากลุ่มเป้าหมายอยู่ประเทศไทย. ใช้คำค้นภาษาไทยและเลือกแหล่งข้อมูลไทยหรือข้อมูลที่ศึกษาเกี่ยวกับผู้บริโภคไทยก่อน.",
    "ห้ามใช้พฤติกรรมผู้บริโภค สถิติ หรือ market context จาก US/global มาแทนบริบทไทย. ใช้ query ภาษาอังกฤษได้เฉพาะเมื่อภาษาไทยไม่พบข้อมูล และ query ต้องมีคำว่า Thailand หรือ ไทย.",
    "Brief และ verified brand/product facts สำคัญกว่าผลค้น. Search ใช้เพิ่ม audience insight หรือ market context เท่านั้น และไม่ต้องฝืนใช้ผลค้นในทุก direction."
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

function selectPastPostsForProfile(
  pastPosts: readonly PastPostExample[]
): readonly PastPostExample[] {
  const adCaptions = pastPosts.filter((post) => post.source === "ad_caption");
  const organicPosts = pastPosts.filter(
    (post) => post.source === "organic_post"
  );
  return [
    ...selectRecentAndHistoricalPosts(adCaptions, 6),
    ...selectRecentAndHistoricalPosts(organicPosts, 6)
  ].slice(0, 12);
}

function selectRecentAndHistoricalPosts(
  posts: readonly PastPostExample[],
  count: number
): readonly PastPostExample[] {
  if (posts.length <= count) return posts;
  const recentCount = Math.ceil(count / 2);
  const selectedIndexes = new Set(
    Array.from({ length: recentCount }, (_, index) => index)
  );
  const remainingCount = count - recentCount;
  for (let index = 1; index <= remainingCount; index += 1) {
    const position =
      recentCount +
      Math.round(
        ((posts.length - recentCount - 1) * index) / remainingCount
      );
    selectedIndexes.add(Math.min(position, posts.length - 1));
  }
  return [...selectedIndexes]
    .sort((left, right) => left - right)
    .slice(0, count)
    .map((index) => posts[index])
    .filter((post): post is PastPostExample => post !== undefined);
}

function buildPastContentProfilePrompt(
  input: HookGenerationHarnessRequest,
  pastPosts: readonly PastPostExample[]
): string {
  return [
    "# PAST CONTENT PROFILER",
    "สกัด brand memory จากโพสต์เก่า ห้ามคิดไอเดียคอนเทนต์ใหม่และห้ามส่งต่อ Hook, Concept, campaign angle หรือถ้อยคำเดิม.",
    "styleSignals: สกัดทั้ง mood/voice และกลไกภาษาที่ทำให้งานของแบรนด์จำได้ เช่น จังหวะประโยค คำคล้องจอง wordplay bilingual slogan brand declaration มุกเปรียบเทียบ premium statement emoji/hashtag และ CTA style รวม 1–8 ข้อตามหลักฐาน. ต้องเจาะจงกว่าคำกว้างๆ อย่าง ‘ขายตรง’, ‘พรีเมียม’ หรือ ‘เป็นกันเอง’.",
    "อธิบายกลไกและจังหวะของภาษาโดยไม่คัดลอก Hook, slogan หรือมุกจากโพสต์เดิมมาตรงๆ.",
    "creativePatterns: สกัดโครงวิธีคิดเชิงนามธรรมที่มีหลักฐานจริง เช่น visual proof/demo, useful education, expert warning, occasion ritual, identity listicle, social proof, brand belief หรือ product declaration. ระบุ whyItFitsBrand และ sourcePostIndexes แบบ 1-based รวม 0–8 รูปแบบ; หากหลักฐานไม่พอให้คืน []. ห้ามเก็บหัวข้อ สินค้าที่พูดถึง ฉาก ประโยค punchline หรือ campaign angle เดิม; pattern ต้องนำไปใช้กับเรื่องใหม่ได้โดยไม่ดูเป็นการก๊อป.",
    "reusableDetails: เก็บเฉพาะข้อมูลที่มีประโยชน์ต่อการทำงานใหม่ เช่น ชื่อสินค้า/บริการ วิธีใช้ feature ประโยชน์ ขั้นตอน หลักฐาน ช่องทางติดต่อ หรือ brand line พร้อม sourcePostIndexes แบบ 1-based.",
    "ห้ามเก็บราคา โปรโมชัน deadline event date สถิติ หรือข้อมูลตามเวลา เว้นแต่ current input ด้านล่างยืนยันตรงกัน. ตัด slogan เชิง campaign, headline และข้อความที่เป็น creative idea ออก.",
    "ตอบเฉพาะ JSON schema ที่กำหนด.",
    "",
    "## Current input for fact checking",
    `Brand: ${input.brand?.name ?? "Unknown"}`,
    `Brief: ${input.brief}`,
    `Brand kit: ${JSON.stringify(input.brandLibrary.brand)}`,
    `Products: ${JSON.stringify(input.brandLibrary.products)}`,
    `Documents: ${JSON.stringify(input.brandLibrary.docs)}`,
    "",
    "## Past posts",
    ...pastPosts.map(
      (post, index) =>
        `${index + 1}. [${post.source === "organic_post" ? "โพสต์ organic" : "แคปชั่นโฆษณา"}] ${post.text}`
    )
  ].join("\n");
}

function parsePastContentProfile(
  value: string,
  postCount: number
): PastContentProfile {
  const record = readRecord(JSON.parse(value), "past content profile");
  const styleSignals = readStringArray(
    record.styleSignals,
    "past content profile.styleSignals"
  )
    .map((signal) => signal.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (!Array.isArray(record.creativePatterns)) {
    throw new Error("past content profile.creativePatterns must be an array.");
  }
  const seenPatterns = new Set<string>();
  const creativePatterns = record.creativePatterns.flatMap((rawItem, index) => {
    const item = readRecord(
      rawItem,
      `past content profile.creativePatterns[${index}]`
    );
    const pattern = readString(
      item.pattern,
      `past content profile.creativePatterns[${index}].pattern`
    ).trim();
    if (!pattern || seenPatterns.has(pattern)) return [];
    const whyItFitsBrand = readString(
      item.whyItFitsBrand,
      `past content profile.creativePatterns[${index}].whyItFitsBrand`
    ).trim();
    const sourcePostIndexes = readProfileSourcePostIndexes(
      item.sourcePostIndexes,
      `past content profile.creativePatterns[${index}].sourcePostIndexes`,
      postCount
    );
    if (!whyItFitsBrand || sourcePostIndexes.length === 0) return [];
    seenPatterns.add(pattern);
    return [{ pattern, whyItFitsBrand, sourcePostIndexes }];
  });
  if (!Array.isArray(record.reusableDetails)) {
    throw new Error("past content profile.reusableDetails must be an array.");
  }
  const seenDetails = new Set<string>();
  const reusableDetails = record.reusableDetails.flatMap((rawItem, index) => {
    const item = readRecord(
      rawItem,
      `past content profile.reusableDetails[${index}]`
    );
    const detail = readString(
      item.detail,
      `past content profile.reusableDetails[${index}].detail`
    ).trim();
    if (!detail || seenDetails.has(detail)) return [];
    const sourcePostIndexes = readProfileSourcePostIndexes(
      item.sourcePostIndexes,
      `past content profile.reusableDetails[${index}].sourcePostIndexes`,
      postCount
    );
    if (sourcePostIndexes.length === 0) return [];
    seenDetails.add(detail);
    return [{ detail, sourcePostIndexes }];
  });
  return {
    styleSignals,
    creativePatterns: creativePatterns.slice(0, 8),
    reusableDetails: reusableDetails.slice(0, 12)
  };
}

function readProfileSourcePostIndexes(
  value: unknown,
  field: string,
  postCount: number
): readonly number[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  return value
    .map((postIndex, index) => readNumber(postIndex, `${field}[${index}]`))
    .filter(
      (postIndex) =>
        Number.isInteger(postIndex) && postIndex >= 1 && postIndex <= postCount
    );
}

function buildCaptionStylePrompt(
  directions: readonly GeneratedDirection[],
  pastPosts: readonly PastPostExample[],
  pastContentProfile?: PastContentProfile
): string {
  const lockedDirections = directions.map((direction) => ({
    id: direction.id,
    service: direction.service,
    hook: direction.hook,
    subheadline: direction.subheadline,
    concept: direction.concept,
    supportingPoints: direction.supportingPoints,
    cta: direction.cta,
    captionDraft: direction.caption
  }));

  return [
    "# CAPTION STYLIST",
    "Directions ด้านล่างถูกล็อกแล้ว ห้ามเปลี่ยนหรือตีความ Hook, Concept, Product, Offer หรือ Strategic angle ใหม่.",
    "เขียน captionDraft ใหม่โดยใช้โพสต์เก่าเฉพาะเพื่อเรียนรู้ voice, opening, rhythm, line breaks, emoji, hashtag, footer และวิธีปิด CTA.",
    "ห้ามนำหัวข้อ ไอเดีย campaign หรือวิธีเล่าจากโพสต์เก่ามาใส่ใน direction ใหม่. ใช้ facts จาก locked directions และ reusableDetails ใน Past Content Profile เท่านั้น.",
    "contactLine ใช้ได้เมื่อเป็นข้อความเดียวกันที่ปรากฏตรงๆ อย่างน้อย 2 ตัวอย่าง มิฉะนั้นคืน string ว่าง.",
    THAI_NATURALNESS_RULE,
    "caption ห้ามมีคำลงท้าย ‘ครับ’ หรือ ‘ค่ะ’. ตอบเฉพาะ JSON schema ที่กำหนดและคืนหนึ่ง item ต่อ direction id.",
    "",
    "## Locked directions",
    JSON.stringify(lockedDirections, null, 2),
    "",
    "## Past Content Profile",
    JSON.stringify(
      pastContentProfile ?? {
        styleSignals: [],
        creativePatterns: [],
        reusableDetails: []
      },
      null,
      2
    ),
    "",
    "## Past posts — style evidence only",
    ...pastPosts.map(
      (post, index) =>
        `${index + 1}. [${post.source === "organic_post" ? "โพสต์ organic" : "แคปชั่นโฆษณา"}] ${post.text}`
    )
  ].join("\n");
}

function parseCaptionStyleResult(
  value: string,
  directions: readonly GeneratedDirection[],
  pastPosts: readonly PastPostExample[]
): CaptionStyleResult {
  const record = readRecord(JSON.parse(value), "caption style result");
  if (!Array.isArray(record.items)) {
    throw new Error("caption style result.items must be an array.");
  }
  const allowedIds = new Set(directions.map((direction) => direction.id));
  const seenIds = new Set<string>();
  const items = record.items.flatMap((rawItem, index) => {
    const item = readRecord(rawItem, `caption style result.items[${index}]`);
    const id = readString(item.id, `caption style result.items[${index}].id`);
    if (!allowedIds.has(id) || seenIds.has(id)) return [];
    seenIds.add(id);
    const contactLine = readString(
      item.contactLine,
      `caption style result.items[${index}].contactLine`
    ).trim();
    const recurringContactLine =
      contactLine &&
      pastPosts.filter((post) => post.text.includes(contactLine)).length >= 2
        ? contactLine
        : "";
    return [
      {
        id,
        caption: readString(
          item.caption,
          `caption style result.items[${index}].caption`
        ),
        contactLine: recurringContactLine
      }
    ];
  });
  return { items };
}

function buildInputBlock(input: HookGenerationHarnessRequest): string {
  return [
    "## Creative Compass current input",
    `Run ID: ${input.runId}`,
    `Brand: ${input.brand?.name ?? "Unknown"}`,
    `Category: ${input.brand?.category ?? "Unknown"}`,
    `Service: ${input.service}`,
    `Generation model: ${input.generationModel ?? DEFAULT_MODEL}`,
    `Selected output quantity later: ${input.quantity}`,
    `Content-type quotas: ${JSON.stringify(contentTypeQuotasForPrompt(input))}`,
    `Album layout preference: ${input.albumFormat ?? defaultAlbumFormatPreference}`,
    "",
    "User Brief — HIGHEST PRIORITY:",
    input.brief,
    "",
    ...(input.extraInstructions
      ? [
          "Additional direction for this round — HIGH PRIORITY, on top of the brief above:",
          input.extraInstructions,
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
    ...input.brandMemory.working.map((item) => `- ${item}`),
    "",
    "Brand Memory — What to avoid:",
    ...input.brandMemory.avoid.map((item) => `- ${item}`),
    "",
    ...(input.onboardingQuestionnaire
      ? [
          "Onboarding questionnaire — HISTORICAL ONBOARDING CONTEXT ONLY, NOT A CURRENT CAMPAIGN BRIEF:",
          "Use this only as background about the brand, business, and audience. The current User Brief, Brand Memory, and verified Product data have higher priority. Do not reuse old goals, offers, prices, claims, or instructions unless the current input confirms them.",
          input.onboardingQuestionnaire,
          ""
        ]
      : []),
    "Brand kit:",
    ...input.brandLibrary.brand.map(
      (item) => `- ${item.title}: ${item.description}`
    ),
    "",
    "Products / offers / benefits / audience / claim notes:",
    ...input.brandLibrary.products.map(
      (item) => `- ${item.title}: ${item.description}`
    ),
    "",
    "Documents:",
    ...input.brandLibrary.docs.map(
      (item) => `- ${item.title}: ${item.description}`
    ),
    "",
    "References:",
    ...input.brandLibrary.refs.map(
      (item) => `- ${item.title}: ${item.description}`
    ),
    "",
    "Attached file names:",
    ...input.attachments.map((item) => `- ${item}`),
    "",
    "Uploaded creative image materials (the images follow this text in the same order):",
    ...input.uploadedMaterials.map(
      (item, index) =>
        `${index + 1}. ${item.name} | role=${item.role} | usage note=${item.description || "No additional note"}`
    )
  ].join("\n");
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

function candidateTypeQuotasForPrompt(input: HookGenerationHarnessRequest) {
  const quotas = input.contentTypeQuotas.map((quota) => ({
    service: quota.service,
    type: servicePromptLabels[quota.service],
    count: Math.max(
      MIN_HOOK_CANDIDATES_PER_SERVICE,
      quota.count * HOOK_CANDIDATE_MULTIPLIER
    ),
    requiredFinalCount: quota.count
  }));
  let total = quotas.reduce((sum, quota) => sum + quota.count, 0);
  while (total > MAX_HOOK_CANDIDATES_PER_BATCH) {
    const reducible = quotas
      .filter((quota) => quota.count > quota.requiredFinalCount)
      .sort((left, right) => right.count - left.count)[0];
    if (!reducible) break;
    reducible.count -= 1;
    total -= 1;
  }
  return quotas;
}

const stringArraySchema = {
  type: "array",
  items: { type: "string" }
} as const;

const hookCandidateSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          service: { type: "string", enum: serviceTypes },
          hook: { type: "string" },
          premise: { type: "string" },
          primaryBenefit: { type: "string" },
          creativePattern: { type: "string" },
          languageDevice: { type: "string" },
          audienceReason: { type: "string" },
          formatIdea: { type: "string" },
          citations: stringArraySchema
        },
        required: [
          "id",
          "service",
          "hook",
          "premise",
          "primaryBenefit",
          "creativePattern",
          "languageDevice",
          "audienceReason",
          "formatIdea",
          "citations"
        ]
      }
    }
  },
  required: ["candidates"]
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
          albumFormat: { type: "string", enum: albumFormats },
          formatBeats: {
            type: "array",
            items: { type: "string" }
          },
          ugcBrief: {
            type: "object",
            additionalProperties: false,
            properties: {
              product: { type: "string" },
              duration: { type: "string" },
              objective: { type: "string" },
              moodAndTone: { type: "string" },
              productionStyle: { type: "string" },
              referenceDirection: { type: "string" },
              openingScript: { type: "string" },
              showcaseScript: { type: "string" },
              closingScript: { type: "string" }
            },
            required: [
              "product",
              "duration",
              "objective",
              "moodAndTone",
              "productionStyle",
              "referenceDirection",
              "openingScript",
              "showcaseScript",
              "closingScript"
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

const pastContentProfileSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    styleSignals: stringArraySchema,
    creativePatterns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          pattern: { type: "string" },
          whyItFitsBrand: { type: "string" },
          sourcePostIndexes: {
            type: "array",
            items: { type: "number" }
          }
        },
        required: ["pattern", "whyItFitsBrand", "sourcePostIndexes"]
      }
    },
    reusableDetails: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          detail: { type: "string" },
          sourcePostIndexes: {
            type: "array",
            items: { type: "number" }
          }
        },
        required: ["detail", "sourcePostIndexes"]
      }
    }
  },
  required: ["styleSignals", "creativePatterns", "reusableDetails"]
} as const;

const captionStyleSchema = {
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
          caption: { type: "string" },
          contactLine: { type: "string" }
        },
        required: ["id", "caption", "contactLine"]
      }
    }
  },
  required: ["items"]
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
      "- album-post: คิดเป็น swipeable story ไม่ใช่ static ad หลายใบ. เลือก albumFormat ให้เหมาะกับแนวคิดของ direction นี้โดยตรง ห้ามสุ่มและห้ามใช้ default เดียวทุกไอเดีย:",
      "  - three-vertical: ใช้เมื่อมี hero subject/product แนวตั้งหนึ่งจุดที่เด่นมาก และมีสอง supporting moments.",
      "  - three-horizontal: ใช้เมื่อแนวคิดเด่นที่ panorama, before-after, wide reveal หรือ cover แนวนอน แล้วมีสอง supporting moments.",
      "  - four-vertical: ใช้เมื่อมี hero แนวตั้งหนึ่งจุด แล้วต้องเล่าต่อด้วย proof/detail/step อีกสามส่วน.",
      "  - four-grid: ใช้เมื่อเป็น comparison, list, steps หรือข้อมูลสี่ส่วนที่มีน้ำหนักใกล้กัน.",
      "  Cover hook ต้องสร้าง open loop, tension, promise, comparison, list, steps หรือ reveal ที่ทำให้คนอยาก swipe ต่อ โดยยังเข้าใจได้ทันที. subheadline อธิบาย promise ของ cover สั้นๆ. formatBeats ต้องมี 3 supporting topics พอดี; แต่ละ topicต้องเป็นหัวข้อไทยสั้น ชัด ไม่ซ้ำกัน มีสารหรือ visual moment ของตัวเอง และเรียงเป็น story progression. ห้ามใช้ CTA หรือประโยค generic เป็น supporting topic."
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
  const beatUse = format.startsWith("three-")
    ? "The first two supporting topics may share the middle panel; the final topic and CTA close on the last panel."
    : "Place one supporting topic in each of the three panels after the cover.";
  return `- album-post: คิดเป็น swipeable story ไม่ใช่ static ad หลายใบ. Selected layout is ${layout}. Cover hook ต้องสร้าง open loop, tension, promise, comparison, list, steps หรือ reveal ที่ทำให้คนอยาก swipe ต่อ โดยยังเข้าใจได้ทันที. subheadline อธิบาย promise ของ cover สั้นๆ. formatBeats ต้องมี 3 supporting topics พอดี; แต่ละ topic ต้องเป็นหัวข้อไทยสั้น ชัด ไม่ซ้ำกัน มีสารหรือ visual moment ของตัวเอง และเรียงเป็น story progression. ${beatUse} ห้ามใช้ CTA หรือประโยค generic เป็น supporting topic.`;
}

function readHookIdeaMode(value: unknown): HookIdeaMode {
  if (value === undefined) return "standard";
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

function parseHookCandidateResult(text: string): HookCandidateResult {
  const value = readRecord(JSON.parse(text), "hook candidates");
  if (!Array.isArray(value.candidates)) {
    throw new Error("candidates must be an array.");
  }
  return {
    candidates: value.candidates.map((rawCandidate, index) => {
      const candidate = readRecord(rawCandidate, `candidates[${index}]`);
      return {
        id: readString(candidate.id, `candidates[${index}].id`),
        service: readServiceType(
          candidate.service,
          `candidates[${index}].service`
        ),
        hook: readString(candidate.hook, `candidates[${index}].hook`),
        premise: readString(candidate.premise, `candidates[${index}].premise`),
        primaryBenefit: readString(
          candidate.primaryBenefit,
          `candidates[${index}].primaryBenefit`
        ),
        creativePattern: readString(
          candidate.creativePattern,
          `candidates[${index}].creativePattern`
        ),
        languageDevice: readString(
          candidate.languageDevice,
          `candidates[${index}].languageDevice`
        ),
        audienceReason: readString(
          candidate.audienceReason,
          `candidates[${index}].audienceReason`
        ),
        formatIdea: readString(
          candidate.formatIdea,
          `candidates[${index}].formatIdea`
        ),
        citations: readStringArray(
          candidate.citations,
          `candidates[${index}].citations`
        )
      };
    })
  };
}

function validateHookCandidateQuotas(
  result: HookCandidateResult,
  input: HookGenerationHarnessRequest
): void {
  const expectedQuotas = candidateTypeQuotasForPrompt(input);
  for (const quota of expectedQuotas) {
    const actualCount = result.candidates.filter(
      (candidate) => candidate.service === quota.service
    ).length;
    if (actualCount < quota.count) {
      throw new Error(
        `Hook candidate generation returned ${actualCount} of ${quota.count} required candidates for ${quota.service}.`
      );
    }
  }
}

function validateCreativeDirectorSelection(
  result: HookGenerationResult,
  candidates: HookCandidateResult
): void {
  const candidatesById = new Map(
    candidates.candidates.map((candidate) => [candidate.id, candidate])
  );
  for (const direction of result.directions) {
    const source = candidatesById.get(direction.sourceCandidateId);
    if (!source) {
      throw new Error(
        `Creative Director selected unknown candidate ${direction.sourceCandidateId}.`
      );
    }
    if (source.service !== direction.service) {
      throw new Error(
        `Creative Director changed candidate ${source.id} from ${source.service} to ${direction.service}.`
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
      const formatBeats = validateFormatBeats(service, rawFormatBeats, index);
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
        albumFormat: readGeneratedAlbumFormat(
          direction.albumFormat,
          `directions[${index}].albumFormat`
        ),
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
  index: number
): readonly string[] {
  if (service === "single-static" || service === "resize") return [];
  const normalized = beats.map((beat) => beat.trim()).filter(Boolean);
  if (normalized.length !== 3) {
    throw new Error(
      `directions[${index}].formatBeats must contain exactly 3 items for ${service}.`
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
  if (value === undefined) {
    return {
      product: "สินค้า/บริการตาม Brief",
      duration: "15–30 วินาที",
      objective: fallback.why,
      moodAndTone: fallback.visual,
      productionStyle: "Creator-led vertical video ที่เป็นธรรมชาติและตัดต่อกระชับ",
      referenceDirection: fallback.visual,
      openingScript: fallback.formatBeats[0] ?? fallback.hook,
      showcaseScript: fallback.formatBeats[1] ?? fallback.concept,
      closingScript:
        fallback.formatBeats[2] ?? `${fallback.cta} — ${fallback.caption}`
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
    openingScript: readString(record.openingScript, `${field}.openingScript`),
    showcaseScript: readString(
      record.showcaseScript,
      `${field}.showcaseScript`
    ),
    closingScript: readString(record.closingScript, `${field}.closingScript`)
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
