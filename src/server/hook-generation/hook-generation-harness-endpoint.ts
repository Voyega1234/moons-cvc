import { createClient } from "@supabase/supabase-js";
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
}

type ResponseContent = {
  type: "input_text";
  text: string;
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

interface HookGenerationResult {
  directions: readonly (RawDirection & {
    score?: unknown;
    reasoning?: unknown;
    citations?: unknown;
  })[];
}

const DEFAULT_MODEL = "gpt-5.6-terra";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const SHORTLIST_COUNT = 6;

export async function handleHookGenerationHarnessRequest({
  request,
  env,
  fetchImpl = fetch,
  createPastPostsClient = defaultCreatePastPostsClient
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
    const pastPosts = await loadPastPostExamples({
      input,
      env,
      auth,
      createPastPostsClient
    });
    const research = await runResearchStep({
      input,
      apiKey,
      model,
      fetchImpl
    });
    const result = await runGenerationStep({
      input,
      research,
      pastPosts,
      apiKey,
      model,
      fetchImpl
    });

    return jsonResponse({
      ok: true,
      directions: result.directions.slice(0, SHORTLIST_COUNT)
    });
  } catch (error) {
    return jsonResponse({ ok: false, error: readableError(error) }, 500);
  }
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
  apiKey,
  model,
  fetchImpl
}: {
  input: HookGenerationHarnessRequest;
  research: HookResearch;
  pastPosts: readonly PastPostExample[];
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
        text: buildGenerationPrompt(input, research, pastPosts)
      }
    ],
    schemaName: "moons_hook_generation",
    schema: hookGenerationSchema
  });

  return parseHookGenerationResult(extractResponseText(payload));
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
  pastPosts: readonly PastPostExample[]
): string {
  return [
    "You are a world-class Creative Strategist and Senior Thai Copywriter for paid social advertising, on the level of a senior creative who deeply understands Thai language, brand voice, audience psychology, and paid-social performance.",
    "",
    "สิ่งสำคัญที่สุดคือ HOOK / HEADLINE — มันต้องฟังดูเหมือนแบรนด์นี้พูดเองได้จริง แต่คมกว่า สดกว่า และ performance-ready กว่าเดิม",
    "",
    "ทุก concept ที่สร้างออกแบบมาสำหรับภาพนิ่งเดียว (STATIC AD): ต้องสื่อสารได้ภายใน ~2 วินาที มีข้อความหลักเดียวชัดเจน (offer / proof point / product focus / contrast / visual metaphor) ห้ามเสนอ concept ที่ต้องใช้ dialogue, หลายฉาก, หรือ storytelling ต่อเนื่อง",
    "",
    "FACTUAL GROUNDING: ใช้เฉพาะราคา โปรโมชัน features บริการ สถิติ หรือการรับประกันที่ระบุไว้ใน input เท่านั้น ห้ามแต่งหรือสมมติข้อมูลที่ไม่มีหลักฐานรองรับ",
    "",
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
    "- ศึกษาตัวอย่างโพสต์/แคปชั่นเก่าของเพจด้านล่าง แล้วเลียนแบบ tone, โครงสร้างประโยค, การเว้นบรรทัด, footer/signature, hashtag, emoji และวิธีปิดท้ายด้วย CTA ให้เหมือนเพจนี้เขียนเอง",
    "- ถ้าไม่มีตัวอย่างโพสต์เก่า ให้ยึดโทนจาก Brand Memory และ Brief แทน",
    "",
    "Silent internal process (ห้าม output ขั้นตอนนี้ออกมา):",
    "1. ย่อ brief ให้เหลือ audience insight ที่แข็งแรงที่สุด และ commercial promise ที่ชัดที่สุด",
    "2. สร้าง candidate hooks อย่างน้อย 12 แบบจากหลาย strategic angle",
    "3. judge แต่ละ candidate ด้วย brand fit, audience pain clarity, offer clarity, novelty, visualizability, paid-social thumb-stop",
    `4. เลือก ${SHORTLIST_COUNT} hooks ที่ดีที่สุดและหลากหลายที่สุด ตัดมุมที่ซ้ำกัน`,
    "5. ใส่ concept, why, visual, CTA, caption ให้ครบ แล้วขัดเกลาอีกรอบก่อนตอบ",
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
    "Return only JSON ตาม schema."
  ].join("\n");
}

function buildPastPostsBlock(pastPosts: readonly PastPostExample[]): string {
  if (pastPosts.length === 0) {
    return [
      "ตัวอย่างโพสต์เก่าของเพจนี้:",
      "ไม่มีข้อมูลโพสต์เก่าของเพจนี้ในระบบ ให้เขียน caption ตามโทนของ Brand Memory และ Brief แทน"
    ].join("\n");
  }

  return [
    "ตัวอย่าง caption จริงจากโพสต์และโฆษณาเก่าของเพจนี้ (ใช้ศึกษาสไตล์การเขียน caption เท่านั้น ห้ามคัดลอกเนื้อหา):",
    ...pastPosts.map(
      (post, index) =>
        `${index + 1}. [${post.source === "organic_post" ? "โพสต์ organic" : "แคปชั่นโฆษณา"}] ${post.text}`
    )
  ].join("\n");
}

function buildInputBlock(input: HookGenerationHarnessRequest): string {
  return [
    "## Moons current input",
    `Run ID: ${input.runId}`,
    `Brand: ${input.brand?.name ?? "Unknown"}`,
    `Category: ${input.brand?.category ?? "Unknown"}`,
    `Service: ${input.service}`,
    `Selected output quantity later: ${input.quantity}`,
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
    ...input.attachments.map((item) => `- ${item}`)
  ].join("\n");
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
          hook: { type: "string" },
          concept: { type: "string" },
          why: { type: "string" },
          visual: { type: "string" },
          cta: { type: "string" },
          caption: { type: "string" },
          score: { type: "number" },
          reasoning: { type: "string" },
          citations: stringArraySchema
        },
        required: [
          "id",
          "hook",
          "concept",
          "why",
          "visual",
          "cta",
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

function parseRequestBody(value: unknown): HookGenerationHarnessRequest {
  if (!isRecord(value)) throw new Error("Invalid hook generation request.");

  const runId = readString(value.runId, "runId");
  const service = readString(value.service, "service");
  const quantity = readNumber(value.quantity, "quantity");
  const brief = readString(value.brief, "brief");
  const attachments = readStringArray(value.attachments, "attachments");
  const brandMemory = readRecord(value.brandMemory, "brandMemory");
  const brandLibrary = readRecord(value.brandLibrary, "brandLibrary");

  return {
    runId,
    brand: value.brand === null ? null : parseBrand(value.brand),
    service: service as HookGenerationHarnessRequest["service"],
    quantity,
    brief,
    extraInstructions:
      typeof value.extraInstructions === "string"
        ? value.extraInstructions
        : "",
    existingHooks: readExistingHooks(value.existingHooks),
    attachments,
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
      return {
        id: readString(direction.id, `directions[${index}].id`),
        hook: readString(direction.hook, `directions[${index}].hook`),
        concept: readString(direction.concept, `directions[${index}].concept`),
        why: readString(direction.why, `directions[${index}].why`),
        visual: readString(direction.visual, `directions[${index}].visual`),
        cta: readString(direction.cta, `directions[${index}].cta`),
        caption: readString(direction.caption, `directions[${index}].caption`),
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
