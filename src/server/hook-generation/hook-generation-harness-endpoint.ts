import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { normalizeGeneratedCaptionFormatting } from "../../domain/caption-formatting.js";
import { activeBrandKitItems } from "../../domain/brand.js";
import {
  albumFormatPreferences,
  albumFormats,
  ctaActionTypes,
  defaultAlbumFormatPreference,
  isHookGenerationModel,
  isOpenRouterHookGenerationModel,
  serviceTypes,
  ugcScriptBeatRoles,
  ugcScriptSpeakers,
  type AlbumFormat,
  type AlbumFormatPreference,
  type CtaActionType,
  type HookIdeaMode,
  type HookGenerationModel,
  type ServiceType,
  type UgcScriptBeatRole,
  type UgcScriptDocument,
  type UgcScriptSpeaker,
  type UgcVideoBrief
} from "../../domain/creative-run.js";
import type { HookGenerationHarnessRequest } from "../../services/creative-generation/harness-hook-generation.js";
import type { RawDirection } from "../../services/creative-generation/hook-generation-types.js";
import {
  resolveConvertCakeAuthorization
} from "../shared/convert-cake-auth.js";
import { createAiUsageTrackingFetch } from "../shared/ai-usage-recorder.js";
import {
  hookGenerationDebugLogDirectory,
  writeHookGenerationDebugLog,
  type HookGenerationDebugLog,
  type HookGenerationDebugLogger
} from "./hook-generation-debug-log.js";
import {
  buildHookResearchPrompt,
  hookResearchDossierBlock,
  hookResearchSchema,
  parseHookResearchDossier,
  type HookResearchDossier
} from "./hook-research-agent.js";
import {
  buildHookTopicsPrompt,
  hookTopicShortlistBlock,
  hookTopicsSchema,
  parseHookTopicShortlist,
  type HookTopicShortlist
} from "./hook-topic-agent.js";
import {
  buildPastPostsCaptionStyleBlock,
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
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  HOOK_GENERATION_DEBUG_LOG_DIR?: string;
  VERCEL_ENV?: string;
}

export interface HookGenerationHarnessEndpointOptions {
  request: Request;
  env: HookGenerationHarnessEndpointEnv;
  fetchImpl?: FetchLike;
  loadAgentHookPrompt?: () => Promise<string>;
  loadHookResearchPrompt?: () => Promise<string>;
  loadHookTopicsPrompt?: () => Promise<string>;
  loadSubheadlineHighlightPrompt?: () => Promise<string>;
  loadUgcScriptPrompt?: () => Promise<string>;
  loadPastPostExamples?: (input: {
    clientId: string;
    env: HookGenerationHarnessEndpointEnv;
    accessToken: string | null;
  }) => Promise<readonly PastPostExample[]>;
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
  albumFormat?: AlbumFormat;
  ugcBrief?: UgcVideoBrief;
  ugcScript?: UgcScriptDocument;
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
  researchAudit: ResearchAudit;
}

interface ResearchAudit {
  webSearchRequests: number;
  citationUrls: readonly string[];
}

const DEFAULT_HOOK_MODEL = "google/gemini-3.6-flash";
const DEFAULT_OPENAI_MODEL = "gpt-5.6-terra";
const DEFAULT_SUPPORT_MODEL = "gpt-5.6-luna";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const OPENROUTER_CHAT_COMPLETIONS_ENDPOINT =
  "https://openrouter.ai/api/v1/chat/completions";
