import { resolveConvertCakeAuthorization } from "../shared/convert-cake-auth.js";

type FetchLike = typeof fetch;
type ReviewDecision = "approved" | "rejected" | null;

export interface SuggestLearningEndpointEnv {
  OPENAI_API_KEY?: string;
  OPENAI_BRAND_LEARNING_MODEL?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

export interface SuggestLearningEndpointOptions {
  request: Request;
  env: SuggestLearningEndpointEnv;
  fetchImpl?: FetchLike;
}

interface CreativeSignal {
  hook: string;
  concept: string;
  visual: string;
  cta: string;
  caption: string;
  graphicDesign: ReviewDecision;
  clientService: ReviewDecision;
  projectManager: ReviewDecision;
  clientStatus: string;
}

interface SuggestLearningRequest {
  runId: string;
  brand: { id: string; name: string; category: string };
  service: string;
  brief: string;
  creatives: readonly CreativeSignal[];
}

interface LearningSuggestion {
  polarity: "working" | "avoid";
  note: string;
}

const DEFAULT_MODEL = "gpt-5.6-luna";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

export async function handleSuggestLearningRequest({
  request,
  env,
  fetchImpl = fetch
}: SuggestLearningEndpointOptions): Promise<Response> {
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
    const model = env.OPENAI_BRAND_LEARNING_MODEL?.trim() || DEFAULT_MODEL;

    const payload = await callResponsesApi({
      apiKey,
      model,
      fetchImpl,
      prompt: buildPrompt(input)
    });
    const suggestions = parseSuggestions(extractResponseText(payload));

    return jsonResponse({ ok: true, suggestions });
  } catch (error) {
    return jsonResponse({ ok: false, error: readableError(error) }, 500);
  }
}

async function callResponsesApi({
  apiKey,
  model,
  fetchImpl,
  prompt
}: {
  apiKey: string;
  model: string;
  fetchImpl: FetchLike;
  prompt: string;
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
          content: [{ type: "input_text", text: prompt }]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "moons_brand_learning_suggestions",
          strict: true,
          schema: suggestionsSchema
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI brand learning suggestion failed: ${response.status}`);
  }

  return readJsonResponse(response, "OpenAI brand learning suggestion");
}

function buildPrompt(input: SuggestLearningRequest): string {
  return [
    "คุณคือผู้ช่วยวิเคราะห์ผลลัพธ์ของ creative run เพื่อเสนอ brand learning ใหม่",
    "",
    "ใช้เฉพาะข้อมูล hook, concept, visual, CTA, caption และผลการอนุมัติ/ปฏิเสธที่ให้มาเท่านั้น",
    "ห้ามแต่งเหตุผลหรือสมมติฐานที่ไม่มีหลักฐานจากข้อมูลที่ให้มา",
    "ถ้าข้อมูลยังไม่พอสรุป (เช่น ทุกชิ้นยัง pending หรือทุกชิ้นผ่านหมดโดยไม่มีรูปแบบที่ชัดเจน) ให้คืน suggestions เป็น array ว่าง",
    "",
    "แยกเป็นสองประเภท:",
    "- working: รูปแบบที่พบใน creative ที่ได้รับการอนุมัติ (GD/CS/PM หรือ client)",
    "- avoid: รูปแบบที่พบใน creative ที่ถูกปฏิเสธหรือถูกขอแก้ไข",
    "",
    "เขียนแต่ละ note เป็นภาษาไทยสั้น กระชับ นำไปใช้ได้จริงในการสร้าง creative ครั้งถัดไป",
    `เสนอได้สูงสุด 6 รายการ`,
    "",
    `Brand: ${input.brand.name} (${input.brand.category})`,
    `Service: ${input.service}`,
    `Brief: ${input.brief}`,
    "",
    "Creatives ในรอบนี้:",
    ...input.creatives.map((creative, index) =>
      [
        `${index + 1}. Hook: ${creative.hook}`,
        `   Concept: ${creative.concept}`,
        `   Visual: ${creative.visual}`,
        `   CTA: ${creative.cta}`,
        `   Caption: ${creative.caption}`,
        `   GD: ${creative.graphicDesign ?? "pending"}, CS: ${creative.clientService ?? "pending"}, PM: ${creative.projectManager ?? "pending"}, Client: ${creative.clientStatus}`
      ].join("\n")
    ),
    "",
    "Return only JSON ตาม schema."
  ].join("\n");
}

const suggestionsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          polarity: { type: "string", enum: ["working", "avoid"] },
          note: { type: "string" }
        },
        required: ["polarity", "note"]
      }
    }
  },
  required: ["suggestions"]
} as const;

function parseSuggestions(text: string): readonly LearningSuggestion[] {
  const parsed = JSON.parse(text) as unknown;
  const value = readRecord(parsed, "suggestions payload");
  if (!Array.isArray(value.suggestions)) {
    throw new Error("suggestions must be an array.");
  }

  return value.suggestions.map((item, index) => {
    const record = readRecord(item, `suggestions[${index}]`);
    const polarity = record.polarity;
    if (polarity !== "working" && polarity !== "avoid") {
      throw new Error(`suggestions[${index}].polarity is invalid.`);
    }
    return {
      polarity,
      note: readString(record.note, `suggestions[${index}].note`)
    };
  });
}

function parseRequestBody(value: unknown): SuggestLearningRequest {
  if (!isRecord(value)) throw new Error("Invalid brand learning request.");

  const runId = readString(value.runId, "runId");
  const service = readString(value.service, "service");
  const brief = readString(value.brief, "brief");
  const brand = readRecord(value.brand, "brand");

  if (!Array.isArray(value.creatives)) {
    throw new Error("creatives must be an array.");
  }

  return {
    runId,
    brand: {
      id: readString(brand.id, "brand.id"),
      name: readString(brand.name, "brand.name"),
      category: readString(brand.category, "brand.category")
    },
    service,
    brief,
    creatives: value.creatives.map((item, index) =>
      parseCreativeSignal(item, index)
    )
  };
}

function parseCreativeSignal(value: unknown, index: number): CreativeSignal {
  const record = readRecord(value, `creatives[${index}]`);
  return {
    hook: readString(record.hook, `creatives[${index}].hook`),
    concept: readString(record.concept, `creatives[${index}].concept`),
    visual: readString(record.visual, `creatives[${index}].visual`),
    cta: readString(record.cta, `creatives[${index}].cta`),
    caption: readString(record.caption, `creatives[${index}].caption`),
    graphicDesign: readReviewDecision(record.graphicDesign),
    clientService: readReviewDecision(record.clientService),
    projectManager: readReviewDecision(record.projectManager),
    clientStatus: readString(record.clientStatus, `creatives[${index}].clientStatus`)
  };
}

function readReviewDecision(value: unknown): ReviewDecision {
  return value === "approved" || value === "rejected" ? value : null;
}

function extractResponseText(payload: unknown): string {
  if (isRecord(payload) && typeof payload.output_text === "string") {
    return payload.output_text;
  }

  if (!isRecord(payload) || !Array.isArray(payload.output)) {
    throw new Error("OpenAI brand learning response did not include output text.");
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

  throw new Error("OpenAI brand learning response did not include output text.");
}

function readRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  return value;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function readableError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unknown brand learning suggestion error.";
}

async function readJsonResponse(
  response: Response,
  label: string
): Promise<unknown> {
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
