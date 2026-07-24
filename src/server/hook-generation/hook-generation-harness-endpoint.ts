import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  albumFormatPreferences,
  albumFormats,
  ctaActionTypes,
  defaultAlbumFormatPreference,
  serviceTypes,
  type AlbumFormat,
  type AlbumFormatPreference,
  type CtaActionType,
  type HookIdeaMode,
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
  fetchPastPostExamples,
  type PastPostExample,
  type PastPostsClient
} from "./past-posts.js";

type FetchLike = typeof fetch;

export interface HookGenerationHarnessEndpointEnv {
  OPENAI_API_KEY?: string;
  OPENAI_HOOK_GENERATION_MODEL?: string;
  OPENAI_HOOK_SUPPORT_MODEL?: string;
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

interface HookResearchReference {
  name: string;
  type:
    | "provable_moment"
    | "evidence_backed_behavior"
    | "cultural_fever"
    | "platform_buzz"
    | "category_signal";
  whyItMatters: string;
  brandRelevance: string;
  evidenceSummary: string;
  evidenceStrength: "strong" | "medium" | "weak";
}

interface HookResearch {
  overallFinding: string;
  references: readonly HookResearchReference[];
  searchQueriesUsed: readonly string[];
  limitations: string;
}

interface GeneratedDirection extends RawDirection {
  id: string;
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

const DEFAULT_MODEL = "gpt-5.6-terra";
const DEFAULT_SUPPORT_MODEL = "gpt-5.6-luna";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const HOOK_GENERATION_BATCH_SIZE = 12;
const HOOK_GENERATION_CONCURRENCY = 3;
const SUBHEADLINE_BATCH_SIZE = 24;

export async function handleHookGenerationHarnessRequest({
  request,
  env,
  fetchImpl = fetch,
  createPastPostsClient = defaultCreatePastPostsClient,
  loadAgentHookPrompt = defaultLoadAgentHookPrompt
}: HookGenerationHarnessEndpointOptions): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  try {
    const apiKey = env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
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
    const model = env.OPENAI_HOOK_GENERATION_MODEL?.trim() || DEFAULT_MODEL;
    const supportModel =
      env.OPENAI_HOOK_SUPPORT_MODEL?.trim() || DEFAULT_SUPPORT_MODEL;
    const pastPosts = await loadPastPostExamples({
      input,
      env,
      auth,
      createPastPostsClient
    });
    const agentHookPrompt = await loadAgentHookPrompt();
    const research = await runResearchStep({
      input,
      apiKey,
      model: supportModel,
      fetchImpl
    });
    const generationBatches = buildHookGenerationBatches(input);
    const batchResults = await mapWithConcurrency(
      generationBatches,
      HOOK_GENERATION_CONCURRENCY,
      (batch) =>
        withTransientRetry(() =>
          runGenerationStep({
            input: batch,
            research,
            pastPosts,
            agentHookPrompt,
            apiKey,
            model,
            fetchImpl
          })
        )
    );
    const directions = makeDirectionIdsUnique(
      batchResults.flatMap((result) => result.directions)
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
      apiKey,
      model: supportModel,
      fetchImpl
    });

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

async function runResearchStep({
  input,
  apiKey,
  model,
  fetchImpl
}: {
  input: HookGenerationHarnessRequest;
  apiKey: string;
  model: string;
  fetchImpl: FetchLike;
}): Promise<HookResearch> {
  const payload = await callResponsesApi({
    apiKey,
    model,
    fetchImpl,
    content: [
      {
        type: "input_text",
        text: buildResearchPrompt(input)
      }
    ],
    schemaName: "moons_hook_research",
    schema: hookResearchSchema,
    tools: [{ type: "web_search_preview" }]
  });

  return parseHookResearch(extractResponseText(payload));
}

async function runGenerationStep({
  input,
  research,
  pastPosts,
  agentHookPrompt,
  apiKey,
  model,
  fetchImpl
}: {
  input: HookGenerationHarnessRequest;
  research: HookResearch;
  pastPosts: readonly PastPostExample[];
  agentHookPrompt: string;
  apiKey: string;
  model: string;
  fetchImpl: FetchLike;
}): Promise<HookGenerationResult> {
  const payload = await callResponsesApi({
    apiKey,
    model,
    fetchImpl,
    content: [
      {
        type: "input_text",
        text: buildGenerationPrompt(input, research, pastPosts, agentHookPrompt)
      },
      ...input.uploadedMaterials.map((material) => ({
        type: "input_image" as const,
        image_url: material.url,
        detail: "high" as const
      }))
    ],
    schemaName: "moons_hook_generation",
    schema: hookGenerationSchema
  });

  const result = parseHookGenerationResult(extractResponseText(payload));
  const preference = input.albumFormat ?? defaultAlbumFormatPreference;
  if (preference === "auto") return result;
  return {
    directions: result.directions.map((direction) =>
      direction.service === "album-post"
        ? { ...direction, albumFormat: preference }
        : direction
    )
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
  tools
}: {
  apiKey: string;
  model: string;
  fetchImpl: FetchLike;
  content: readonly ResponseContent[];
  schemaName: string;
  schema: unknown;
  tools?: readonly { type: string }[];
}): Promise<unknown> {
  const response = await fetchImpl(OPENAI_RESPONSES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      store: false,
      input: [
        {
          role: "user",
          content
        }
      ],
      ...(tools?.length ? { tools } : {}),
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI hook harness failed: ${response.status}`);
  }

  return readJsonResponse(response, "OpenAI hook harness");
}

function buildResearchPrompt(input: HookGenerationHarnessRequest): string {
  return [
    "# THAI PROVABLE MOMENT, BEHAVIOR & CULTURAL FEVER RESEARCH AGENT",
    "",
    "คุณคือ Thai research source agent สำหรับหา reference ที่พิสูจน์ได้และ brand-safe เพื่อช่วยวาง hook โฆษณา",
    "ใช้ Google/Web search actively โดยค้นภาษาไทยก่อน ใช้ภาษาอังกฤษเมื่อจำเป็น",
    "",
    "ห้ามสร้าง hooks, captions, headlines, content ideas หรือ creative suggestions ในขั้น research นี้",
    "ห้ามแต่ง trend, statistic, source title, publisher, ranking หรือ percentage",
    "คัดเฉพาะ reference ที่มีหลักฐานจากแหล่งจริงและปลอดภัยต่อแบรนด์",
    "",
    "หาได้เฉพาะ 5 ประเภทนี้:",
    "1. provable moments: วัน/ฤดูกาล/แคมเปญ/บริบทสาธารณะที่มีวันที่ชัดเจน",
    "2. evidence-backed consumer behaviors: พฤติกรรมผู้บริโภคที่มี survey/report/news/platform data",
    "3. cultural fever: กระแสบันเทิงหรือวัฒนธรรมที่ mass และ brand-safe",
    "4. platform buzz: สิ่งที่ติด ranking/trending บน platform",
    "5. category signal: สัญญาณจริงใน category ของแบรนด์",
    "",
    buildInputBlock(input),
    "",
    "Return only JSON ตาม schema. เขียนภาษาไทย ยกเว้น source title, publisher, brand, product, platform, special terms."
  ].join("\n");
}

function buildGenerationPrompt(
  input: HookGenerationHarnessRequest,
  research: HookResearch,
  pastPosts: readonly PastPostExample[],
  agentHookPrompt: string
): string {
  return [
    renderAgentHookPrompt(agentHookPrompt, input, research, pastPosts),
    "",
    "You are a world-class Creative Strategist and Senior Thai Copywriter for paid social advertising, on the level of a senior creative who deeply understands Thai language, brand voice, audience psychology, and paid-social performance.",
    "",
    "สิ่งสำคัญที่สุดคือ HOOK / HEADLINE — มันต้องฟังดูเหมือนแบรนด์นี้พูดเองได้จริง แต่คมกว่า สดกว่า และ performance-ready กว่าเดิม",
    "",
    "CONTENT TYPE EXECUTION — แต่ละ format ต้องคิดคนละแบบ ห้ามนำ Static concept เดิมไปเปลี่ยน label:",
    "- single-static: รักษามาตรฐานเดิม สื่อสาร one sharp idea ในภาพเดียวภายใน ~2 วินาที. Hook เป็น visual headline ที่จบความคิดได้ในภาพเดียว. คืน formatBeats เป็น [] เสมอ.",
    albumHookInstruction(
      input.albumFormat ?? defaultAlbumFormatPreference
    ),
    "- ugc-video: คิดเป็น creator-led vertical video ที่ฟังเหมือนคนจริงพูด ไม่ใช่ headline บนโปสเตอร์. Hook ต้องเปิดเรื่องได้ใน 1-3 วินาที. formatBeats ต้องมี 3 beat พอดี: opening situation/tension → demonstration/proof → brand-fit action/close.",
    "  สำหรับ ugc-video ให้สร้าง ugcBrief เพิ่มเติม: product = ชื่อสินค้า/บริการที่มีหลักฐานตรง, duration = ความยาวที่เหมาะสม เช่น 15–30 วินาที, objective = เป้าหมายวิดีโอที่ชัด, moodAndTone = mood/tone 3–5 คำพร้อมคำอธิบายสั้น, productionStyle = วิธีถ่ายและตัดต่อที่ creator ทำตามได้, referenceDirection = ลักษณะ reference visual ที่ควรหา/แนบโดยไม่อ้างชื่อ creator จริง, openingScript = คำพูด+action+ข้อความบนจอสำหรับช่วงเปิด, showcaseScript = คำพูด+action+proof/demo ช่วงกลาง, closingScript = คำพูด+action+CTA ช่วงปิด. แต่ละ script ต้อง production-ready 2–5 ประโยค กระชับ เป็นภาษาคนจริง และห้ามแต่ง claim. สำหรับ service อื่นให้คืนทุก field ใน ugcBrief เป็น string ว่าง.",
    "- motion-static: คิดเป็น short motion creative. Hook ต้องทำงานกับ movement/reveal. formatBeats ต้องมี 3 beat พอดี: opening frame → motion/reveal → resolved message/CTA.",
    "- resize: adapt approved work ไป placement ใหม่โดยไม่เสียสารหลัก และคืน formatBeats เป็น [].",
    "",
    "FACTUAL GROUNDING: ใช้เฉพาะราคา โปรโมชัน features บริการ สถิติ หรือการรับประกันที่ระบุไว้ใน input เท่านั้น ห้ามแต่งหรือสมมติข้อมูลที่ไม่มีหลักฐานรองรับ",
    "",
    ...(input.uploadedMaterials.length
      ? [
          "UPLOADED CREATIVE MATERIALS: inspect every attached image. Build ideas that can genuinely use the visible product/client material. Treat a main-object or product image as an available source object, not loose inspiration. Supporting components may shape the execution without becoming the hero. Never claim an object, feature, or detail that is not visible or stated in the input.",
          ""
        ]
      : []),
    "CONCEPT STRATEGY: ทุก concept ต้องเชื่อมโยงชัดเจน User Brief → Audience Insight → Product Focus → Strategic Angle → Headline โดยเริ่มจาก audience moment/tension/desire/objection ที่จำเพาะ ไม่ใช่เริ่มจาก product feature ตรงๆ ใช้มุมที่หลากหลาย เช่น pain-led, insight-led, desire-led, trust-building, objection-handling, offer-led, contrast, proof-led, before-after — เลือกเฉพาะมุมที่เหมาะกับแบรนด์และ brief จริงๆ",
    "",
    "HEADLINE STANDARD: สื่อความคิดเดียวชัดเจน อ่านแล้วเข้าใจทันที ฟังดูเป็นธรรมชาติเมื่ออ่านออกเสียง จำเพาะกับแบรนด์และ audience มีเหตุผลจริงที่ทำให้คนหยุดเลื่อน กระชับแต่ไม่แห้งจนไร้อารมณ์ ปกติยาวประมาณ 6-13 คำภาษาไทย ห้ามใช้ ellipsis, วงเล็บ, ประโยคคำถามเชิงวาทศิลป์ยาวๆ, โครงสร้าง \"เพราะ...จึง...\", การเรียงคำแบบ keyword stacking, สัมผัสเสแสร้ง ห้ามใช้วลีสำเร็จรูปเช่น ตอบโจทย์ทุกความต้องการ / ครบจบในที่เดียว / คุ้มกว่าที่เคย / ดีที่สุดสำหรับคุณ / เพื่อคุณโดยเฉพาะ / ยกระดับประสบการณ์ / ห้ามพลาด / โปรสุดคุ้ม / ราคาโดนใจ / เหนือระดับ / พรีเมียมเหนือใคร",
    "",
    "VISUAL DIRECTION: อธิบายเฉพาะ mood, emotional tone, ระดับความ polish, และ information hierarchy ที่ต้องการ (เช่น สะอาด ทันสมัย น่าเชื่อถือ อบอุ่น พรีเมียม) 1-2 ประโยคสั้นๆ ห้ามระบุฉาก, ตัวละคร, มุมกล้อง, พร็อพ, หรือ layout ที่ตายตัว — ทีมสร้างภาพจะกำหนดรายละเอียดที่ execution ต่อจากนี้เอง",
    "",
    "Hook ต้อง:",
    "- เป็นภาษาไทยที่เป็นธรรมชาติ ไม่ใช่ภาษาไทยที่แปลมา",
    "- brand-native เหมือนแบรนด์นี้พูดเองได้จริง",
    "- ชัด คม performance-ready แต่ไม่ clickbait",
    "- ใช้ Brand Memory และ Brief เป็น priority สูงสุด",
    "- ใช้ research เป็น supporting context เท่านั้น ห้ามฝืนใช้ trend ถ้าไม่เกี่ยว",
    "- ไม่กล่าว claim ที่ Brand Memory/Products/Brief ไม่รองรับ",
    "",
    "Caption ต้อง:",
    "- เขียนในฐานะที่คุณคือ copywriter ประจำเพจนี้ ไม่ใช่นักเขียนภายนอก",
    "- วิเคราะห์ตัวอย่างโพสต์/แคปชั่นจริงด้านล่างเป็นชุด ไม่ใช่อ่านแค่โพสต์เดียว: หา pattern ที่เกิดซ้ำของ opening, paragraph length, line breaks, bullets, emoji, hashtag, footer/signature, contact details และวิธีปิดท้ายด้วย CTA",
    "- เขียน caption ใหม่ด้วย format และจังหวะภาษาที่พบจริงในอดีตของเพจ โดยคง footer/contact ที่เกิดซ้ำในโพสต์ส่วนใหญ่ไว้ในตำแหน่งเดิมและสะกดเหมือนต้นฉบับทุกตัวอักษร",
    "- ห้ามคัดลอกใจความ campaign เก่า แต่ให้เรียนรู้โครงสร้างการเขียนและองค์ประกอบประจำเพจ",
    "- ถ้า contact/footer พบเพียงครั้งเดียวหรือหลักฐานไม่ตรงกัน ห้ามเดาและให้ contactLine เป็น string ว่าง",
    "- นำ supportingPoints ที่เกี่ยวข้องมาร้อยเป็น caption อย่างเป็นธรรมชาติ โดยไม่ยัดทุกข้อถ้าไม่เข้ากับ format ประจำเพจ",
    "- ถ้าไม่มีตัวอย่างโพสต์เก่า ให้ยึดโทนจาก Brand Memory และ Brief แทน",
    "- ห้ามใช้คำลงท้ายสุภาพ 'ครับ' หรือ 'ค่ะ' ใน caption แม้ตัวอย่างโพสต์เก่าจะใช้",
    "",
    "Supporting points และ business details ต้อง:",
    "- supportingPoints มี 0-3 ข้อ เป็น facts, proof, service details หรือ offer mechanics ที่สั้นและช่วยให้สร้าง caption/artwork ได้จริง",
    "- ใช้เฉพาะข้อมูลที่มีหลักฐานตรงจาก Brief, Brand kit, Products, Documents หรือโพสต์จริง ห้ามสร้างราคา โปรโมชัน สถิติ ช่องทางติดต่อ หรือ claim ใหม่",
    "- contactLine ต้องเป็นบรรทัด contact/footer ที่คัดลอกตรงจากข้อมูลจริงและเกิดซ้ำอย่างสม่ำเสมอ; ถ้าไม่แน่ใจให้คืน string ว่าง",
    "",
    "CTA ต้อง:",
    "- เป็น action + object ที่ชัดและเข้ากับ brand, offer และ conversion route ปกติ 2-7 คำ เช่น 'ดูแพ็กเกจ SEO', 'จองเวลาปรึกษา', 'ขอแผนแคมเปญ'",
    "- ห้ามใช้ CTA กว้างๆ ที่ไม่บอกว่าจะได้อะไร เช่น 'ดูที่นี่', 'คลิกที่นี่', 'สนใจทัก', 'ดูเพิ่มเติม'",
    "- เรียนรู้คำและรูปแบบ CTA จากโพสต์จริงของแบรนด์เมื่อมีหลักฐาน แต่ต้องสัมพันธ์กับ direction ใหม่",
    "- ctaActionType ต้องเป็น website, line, phone, form, inbox, store หรือ other",
    "- ctaDestination ใส่เฉพาะ URL, เบอร์, LINE ID, inbox หรือปลายทางที่ปรากฏตรงๆ ใน input/โพสต์จริงเท่านั้น ถ้าไม่มีให้คืน string ว่าง",
    "- ห้ามใช้คำลงท้ายสุภาพ 'ครับ' หรือ 'ค่ะ' และห้ามเขียน CTA เป็นประโยคยาว",
    "",
    "Silent internal process (ห้าม output ขั้นตอนนี้ออกมา):",
    "1. ย่อ brief ให้เหลือ audience insight ที่แข็งแรงที่สุด และ commercial promise ที่ชัดที่สุด",
    "2. สร้าง candidate hooks อย่างน้อย 12 แบบจากหลาย strategic angle",
    "3. judge แต่ละ candidate ด้วย brand fit, audience pain clarity, offer clarity, novelty, visualizability, paid-social thumb-stop",
    `4. เลือก ${input.quantity} hooks ที่ดีที่สุดและหลากหลายที่สุดตาม content-type quota ตัดมุมที่ซ้ำกัน`,
    "5. ใส่ concept, why, visual, formatBeats, ugcBrief, supportingPoints, CTA fields, contactLine และ caption ให้ครบ แล้วขัดเกลาอีกรอบก่อนตอบ",
    "",
    "ตอบทุก field เป็นภาษาไทย ยกเว้นชื่อแบรนด์ ชื่อสินค้า Tagline ชื่อแพลตฟอร์ม และศัพท์เฉพาะ",
    "",
    buildInputBlock(input),
    "",
    "Research context จาก harness search:",
    JSON.stringify(research, null, 2),
    "",
    buildPastPostsBlock(pastPosts),
    "",
    "## Compass output adapter — this overrides only the supplied prompt's final JSON shape",
    `Return exactly ${input.quantity} directions matching this quota exactly: ${JSON.stringify(contentTypeQuotasForPrompt(input))}. Do not apply a count-plus-three rule. Return directions in the same order as the quota array.`,
    "Return only the strict directions JSON required by the response schema. Set service to the exact internal service value from the quota. Map recommendation fields as follows: hook = copywriting.headline; subheadline = copywriting.sub_headline_1; concept = concept_idea; why = why_this_concept; visual = creative_direction.main_visual_or_scene; albumFormat = the exact album layout chosen for this idea according to the album rules above (for non-album services return three-horizontal); formatBeats = the exact format-native sequence defined above; ugcBrief = the UGC-only production brief defined above, or all-empty strings for non-UGC services; supportingPoints = only verified useful factual detail bullets; cta = brand-fit action label; ctaActionType = its conversion route; ctaDestination = verified destination or empty string; contactLine = recurring verified contact/footer or empty string; caption = a complete new caption written in the recurring format learned from the real past posts.",
    "Subheadline rule: subheadline must be one concise Thai sentence that clarifies the hook. It must not be a strategy explanation, concept rationale, or paragraph, and it must not simply repeat the hook.",
    "Format-beat validation: album-post, ugc-video, and motion-static must return exactly 3 non-empty formatBeats. single-static and resize must return an empty array. Album formatBeats are the three inside-slide supporting topics—not hidden rationale and not generic filler.",
    "Final copy rule: caption and cta must never contain 'ครับ' or 'ค่ะ'. CTA must be a specific brand-fit action phrase, not a complete sentence and never a vague 'ดูที่นี่' style CTA.",
    "Do not include content_type, product_service_focus, title, strategic_angle, content_pillar, format_execution, copywriting, creative_direction, tags, or recommendations in the response. The schema's service field is required."
  ].join("\n");
}

function renderAgentHookPrompt(
  template: string,
  input: HookGenerationHarnessRequest,
  research: HookResearch,
  pastPosts: readonly PastPostExample[]
): string {
  const productFocus = input.brandLibrary.products.length
    ? input.brandLibrary.products
        .map((item) => `${item.title}: ${item.description}`)
        .join("\n")
    : "Use the product or service focus stated in the User Brief.";
  const pastPostText = pastPosts.length
    ? pastPosts.map((post) => post.text).join("\n\n")
    : "No past posts are available. Use the Brand kit and Brief for voice.";

  return template
    .replaceAll("{{ $('Webhook').first().json.body.instructions }}", input.brief)
    .replaceAll("{{ $('Webhook').first().json.body.productFocus }}", productFocus)
    .replaceAll(
      "{{ $('Webhook').first().json.body.contentTypeQuotas ? $('Webhook').first().json.body.contentTypeQuotas.toJsonString() : '[]' }}",
      JSON.stringify(contentTypeQuotasForPrompt(input))
    )
    .replaceAll("{{ $('Facebook page content').item.json.page_content }}", pastPostText)
    .replaceAll(
      "{{ $('Message a model').item.json.content.parts[0].text }}",
      JSON.stringify(research)
    );
}

function buildPastPostsBlock(pastPosts: readonly PastPostExample[]): string {
  if (pastPosts.length === 0) {
    return [
      "ตัวอย่างโพสต์เก่าของเพจนี้:",
      "ไม่มีข้อมูลโพสต์เก่าของเพจนี้ในระบบ ให้เขียน caption ตามโทนของ Brand Memory และ Brief แทน"
    ].join("\n");
  }

  return [
    "ตัวอย่าง caption จริงจากโพสต์และโฆษณาเก่าของเพจนี้ (วิเคราะห์ร่วมกันเพื่อหา format และรายละเอียดที่เกิดซ้ำ ห้ามคัดลอกใจความ campaign):",
    ...pastPosts.map(
      (post, index) =>
        `${index + 1}. [${post.source === "organic_post" ? "โพสต์ organic" : "แคปชั่นโฆษณา"}] ${post.text}`
    )
  ].join("\n");
}

function buildInputBlock(input: HookGenerationHarnessRequest): string {
  return [
    "## Compass current input",
    `Run ID: ${input.runId}`,
    `Brand: ${input.brand?.name ?? "Unknown"}`,
    `Category: ${input.brand?.category ?? "Unknown"}`,
    `Service: ${input.service}`,
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

const stringArraySchema = {
  type: "array",
  items: { type: "string" }
} as const;

const hookResearchSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    overallFinding: { type: "string" },
    references: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          type: {
            type: "string",
            enum: [
              "provable_moment",
              "evidence_backed_behavior",
              "cultural_fever",
              "platform_buzz",
              "category_signal"
            ]
          },
          whyItMatters: { type: "string" },
          brandRelevance: { type: "string" },
          evidenceSummary: { type: "string" },
          evidenceStrength: {
            type: "string",
            enum: ["strong", "medium", "weak"]
          }
        },
        required: [
          "name",
          "type",
          "whyItMatters",
          "brandRelevance",
          "evidenceSummary",
          "evidenceStrength"
        ]
      }
    },
    searchQueriesUsed: stringArraySchema,
    limitations: { type: "string" }
  },
  required: [
    "overallFinding",
    "references",
    "searchQueriesUsed",
    "limitations"
  ]
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
            maxItems: 3,
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

function parseHookResearch(text: string): HookResearch {
  const parsed = JSON.parse(text) as unknown;
  const value = readRecord(parsed, "research");

  return {
    overallFinding: readString(value.overallFinding, "overallFinding"),
    references: readResearchReferences(value.references),
    searchQueriesUsed: readStringArray(
      value.searchQueriesUsed,
      "searchQueriesUsed"
    ),
    limitations: readString(value.limitations, "limitations")
  };
}

function readResearchReferences(value: unknown): readonly HookResearchReference[] {
  if (!Array.isArray(value)) throw new Error("references must be an array.");

  return value.map((item, index) => {
    const record = readRecord(item, `references[${index}]`);
    return {
      name: readString(record.name, `references[${index}].name`),
      type: readResearchType(record.type, `references[${index}].type`),
      whyItMatters: readString(
        record.whyItMatters,
        `references[${index}].whyItMatters`
      ),
      brandRelevance: readString(
        record.brandRelevance,
        `references[${index}].brandRelevance`
      ),
      evidenceSummary: readString(
        record.evidenceSummary,
        `references[${index}].evidenceSummary`
      ),
      evidenceStrength: readEvidenceStrength(
        record.evidenceStrength,
        `references[${index}].evidenceStrength`
      )
    };
  });
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

  if (!isRecord(payload) || !Array.isArray(payload.output)) {
    throw new Error("OpenAI hook response did not include output text.");
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

  throw new Error("OpenAI hook response did not include output text.");
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

function readResearchType(
  value: unknown,
  field: string
): HookResearchReference["type"] {
  const valid = [
    "provable_moment",
    "evidence_backed_behavior",
    "cultural_fever",
    "platform_buzz",
    "category_signal"
  ] as const;
  if (typeof value !== "string" || !valid.includes(value as never)) {
    throw new Error(`${field} is invalid.`);
  }
  return value as HookResearchReference["type"];
}

function readEvidenceStrength(
  value: unknown,
  field: string
): HookResearchReference["evidenceStrength"] {
  const valid = ["strong", "medium", "weak"] as const;
  if (typeof value !== "string" || !valid.includes(value as never)) {
    throw new Error(`${field} is invalid.`);
  }
  return value as HookResearchReference["evidenceStrength"];
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