const HOOK_GENERATION_BATCH_SIZE = 12;
const HOOK_GENERATION_CONCURRENCY = 3;
const HOOK_GENERATION_REASONING_EFFORT = "high" as const;
const HOOK_RESEARCH_REASONING_EFFORT = "medium" as const;
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
  loadAgentHookPrompt = defaultLoadAgentHookPrompt,
  loadHookResearchPrompt = defaultLoadHookResearchPrompt,
  loadHookTopicsPrompt = defaultLoadHookTopicsPrompt,
  loadSubheadlineHighlightPrompt = defaultLoadSubheadlineHighlightPrompt,
  loadUgcScriptPrompt = defaultLoadUgcScriptPrompt,
  loadPastPostExamples = defaultLoadPastPostExamples,
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

    const parsedInput = parseRequestBody(await request.json());
    const input = {
      ...parsedInput,
      generationModel: parsedInput.generationModel ?? DEFAULT_HOOK_MODEL
    };
    const providerFetchImpl = createAiUsageTrackingFetch({
      fetchImpl,
      context: {
        supabaseUrl: env.SUPABASE_URL,
        supabaseAnonKey: env.SUPABASE_ANON_KEY,
        accessToken: auth.accessToken,
        ownerUserId: auth.userId,
        clientId: input.brand?.id ?? null,
        workspaceRunId: input.runId,
        operation: "hook-generation"
      }
    });
    const generationProvider =
      isOpenRouterHookGenerationModel(input.generationModel)
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
        ? input.generationModel
        : env.OPENAI_HOOK_GENERATION_MODEL?.trim() ||
          input.generationModel ||
          DEFAULT_OPENAI_MODEL;
    const supportModel =
      env.OPENAI_HOOK_SUPPORT_MODEL?.trim() || DEFAULT_SUPPORT_MODEL;
    const researchModel =
      env.OPENAI_HOOK_GENERATION_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
    const researchTrace = input.researchDossier
      ? reusedResearchTrace(input.researchDossier as HookResearchDossier)
      : await withTransientRetry(async () =>
          runHookResearchStep({
            input,
            policyPrompt: await loadHookResearchPrompt(),
            apiKey: openAiApiKey,
            model: researchModel,
            fetchImpl: providerFetchImpl
          })
        );
    if (input.researchOnly) {
      return jsonResponse({
        ok: true,
        researchDossier: researchTrace.output
      });
    }

    const pastPosts = input.brand
      ? await loadPastPostExamples({
          clientId: input.brand.id,
          env,
          accessToken: auth.accessToken
        })
      : [];

    const topicTrace = await withTransientRetry(async () =>
      runHookTopicStep({
        input,
        policyPrompt: await loadHookTopicsPrompt(),
        researchDossier: researchTrace.output,
        apiKey: openAiApiKey,
        model: researchModel,
        fetchImpl: providerFetchImpl
      })
    );

    const agentHookPrompt =
      input.agentHookPrompt?.trim() || (await loadAgentHookPrompt());
    const subheadlineHighlightPrompt =
      await loadSubheadlineHighlightPrompt();
    const generationBatches = buildHookGenerationBatches(input);
    const directTraces = await mapWithConcurrency(
      generationBatches,
      HOOK_GENERATION_CONCURRENCY,
      (batch) =>
        withTransientRetry(() =>
          runGenerationStep({
            input: batch,
            agentHookPrompt,
            researchDossier: researchTrace.output,
            topicShortlist: topicTrace.output,
            pastPosts,
            apiKey: generationApiKey,
            model,
            provider: generationProvider,
            fetchImpl: providerFetchImpl
          })
        )
    );
    const directions = makeDirectionIdsUnique(
      directTraces.flatMap((trace) => trace.output.directions)
    ).slice(0, input.quantity);
    if (
      input.quantity > HOOK_GENERATION_BATCH_SIZE &&
      directions.length < input.quantity
    ) {
      throw new Error(
        `Hook generation returned ${directions.length} of ${input.quantity} requested ideas. Please retry the run.`
      );
    }
    const highlightedDirections = await runSubheadlineHighlightStep({
      directions,
      apiKey:
        generationProvider === "openrouter"
          ? generationApiKey
          : openAiApiKey,
      model: generationProvider === "openrouter" ? model : supportModel,
      provider: generationProvider,
      prompt: subheadlineHighlightPrompt,
      fetchImpl: providerFetchImpl
    });
    const ugcScriptPrompt = await loadUgcScriptPrompt();
    const { directions: finalDirections, traces: ugcScriptTraces } =
      await runUgcScriptStep({
        directions: highlightedDirections,
        input,
        researchDossier: researchTrace.output,
        pastPosts,
        apiKey: generationApiKey,
        model,
        provider: generationProvider,
        prompt: ugcScriptPrompt,
        fetchImpl: providerFetchImpl
      });
    const debugDirectory =
      env.HOOK_GENERATION_DEBUG_LOG_DIR?.trim() ||
      hookGenerationDebugLogDirectory(env.VERCEL_ENV);
    if (debugDirectory) {
      await writeDebugLog(
        debugDirectory,
        buildDirectHookGenerationDebugLog({
          input,
          researchTrace,
          topicTrace,
          directTraces,
          researchModel,
          generationProvider,
          generationModel: model,
          finalDirections,
          ugcScriptTraces
        })
      );
    }

    return jsonResponse({ ok: true, directions: finalDirections });
  } catch (error) {
    return jsonResponse({ ok: false, error: readableError(error) }, 500);
  }
}

async function defaultLoadAgentHookPrompt(): Promise<string> {
  return readFile(join(process.cwd(), "agent_prompt", "agent_hook.md"), "utf8");
}

async function defaultLoadHookResearchPrompt(): Promise<string> {
  return readFile(
    join(process.cwd(), "agent_prompt", "agent_hook_research.md"),
    "utf8"
  );
}

async function defaultLoadHookTopicsPrompt(): Promise<string> {
  return readFile(
    join(process.cwd(), "agent_prompt", "agent_hook_topics.md"),
    "utf8"
  );
}

async function defaultLoadSubheadlineHighlightPrompt(): Promise<string> {
  return readFile(
    join(process.cwd(), "agent_prompt", "agent_hook_highlight.md"),
    "utf8"
  );
}

async function defaultLoadUgcScriptPrompt(): Promise<string> {
  return readFile(
    join(process.cwd(), "agent_prompt", "agent_ugc_script.md"),
    "utf8"
  );
}

async function defaultLoadPastPostExamples({
  clientId,
  env,
  accessToken
}: {
  clientId: string;
  env: HookGenerationHarnessEndpointEnv;
  accessToken: string | null;
}): Promise<readonly PastPostExample[]> {
  const supabaseUrl = env.SUPABASE_URL?.trim();
  const supabaseAnonKey = env.SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabaseAnonKey || !accessToken) return [];

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
  return fetchPastPostExamples({
    client: client as unknown as PastPostsClient,
    clientId
  });
}

async function runGenerationStep({
  input,
  agentHookPrompt,
  researchDossier,
  topicShortlist,
  pastPosts,
  apiKey,
  model,
  provider,
  fetchImpl
}: {
  input: HookGenerationHarnessRequest;
  agentHookPrompt: string;
  researchDossier: HookResearchDossier;
  topicShortlist: HookTopicShortlist;
  pastPosts: readonly PastPostExample[];
  apiKey: string;
  model: string;
  provider: "openai" | "openrouter";
  fetchImpl: FetchLike;
}): Promise<TracedAgentResult<HookGenerationResult>> {
  const inputText = buildDirectHookGenerationPrompt(
    input,
    agentHookPrompt,
    researchDossier,
    topicShortlist,
    pastPosts
  );
  const requestDirections = (requestInputText: string) =>
    callResponsesApi({
      apiKey,
      model,
      fetchImpl,
      content: [{ type: "input_text", text: requestInputText }],
      schemaName: "moons_hook_generation",
      schema: hookGenerationSchema,
      reasoningEffort:
        provider === "openai" ? HOOK_GENERATION_REASONING_EFFORT : undefined,
      provider
    });
  let finalInputText = inputText;
  let payload = await requestDirections(finalInputText);
  let result: HookGenerationResult | undefined;
  let albumPanelCountRepairAttempts = 0;
  let repairedThaiNaturalness = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      result = parseHookGenerationResult(extractResponseText(payload));
    } catch (error) {
      if (
        albumPanelCountRepairAttempts >= 2 ||
        !isAlbumPanelCountContractError(error)
      ) {
        throw error;
      }
      finalInputText = buildAlbumPanelCountRetryPrompt(
        finalInputText,
        readableError(error)
      );
      albumPanelCountRepairAttempts += 1;
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
    rawResponse: payload,
    researchAudit: extractResearchAudit(payload)
  };
}

async function runHookResearchStep({
  input,
  policyPrompt,
  apiKey,
  model,
  fetchImpl
}: {
  input: HookGenerationHarnessRequest;
  policyPrompt: string;
  apiKey: string;
  model: string;
  fetchImpl: FetchLike;
}): Promise<TracedAgentResult<HookResearchDossier>> {
  const inputText = buildHookResearchPrompt(policyPrompt, buildInputBlock(input));
  const payload = await callResponsesApi({
    apiKey,
    model,
    fetchImpl,
    content: [{ type: "input_text", text: inputText }],
    schemaName: "moons_hook_research",
    schema: hookResearchSchema,
    tools: [THAI_WEB_SEARCH_TOOL],
    toolChoice: "required",
    reasoningEffort: HOOK_RESEARCH_REASONING_EFFORT,
    provider: "openai"
  });
  return {
    inputText,
    output: parseHookResearchDossier(extractResponseText(payload)),
    rawResponse: payload,
    researchAudit: extractResearchAudit(payload)
  };
}

async function runHookTopicStep({
  input,
  policyPrompt,
  researchDossier,
  apiKey,
  model,
  fetchImpl
}: {
  input: HookGenerationHarnessRequest;
  policyPrompt: string;
  researchDossier: HookResearchDossier;
  apiKey: string;
  model: string;
  fetchImpl: FetchLike;
}): Promise<TracedAgentResult<HookTopicShortlist>> {
  const inputText = buildHookTopicsPrompt(
    policyPrompt,
    buildInputBlock(input),
    researchDossier
  );
  const payload = await callResponsesApi({
    apiKey,
    model,
    fetchImpl,
    content: [{ type: "input_text", text: inputText }],
    schemaName: "moons_hook_topics",
    schema: hookTopicsSchema,
    reasoningEffort: "medium",
    provider: "openai"
  });
  return {
    inputText,
    output: parseHookTopicShortlist(extractResponseText(payload)),
    rawResponse: payload,
    researchAudit: extractResearchAudit(payload)
  };
}

function reusedResearchTrace(
  dossier: HookResearchDossier
): TracedAgentResult<HookResearchDossier> {
  return {
    inputText: "Shared Research dossier supplied by Hook Agent Playground.",
    output: dossier,
    rawResponse: { reused: true },
    researchAudit: {
      webSearchRequests: 0,
      citationUrls: dossier.references.map((reference) => reference.sourceUrl)
    }
  };
}

function buildDirectHookGenerationDebugLog({
  input,
  researchTrace,
  topicTrace,
  directTraces,
  researchModel,
  generationProvider,
  generationModel,
  finalDirections,
  ugcScriptTraces
}: {
  input: HookGenerationHarnessRequest;
  researchTrace: TracedAgentResult<HookResearchDossier>;
  topicTrace: TracedAgentResult<HookTopicShortlist>;
  directTraces: readonly TracedAgentResult<HookGenerationResult>[];
  researchModel: string;
  generationProvider: "openai" | "openrouter";
  generationModel: string;
  finalDirections: readonly GeneratedDirection[];
  ugcScriptTraces: readonly UgcScriptTrace[];
}): HookGenerationDebugLog {
  const endpoint =
    generationProvider === "openrouter"
      ? "/api/v1/chat/completions"
      : "/v1/responses";
  return {
    kind: "hook-generation",
    createdAt: new Date().toISOString(),
    runId: input.runId,
    hookIdeaMode: input.hookIdeaMode,
    researchAgent: {
      provider: "openai",
      model: researchModel,
      promptSource: "agent_prompt/agent_hook_research.md",
      request: {
        endpoint: "/v1/responses",
        inputText: researchTrace.inputText,
        tools: [THAI_WEB_SEARCH_TOOL],
        plugins: [],
        toolChoice: "required" as const,
        reasoningEffort: HOOK_RESEARCH_REASONING_EFFORT,
        responseSchema: "moons_hook_research" as const
      },
      response: {
        parsed: researchTrace.output,
        raw: researchTrace.rawResponse,
        researchAudit: researchTrace.researchAudit
      }
    },
    topicAgent: {
      provider: "openai",
      model: researchModel,
      promptSource: "agent_prompt/agent_hook_topics.md",
      request: {
        endpoint: "/v1/responses",
        inputText: topicTrace.inputText,
        reasoningEffort: "medium" as const,
        responseSchema: "moons_hook_topics" as const
      },
      response: {
        parsed: topicTrace.output,
        raw: topicTrace.rawResponse
      }
    },
    hookAgent: {
      provider: generationProvider,
      model: generationModel,
      promptSource: "agent_prompt/agent_hook.md",
      batches: directTraces.map((trace) => ({
        request: {
          endpoint,
          inputText: trace.inputText,
          tools: [],
          plugins: [],
          ...(generationProvider === "openai"
            ? { reasoningEffort: HOOK_GENERATION_REASONING_EFFORT }
            : {}),
          attachedImages: [],
          responseSchema: "moons_hook_generation" as const
        },
        response: {
          parsed: trace.output,
          raw: trace.rawResponse,
          researchAudit: {
            webSearchRequests: trace.researchAudit.webSearchRequests,
            citationUrls: trace.researchAudit.citationUrls
          }
        }
      }))
    },
    ...(ugcScriptTraces.length
      ? {
          ugcScriptAgent: {
            provider: generationProvider,
            model: generationModel,
            promptSource: "agent_prompt/agent_ugc_script.md" as const,
            entries: ugcScriptTraces.map((trace) => ({
              directionId: trace.directionId,
              request: {
                endpoint,
                inputText: trace.inputText,
                responseSchema: "moons_ugc_script" as const
              },
              response: {
                parsed: trace.ugcScript,
                raw: trace.rawResponse,
                ...(trace.error ? { error: trace.error } : {})
              }
            }))
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
  provider,
  prompt,
  fetchImpl
}: {
  directions: readonly GeneratedDirection[];
  apiKey: string;
  model: string;
  provider: "openai" | "openrouter";
  prompt: string;
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
          provider,
          prompt,
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
  provider,
  prompt,
  fetchImpl
}: {
  directions: readonly GeneratedDirection[];
  apiKey: string;
  model: string;
  provider: "openai" | "openrouter";
  prompt: string;
  fetchImpl: FetchLike;
}): Promise<readonly GeneratedDirection[]> {
  const items = directions
    .filter((direction) => direction.subheadline.trim().length > 0)
    .map((direction) => ({
      id: direction.id,
      subheadline: direction.subheadline
    }));
  if (items.length === 0) {
    return directions.map((direction) => ({
      ...direction,
      subheadlineHighlight: ""
    }));
  }
  const payload = await callResponsesApi({
    apiKey,
    model,
    fetchImpl,
    content: [
      {
        type: "input_text",
        text: buildSubheadlineHighlightPrompt(prompt, items)
      }
    ],
    schemaName: "neo_subheadline_highlights",
    schema: subheadlineHighlightSchema,
    provider
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

interface UgcScriptTrace {
  directionId: string;
  inputText: string;
  rawResponse: unknown;
  ugcScript?: UgcScriptDocument;
  error?: string;
}

async function runUgcScriptStep({
  directions,
  input,
  researchDossier,
  pastPosts,
  apiKey,
  model,
  provider,
  prompt,
  fetchImpl
}: {
  directions: readonly GeneratedDirection[];
  input: HookGenerationHarnessRequest;
  researchDossier: HookResearchDossier;
  pastPosts: readonly PastPostExample[];
  apiKey: string;
  model: string;
  provider: "openai" | "openrouter";
  prompt: string;
  fetchImpl: FetchLike;
}): Promise<{
  directions: readonly GeneratedDirection[];
  traces: readonly UgcScriptTrace[];
}> {
  const ugcDirections = directions.filter(
    (direction) => direction.service === "ugc-video"
  );
  if (!ugcDirections.length) {
    return { directions, traces: [] };
  }

  const traces = await mapWithConcurrency(
    ugcDirections,
    HOOK_GENERATION_CONCURRENCY,
    (direction) =>
      runUgcScriptDirection({
        direction,
        ugcScriptPrompt: prompt,
        researchDossier,
        pastPosts,
        input,
        apiKey,
        model,
        provider,
        fetchImpl
      })
  );

  const ugcScriptByDirectionId = new Map(
    traces
      .filter(
        (trace): trace is UgcScriptTrace & { ugcScript: UgcScriptDocument } =>
          Boolean(trace.ugcScript)
      )
      .map((trace) => [trace.directionId, trace.ugcScript])
  );

  return {
    directions: directions.map((direction) =>
      ugcScriptByDirectionId.has(direction.id)
        ? { ...direction, ugcScript: ugcScriptByDirectionId.get(direction.id) }
        : direction
    ),
    traces
  };
}

async function runUgcScriptDirection({
  direction,
  ugcScriptPrompt,
  researchDossier,
  pastPosts,
  input,
  apiKey,
  model,
  provider,
  fetchImpl
}: {
  direction: GeneratedDirection;
  ugcScriptPrompt: string;
  researchDossier: HookResearchDossier;
  pastPosts: readonly PastPostExample[];
  input: HookGenerationHarnessRequest;
  apiKey: string;
  model: string;
  provider: "openai" | "openrouter";
  fetchImpl: FetchLike;
}): Promise<UgcScriptTrace> {
  const inputText = buildUgcScriptPrompt(
    direction,
    ugcScriptPrompt,
    researchDossier,
    pastPosts,
    input
  );
  const requestUgcScript = (requestInputText: string) =>
    withTransientRetry(() =>
      callResponsesApi({
        apiKey,
        model,
        fetchImpl,
        content: [{ type: "input_text", text: requestInputText }],
        schemaName: "moons_ugc_script",
        schema: ugcScriptSchema,
        reasoningEffort:
          provider === "openai" ? HOOK_GENERATION_REASONING_EFFORT : undefined,
        provider
      })
    );

  // Failures here degrade gracefully: this direction keeps its ugcBrief (slide)
  // but ships without the richer ugcScript document, instead of failing the run.
  try {
    let finalInputText = inputText;
    let payload = await requestUgcScript(finalInputText);
    let ugcScript = parseUgcScriptResult(
      extractResponseText(payload),
      direction.id
    );

    if (containsForbiddenThaiFirstPerson(ugcScript)) {
      finalInputText = buildUgcScriptNaturalnessRetryPrompt(
        finalInputText,
        `มีคำว่า "ฉัน"`
      );
      payload = await requestUgcScript(finalInputText);
      ugcScript = parseUgcScriptResult(extractResponseText(payload), direction.id);
    }
    assertNoForbiddenThaiFirstPerson(ugcScript, "UGC script");

    return {
      directionId: direction.id,
      inputText: finalInputText,
      rawResponse: payload,
      ugcScript
    };
  } catch (error) {
    console.warn(
      `UGC script generation failed for direction ${direction.id}: ${readableError(error)}`
    );
    return {
      directionId: direction.id,
      inputText,
      rawResponse: undefined,
      error: readableError(error)
    };
  }
}

function buildUgcScriptPrompt(
  direction: GeneratedDirection,
  ugcScriptPrompt: string,
  researchDossier: HookResearchDossier,
  pastPosts: readonly PastPostExample[],
  input: HookGenerationHarnessRequest
): string {
  const pastPostsBlock = buildPastPostsCaptionStyleBlock(pastPosts);
  return [
    ugcScriptPrompt,
    "",
    "# Runtime contract",
    "Research และ Direction ถูกเลือกไว้แล้วโดย Hook Agent ห้ามเปลี่ยน Insight หรือมุมขายของ Direction นี้.",
    "",
    buildInputBlock(input),
    "",
    hookResearchDossierBlock(researchDossier),
    ...(pastPostsBlock ? ["", pastPostsBlock] : []),
    "",
    "# Selected direction",
    `Hook: ${direction.hook}`,
    `Concept: ${direction.concept}`,
    `Why: ${direction.why}`,
    `CTA: ${direction.cta}`,
    `Caption: ${direction.caption}`,
    `Visual: ${direction.visual}`
  ].join("\n");
}

function buildUgcScriptNaturalnessRetryPrompt(
  inputText: string,
  validationError: string
): string {
  return [
    inputText,
    "",
    "# THAI NATURALNESS CORRECTION — REQUIRED",
    `คำตอบก่อนหน้าถูกปฏิเสธ: ${validationError}`,
    "แก้ตามกฎภาษาไทยใน agent_ugc_script.md.",
    "เขียนใหม่ทั้ง JSON โดยรักษา Beat, Fact และ Schema เดิม."
  ].join("\n");
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
    "แก้ตามกฎภาษาไทยใน ## Copy ของ agent_hook.md.",
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

function extractResearchAudit(payload: unknown): ResearchAudit {
  let webSearchCallsFound = 0;
  const citationUrls = new Set<string>();

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;

    if (value.type === "web_search_call") {
      webSearchCallsFound += 1;
    }
    if (value.type === "url_citation") {
      const directUrl = typeof value.url === "string" ? value.url : undefined;
      const nestedUrl =
        isRecord(value.url_citation) &&
        typeof value.url_citation.url === "string"
          ? value.url_citation.url
          : undefined;
      const url = directUrl ?? nestedUrl;
      if (url && isHttpUrl(url)) citationUrls.add(url);
    }

    Object.values(value).forEach(visit);
  };
  visit(payload);

  let reportedSearchRequests = 0;
  if (isRecord(payload) && isRecord(payload.usage)) {
    const legacyUsage = payload.usage.server_tool_use;
    const openRouterUsage = payload.usage.server_tool_use_details;
    const legacyCount =
      isRecord(legacyUsage) &&
      typeof legacyUsage.web_search_requests === "number"
        ? legacyUsage.web_search_requests
        : 0;
    const openRouterCount =
      isRecord(openRouterUsage) &&
      typeof openRouterUsage.web_search_requests === "number"
        ? openRouterUsage.web_search_requests
        : 0;
    reportedSearchRequests = Math.max(legacyCount, openRouterCount);
  }

  return {
    webSearchRequests: Math.max(reportedSearchRequests, webSearchCallsFound),
    citationUrls: [...citationUrls]
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
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
  prompt: string,
  items: readonly { id: string; subheadline: string }[]
): string {
  return [
    prompt.trim(),
    "",
    "# Runtime input",
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
  plugins,
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
  plugins?: readonly Record<string, unknown>[];
  toolChoice?: "required";
  reasoningEffort?: "medium" | "high";
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
          ...(plugins?.length ? { plugins } : {}),
          provider: { require_parameters: true },
          response_format: {
            type: "json_schema",
            json_schema: {
              name: schemaName,
              strict: true,
              schema: openRouterCompatibleSchema(schema)
            }
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

function openRouterCompatibleSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(openRouterCompatibleSchema);
  }
  if (!isRecord(value)) return value;

  const normalized = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "maxItems")
      .map(([key, item]) => [key, openRouterCompatibleSchema(item)])
  ) as Record<string, unknown>;
  const declaredType = normalized.type;
  if (!Array.isArray(declaredType) || !declaredType.includes("null")) {
    return normalized;
  }

  const nonNullTypes = declaredType.filter((type) => type !== "null");
  const nonNullSchema = { ...normalized };
  nonNullSchema.type =
    nonNullTypes.length === 1 ? nonNullTypes[0] : nonNullTypes;
  if (Array.isArray(nonNullSchema.enum)) {
    nonNullSchema.enum = nonNullSchema.enum.filter((item) => item !== null);
  }

  return {
    anyOf: [nonNullSchema, { type: "null" }]
  };
}

function buildDirectHookGenerationPrompt(
  input: HookGenerationHarnessRequest,
  agentHookPrompt: string,
  researchDossier: HookResearchDossier,
  topicShortlist: HookTopicShortlist,
  pastPosts: readonly PastPostExample[]
): string {
  const pastPostsBlock = buildPastPostsCaptionStyleBlock(pastPosts);
  return [
    agentHookPrompt,
    "",
    "# Runtime contract",
    "Research status: completed by the dedicated Research Agent. Hook Agent must not perform additional research.",
    "",
    buildInputBlock(input),
    "",
    hookResearchDossierBlock(researchDossier),
    "",
    hookTopicShortlistBlock(topicShortlist),
    ...(pastPostsBlock ? ["", pastPostsBlock] : []),
    "",
    "# Required output mix",
    `คืน ${input.quantity} directions ให้ครบและเรียงตาม quota นี้: ${JSON.stringify(contentTypeQuotasForPrompt(input))}`,
    "sourceCandidateId ใช้ id ภายในแบบ direct-01, direct-02 และห้ามซ้ำกัน.",
    "subheadline เป็น optional: ใช้เฉพาะเมื่อเพิ่มรายละเอียดรองที่จำเป็นจริง; หาก Headline ยืนได้ด้วยตัวเองให้ส่ง null.",
    "",
    "# Format",
    "- single-static และ resize: formatBeats = [], albumFormat = null และ ugcBrief = null.",
    albumHookInstruction(
      input.albumFormat ?? defaultAlbumFormatPreference
    ),
    "- album-post: ugcBrief = null.",
    "- ugc-video: albumFormat = null, ugcBrief ต้องมีข้อมูลครบ และ scenes ต้องมี 4 ฉากตามลำดับ HOOK, DEVELOPMENT, PROOF / BENEFIT, CTA.",
    "- แต่ละ UGC scene: scriptLines คือคำพูดจริงที่ผู้พูดสามารถอ่านหน้ากล้องได้ 1–2 ประโยค ห้ามใส่คำสั่งกล้องหรือคำอธิบายภาพ; visual คือสิ่งที่ต้องถ่าย; textOverlay คือข้อความสั้นที่ขึ้นบนจอ; duration คือช่วงเวลาของฉาก.",
    "- UGC formatBeats ให้เป็นชื่อ Storyline สั้น ๆ 4 ข้อที่ตรงกับ scenes และห้ามนำคำอธิบาย Visual มาปนกับบทพูด.",
    "- motion-static: albumFormat = null, ugcBrief = null และ formatBeats ไม่มีจำนวนบังคับ."
  ].join("\n");
}

function buildInputBlock(input: HookGenerationHarnessRequest): string {
  const brief = hookRelevantBrief(input.brief);
  const roundInstructions = hookRelevantRoundInstructions(
    input.extraInstructions
  );
  const brandSystem = brandLibraryItemsBlock(input.brandLibrary.brand);
  const brandProducts = brandLibraryItemsBlock(input.brandLibrary.products);
  const brandDocs = brandLibraryItemsBlock(input.brandLibrary.docs);
  const brandRefs = brandLibraryItemsBlock(input.brandLibrary.refs);
  return [
    "# Questionnaire",
    input.onboardingQuestionnaire || "No questionnaire context supplied.",
    "",
    "# Brand name",
    input.brand?.name ?? "Unknown",
    "",
    "# Brand system",
    ...(brandSystem.length ? brandSystem : ["No brand system supplied."]),
    "",
    "# Brand products",
    ...(brandProducts.length ? brandProducts : ["No brand products supplied."]),
    "",
    "# Brand docs",
    ...(brandDocs.length ? brandDocs : ["No brand docs supplied."]),
    "",
    "# Brand references",
    ...(brandRefs.length ? brandRefs : ["No brand references supplied."]),
    "",
    "# User brief",
    brief,
    ...(roundInstructions ? ["", roundInstructions] : [])
  ].join("\n");
}

function brandLibraryItemsBlock(
  items: readonly { title: string; description: string }[]
): readonly string[] {
  return items.map(
    (item) => `- ${item.title}: ${cleanHookContextText(item.description)}`
  );
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

  return "ไม่มี Current Campaign Brief แยกจากข้อมูล Onboarding.";
}

function hookRelevantRoundInstructions(value: string): string {
  return value
    .split("\n")
    .filter((line) => !line.trim().startsWith("Creative mix quota:"))
    .join("\n")
    .trim();
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
          subheadline: { type: ["string", "null"] },
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
              referenceDirection: { type: "string" },
              scenes: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string" },
                    duration: { type: "string" },
                    scriptLines: stringArraySchema,
                    visual: { type: "string" },
                    textOverlay: { type: "string" }
                  },
                  required: [
                    "title",
                    "duration",
                    "scriptLines",
                    "visual",
                    "textOverlay"
                  ]
                }
              }
            },
            required: [
              "product",
              "duration",
              "objective",
              "moodAndTone",
              "productionStyle",
              "referenceDirection",
              "scenes"
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

const ugcScriptLineSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    speaker: { type: "string", enum: ugcScriptSpeakers },
    speakerLabel: { type: ["string", "null"] },
    line: { type: "string" },
    direction: { type: ["string", "null"] },
    sfx: { type: ["string", "null"] }
  },
  required: ["speaker", "speakerLabel", "line", "direction", "sfx"]
} as const;

const ugcScriptSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    format: {
      type: "object",
      additionalProperties: false,
      properties: {
        duration: { type: "string" },
        aspectRatio: { type: "string" },
        style: { type: "string" }
      },
      required: ["duration", "aspectRatio", "style"]
    },
    castDirection: { type: "string" },
    beats: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          role: { type: "string", enum: ugcScriptBeatRoles },
          title: { type: "string" },
          timecode: { type: "string" },
          lines: { type: "array", items: ugcScriptLineSchema },
          cameraNotes: { type: ["string", "null"] },
          editingNotes: { type: ["string", "null"] },
          legalFlag: { type: ["string", "null"] }
        },
        required: [
          "id",
          "role",
          "title",
          "timecode",
          "lines",
          "cameraNotes",
          "editingNotes",
          "legalFlag"
        ]
      }
    },
    shotList: stringArraySchema,
    editingNotes: stringArraySchema,
    legalFooter: { type: ["string", "null"] }
  },
  required: [
    "format",
    "castDirection",
    "beats",
    "shotList",
    "editingNotes",
    "legalFooter"
  ]
} as const;

function parseRequestBody(value: unknown): HookGenerationHarnessRequest {
  if (!isRecord(value)) throw new Error("Invalid hook generation request.");

  const runId = readString(value.runId, "runId");
  const service = readString(value.service, "service");
  const quantity = readNumber(value.quantity, "quantity");
  const brief = readString(value.brief, "brief");
  const attachments = readStringArray(value.attachments, "attachments");
  const uploadedMaterials = readUploadedMaterials(value.uploadedMaterials);
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
    agentHookPrompt: readOptionalAgentHookPrompt(value.agentHookPrompt),
    researchOnly: readOptionalBoolean(value.researchOnly, "researchOnly"),
    researchDossier: readOptionalResearchDossier(value.researchDossier),
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
    attachments,
    uploadedMaterials,
    brandLibrary: {
      brand: activeBrandKitItems(
        readLibraryItems(brandLibrary.brand, "brandLibrary.brand")
      ),
      products: readLibraryItems(
        brandLibrary.products,
        "brandLibrary.products"
      ),
      docs: readLibraryItems(brandLibrary.docs, "brandLibrary.docs"),
      refs: readLibraryItems(brandLibrary.refs, "brandLibrary.refs")
    }
  };
}

function readOptionalAgentHookPrompt(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("agentHookPrompt must be a non-empty string.");
  }
  if (value.length > 120_000) {
    throw new Error("agentHookPrompt is too long.");
  }
  return value;
}

function readOptionalBoolean(
  value: unknown,
  field: string
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean.`);
  return value;
}

function readOptionalResearchDossier(
  value: unknown
): HookResearchDossier | undefined {
  if (value === undefined) return undefined;
  try {
    return parseHookResearchDossier(JSON.stringify(value));
  } catch (error) {
    throw new Error(
      `researchDossier is invalid: ${
        error instanceof Error ? error.message : "unexpected dossier shape"
      }`
    );
  }
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
      "- album-post: เลือก albumFormat จาก Runtime options ต่อไปนี้:",
      "  - three-vertical: vertical cover + 2 supporting panels; formatBeats ต้องมี 2 ข้อ หนึ่งข้อต่อ supporting panel.",
      "  - three-horizontal: horizontal cover + 2 supporting panels; formatBeats ต้องมี 2 ข้อ หนึ่งข้อต่อ supporting panel.",
      "  - four-vertical: vertical cover + 3 supporting panels; formatBeats ต้องมี 3 ข้อ หนึ่งข้อต่อ supporting panel.",
      "  - four-grid: cover + 3 supporting panels; formatBeats ต้องมี 3 ข้อ หนึ่งข้อต่อ supporting panel."
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
  return `- album-post: Selected layout is ${layout}. formatBeats ต้องมี ${supportingPanelCount} ข้อ หนึ่งข้อต่อ supporting panel.`;
}

function readHookIdeaMode(value: unknown): HookIdeaMode {
  if (
    value === undefined ||
    value === "standard" ||
    value === "fresh-research"
  ) {
    return "fresh-research";
  }
  throw new Error("hookIdeaMode is invalid.");
}

function readHookGenerationModel(value: unknown): HookGenerationModel {
  if (value === undefined) return DEFAULT_HOOK_MODEL;
  if (isHookGenerationModel(value)) return value;
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

function parseHookGenerationResult(text: string): HookGenerationResult {
  const parsed = JSON.parse(unwrapJsonCodeFence(text)) as unknown;
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
      const visual = readString(
        direction.visual,
        `directions[${index}].visual`
      );
      const cta = readString(direction.cta, `directions[${index}].cta`);
      const caption = normalizeGeneratedCaptionFormatting(
        readString(
          direction.caption,
          `directions[${index}].caption`
        )
      );
      const albumFormat = readGeneratedAlbumFormat(
        direction.albumFormat,
        `directions[${index}].albumFormat`,
        service
      );
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
      const id = readString(direction.id, `directions[${index}].id`);
      const sourceCandidateId =
        typeof direction.sourceCandidateId === "string" &&
        direction.sourceCandidateId.trim()
          ? direction.sourceCandidateId.trim()
          : id;
      return {
        id,
        sourceCandidateId,
        service,
        hook,
        subheadline:
          direction.subheadline === undefined || direction.subheadline === null
            ? ""
            : readString(
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

function unwrapJsonCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
}

function parseUgcScriptResult(
  text: string,
  directionId: string
): UgcScriptDocument {
  const parsed = JSON.parse(unwrapJsonCodeFence(text)) as unknown;
  const value = readRecord(parsed, "ugcScript");
  const format = readRecord(value.format, "ugcScript.format");

  const beatsValue = value.beats;
  if (!Array.isArray(beatsValue)) {
    throw new Error("ugcScript.beats must be an array.");
  }
  const beats = beatsValue.map((item, index) => {
    const beat = readRecord(item, `ugcScript.beats[${index}]`);
    const linesValue = beat.lines;
    if (!Array.isArray(linesValue)) {
      throw new Error(`ugcScript.beats[${index}].lines must be an array.`);
    }
    const lines = linesValue.map((lineItem, lineIndex) => {
      const lineField = `ugcScript.beats[${index}].lines[${lineIndex}]`;
      const line = readRecord(lineItem, lineField);
      return {
        speaker: readUgcScriptSpeaker(line.speaker, `${lineField}.speaker`),
        ...(typeof line.speakerLabel === "string" && line.speakerLabel.trim()
          ? { speakerLabel: line.speakerLabel.trim() }
          : {}),
        line: readString(line.line, `${lineField}.line`),
        ...(typeof line.direction === "string" && line.direction.trim()
          ? { direction: line.direction.trim() }
          : {}),
        ...(typeof line.sfx === "string" && line.sfx.trim()
          ? { sfx: line.sfx.trim() }
          : {})
      };
    });
    return {
      id: readString(beat.id, `ugcScript.beats[${index}].id`),
      role: readUgcScriptBeatRole(beat.role, `ugcScript.beats[${index}].role`),
      title: readString(beat.title, `ugcScript.beats[${index}].title`),
      timecode: readString(beat.timecode, `ugcScript.beats[${index}].timecode`),
      lines,
      ...(typeof beat.cameraNotes === "string" && beat.cameraNotes.trim()
        ? { cameraNotes: beat.cameraNotes.trim() }
        : {}),
      ...(typeof beat.editingNotes === "string" && beat.editingNotes.trim()
        ? { editingNotes: beat.editingNotes.trim() }
        : {}),
      ...(typeof beat.legalFlag === "string" && beat.legalFlag.trim()
        ? { legalFlag: beat.legalFlag.trim() }
        : {})
    };
  });

  return {
    directionId,
    format: {
      duration: readString(format.duration, "ugcScript.format.duration"),
      aspectRatio: readString(
        format.aspectRatio,
        "ugcScript.format.aspectRatio"
      ),
      style: readString(format.style, "ugcScript.format.style")
    },
    castDirection: readString(value.castDirection, "ugcScript.castDirection"),
    beats,
    shotList: readStringArray(value.shotList, "ugcScript.shotList"),
    editingNotes: readStringArray(value.editingNotes, "ugcScript.editingNotes"),
    ...(typeof value.legalFooter === "string" && value.legalFooter.trim()
      ? { legalFooter: value.legalFooter.trim() }
      : {})
  };
}

function readUgcScriptSpeaker(value: unknown, field: string): UgcScriptSpeaker {
  if (
    typeof value !== "string" ||
    !ugcScriptSpeakers.includes(value as UgcScriptSpeaker)
  ) {
    throw new Error(`${field} is invalid.`);
  }
  return value as UgcScriptSpeaker;
}

function readUgcScriptBeatRole(
  value: unknown,
  field: string
): UgcScriptBeatRole {
  if (
    typeof value !== "string" ||
    !ugcScriptBeatRoles.includes(value as UgcScriptBeatRole)
  ) {
    throw new Error(`${field} is invalid.`);
  }
  return value as UgcScriptBeatRole;
}

function readGeneratedAlbumFormat(
  value: unknown,
  field: string,
  service: ServiceType
): AlbumFormat | undefined {
  if (service !== "album-post") return undefined;
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
  albumFormat: AlbumFormat | undefined
): readonly string[] {
  if (service === "single-static" || service === "resize") return [];
  const normalized = beats.map((beat) => beat.trim()).filter(Boolean);
  if (service !== "album-post") return normalized;
  if (!albumFormat) {
    throw new Error(`directions[${index}].albumFormat is invalid.`);
  }
  const requiredCount = albumFormat.startsWith("three-") ? 2 : 3;
  if (normalized.length !== requiredCount) {
    throw new Error(
      `directions[${index}].formatBeats must contain exactly ${requiredCount} items for ${albumFormat}.`
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
  const fallbackScenes = [
    {
      title: "HOOK",
      duration: "0–5 วินาที",
      scriptLines: [fallback.hook],
      visual: fallback.visual,
      textOverlay: fallback.hook
    },
    {
      title: "DEVELOPMENT",
      duration: "5–15 วินาที",
      scriptLines: [fallback.concept],
      visual: fallback.visual,
      textOverlay: fallback.formatBeats[1] ?? fallback.concept
    },
    {
      title: "PROOF / BENEFIT",
      duration: "15–25 วินาที",
      scriptLines: [fallback.why],
      visual: fallback.visual,
      textOverlay: fallback.why
    },
    {
      title: "CTA",
      duration: "25–30 วินาที",
      scriptLines: [fallback.cta],
      visual: fallback.visual,
      textOverlay: fallback.cta
    }
  ];

  if (value === undefined) {
    return {
      product: "สินค้า/บริการตาม Brief",
      duration: "15–30 วินาที",
      objective: fallback.why,
      moodAndTone: fallback.visual,
      productionStyle: "Creator-led vertical video ที่เป็นธรรมชาติและตัดต่อกระชับ",
      referenceDirection: fallback.visual,
      scenes: fallbackScenes
    };
  }

  const record = readRecord(value, field);
  if (!Array.isArray(record.scenes) || record.scenes.length !== 4) {
    throw new Error(`${field}.scenes must contain exactly 4 scenes.`);
  }
  const scenes = record.scenes.map((scene, index) => {
    const sceneField = `${field}.scenes[${index}]`;
    const item = readRecord(scene, sceneField);
    const scriptLines = readStringArray(
      item.scriptLines,
      `${sceneField}.scriptLines`
    )
      .map((line) => line.trim())
      .filter(Boolean);
    if (scriptLines.length < 1 || scriptLines.length > 2) {
      throw new Error(`${sceneField}.scriptLines must contain 1 or 2 lines.`);
    }
    return {
      title: readString(item.title, `${sceneField}.title`),
      duration: readString(item.duration, `${sceneField}.duration`),
      scriptLines,
      visual: readString(item.visual, `${sceneField}.visual`),
      textOverlay: readString(item.textOverlay, `${sceneField}.textOverlay`)
    };
  });
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
    scenes
  };
}

function parseSubheadlineHighlights(
  text: string,
  items: readonly { id: string; subheadline: string }[]
): ReadonlyMap<string, string> {
  const parsed = JSON.parse(unwrapJsonCodeFence(text)) as unknown;
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
