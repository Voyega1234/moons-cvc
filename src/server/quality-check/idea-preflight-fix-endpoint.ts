import { resolveConvertCakeAuthorization } from "../shared/convert-cake-auth.js";

type FetchLike = typeof fetch;
type CheckId = "quality" | "spelling" | "policy";
type FixableField =
  | "hook"
  | "subheadline"
  | "concept"
  | "visual"
  | "cta"
  | "caption";

export interface IdeaPreflightFixEndpointEnv {
  OPENROUTER_API_KEY?: string;
  OPENROUTER_IDEA_PREFLIGHT_FIX_MODEL?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

export interface IdeaPreflightFixEndpointOptions {
  request: Request;
  env: IdeaPreflightFixEndpointEnv;
  fetchImpl?: FetchLike;
}

interface IdeaPreflightFixRequest {
  field: FixableField;
  check: CheckId;
  message: string;
  suggestion: string | null;
  instructions: string;
  direction: {
    hook: string;
    subheadline: string;
    concept: string;
    visual: string;
    cta: string;
    caption: string;
  };
  brandPolicies: readonly string[];
  brandAvoid: readonly string[];
}

const DEFAULT_MODEL = "google/gemini-3.8-flash";
const OPENROUTER_CHAT_COMPLETIONS_ENDPOINT =
  "https://openrouter.ai/api/v1/chat/completions";
const CHECK_IDS = new Set<CheckId>(["quality", "spelling", "policy"]);
const FIXABLE_FIELDS = new Set<FixableField>([
  "hook",
  "subheadline",
  "concept",
  "visual",
  "cta",
  "caption"
]);
const FIELD_LABELS: Record<FixableField, string> = {
  hook: "Hook",
  subheadline: "Subheadline",
  concept: "Concept",
  visual: "Visual direction",
  cta: "CTA",
  caption: "Caption"
};

export async function handleIdeaPreflightFixRequest({
  request,
  env,
  fetchImpl = fetch
}: IdeaPreflightFixEndpointOptions): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  try {
    const apiKey = env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) {
      return jsonResponse(
        { ok: false, error: "OPENROUTER_API_KEY is required." },
        500
      );
    }

    const auth = await resolveConvertCakeAuthorization(request, env, fetchImpl);
    if (!auth.authorized) {
      return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
    }

    const input = parseRequestBody(await request.json());
    const model = env.OPENROUTER_IDEA_PREFLIGHT_FIX_MODEL?.trim() || DEFAULT_MODEL;
    const payload = await callChatCompletions({
      apiKey,
      model,
      fetchImpl,
      prompt: buildPrompt(input)
    });
    const revisedText = parseRevisedText(extractResponseText(payload));

    return jsonResponse({ ok: true, revisedText });
  } catch (error) {
    return jsonResponse({ ok: false, error: readableError(error) }, 500);
  }
}

async function callChatCompletions({
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
  const response = await fetchImpl(OPENROUTER_CHAT_COMPLETIONS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      provider: { require_parameters: true },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "moons_idea_preflight_fix",
          strict: true,
          schema: fixSchema
        }
      }
    })
  });

  if (!response.ok) {
    const detail = await readProviderErrorDetail(response);
    throw new Error(
      `OpenRouter idea preflight fix failed: ${response.status}${detail ? ` — ${detail}` : ""}`
    );
  }

  return readJsonResponse(response, "OpenRouter idea preflight fix");
}

function buildPrompt(input: IdeaPreflightFixRequest): string {
  const fieldLabel = FIELD_LABELS[input.field];
  return [
    "คุณคือ Copy Editor มืออาชีพ หน้าที่เดียวของคุณคือแก้ไข field เดียวของไอเดียโฆษณาให้ตรงกับปัญหาที่ QA ชี้ไว้เท่านั้น",
    "",
    "กฎเคร่งครัด ห้ามฝ่าฝืน:",
    "1. แก้เฉพาะสิ่งที่จำเป็นเพื่อแก้ปัญหาที่ระบุไว้ด้านล่างเท่านั้น ห้ามเปลี่ยน Key Message มุมมอง หรือแต่งไอเดียใหม่",
    "2. คงโทนเสียง ความยาวโดยประมาณ และข้อมูลอื่นที่ไม่เกี่ยวกับปัญหานี้ไว้ให้มากที่สุด",
    "3. ห้ามเพิ่มข้อเท็จจริง ราคา โปรโมชั่น หรือคำกล่าวอ้างใหม่ที่ไม่มีอยู่แล้วในข้อความเดิมหรือบริบทที่ให้มา",
    "4. ห้ามแก้ field อื่นนอกจากที่ระบุ ใช้ field อื่นเป็นบริบทเพื่อความเข้าใจเท่านั้น",
    "5. ถ้าข้อความปัจจุบันไม่มีปัญหาตามที่ระบุจริง ให้คืนข้อความเดิมโดยไม่เปลี่ยนแปลง",
    "6. ตรวจสอบผลลัพธ์ของตัวเองก่อนตอบว่าแก้ปัญหาที่ระบุได้จริง และไม่ขัดกับ Brand policy ที่ให้มา",
    "",
    `Field ที่ต้องแก้: ${fieldLabel}`,
    `ข้อความปัจจุบันของ field นี้: ${input.direction[input.field]}`,
    "",
    "บริบทอื่นของไอเดียเดียวกัน (ใช้เพื่อความเข้าใจบริบทเท่านั้น ห้ามแก้):",
    `Hook: ${input.direction.hook}`,
    `Subheadline: ${input.direction.subheadline}`,
    `Concept: ${input.direction.concept}`,
    `Visual direction: ${input.direction.visual}`,
    `CTA: ${input.direction.cta}`,
    `Caption: ${input.direction.caption}`,
    "",
    `ปัญหาที่ต้องแก้ (${input.check}): ${input.message}`,
    input.suggestion
      ? `แนวทางที่ QA แนะนำ: ${input.suggestion}`
      : "QA ไม่ได้ให้แนวทางที่ชัดเจน ให้คุณตัดสินใจเองตามปัญหาที่ระบุ",
    input.instructions.trim()
      ? `คำแนะนำเพิ่มเติมจากผู้ใช้ (ให้ความสำคัญสูงสุด ถ้าขัดกับแนวทางของ QA ให้ทำตามผู้ใช้): ${input.instructions.trim()}`
      : "",
    "",
    input.brandPolicies.length
      ? `Brand policy ที่ต้องไม่ขัด:\n${input.brandPolicies.map((policy) => `- ${policy}`).join("\n")}`
      : "",
    input.brandAvoid.length
      ? `สิ่งที่แบรนด์นี้ต้องหลีกเลี่ยง:\n${input.brandAvoid.map((avoid) => `- ${avoid}`).join("\n")}`
      : "",
    "",
    `คืนเฉพาะข้อความ ${fieldLabel} ที่แก้แล้วเท่านั้น เป็นข้อความล้วน ไม่ใส่คำอธิบาย ไม่ใส่เครื่องหมายคำพูดครอบ ไม่ใส่ JSON`
  ]
    .filter(Boolean)
    .join("\n");
}

const fixSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    revisedText: { type: "string" }
  },
  required: ["revisedText"]
} as const;

function parseRevisedText(text: string): string {
  const parsed = JSON.parse(text) as unknown;
  const record = readRecord(parsed, "idea preflight fix payload");
  const revisedText = readString(record.revisedText, "revisedText").trim();
  if (!revisedText) {
    throw new Error("OpenRouter idea preflight fix returned an empty result.");
  }
  return revisedText;
}

function parseRequestBody(value: unknown): IdeaPreflightFixRequest {
  const record = readRecord(value, "idea preflight fix request");
  const field = readString(record.field, "field");
  if (!FIXABLE_FIELDS.has(field as FixableField)) {
    throw new Error("field is invalid.");
  }
  const check = readString(record.check, "check");
  if (!CHECK_IDS.has(check as CheckId)) {
    throw new Error("check is invalid.");
  }
  const direction = readRecord(record.direction, "direction");

  return {
    field: field as FixableField,
    check: check as CheckId,
    message: readString(record.message, "message"),
    suggestion: readNullableString(record.suggestion, "suggestion"),
    instructions:
      record.instructions === undefined
        ? ""
        : readString(record.instructions, "instructions"),
    direction: {
      hook: readString(direction.hook, "direction.hook"),
      subheadline: readString(direction.subheadline, "direction.subheadline"),
      concept: readString(direction.concept, "direction.concept"),
      visual: readString(direction.visual, "direction.visual"),
      cta: readString(direction.cta, "direction.cta"),
      caption: readString(direction.caption, "direction.caption")
    },
    brandPolicies:
      record.brandPolicies === undefined
        ? []
        : readStringArray(record.brandPolicies, "brandPolicies"),
    brandAvoid:
      record.brandAvoid === undefined
        ? []
        : readStringArray(record.brandAvoid, "brandAvoid")
  };
}

function readStringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  return value.map((item, index) => readString(item, `${field}[${index}]`));
}

function extractResponseText(payload: unknown): string {
  if (isRecord(payload) && Array.isArray(payload.choices)) {
    for (const choice of payload.choices) {
      if (!isRecord(choice) || !isRecord(choice.message)) continue;
      if (typeof choice.message.content === "string") {
        return choice.message.content;
      }
    }
  }
  throw new Error(
    "OpenRouter idea preflight fix response did not include output text."
  );
}

async function readProviderErrorDetail(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as unknown;
    if (!isRecord(payload)) return "";
    const error = isRecord(payload.error) ? payload.error : null;
    return typeof error?.message === "string" ? error.message : "";
  } catch {
    return "";
  }
}

async function readJsonResponse(
  response: Response,
  label: string
): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) throw new Error(`${label} returned an empty response body.`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} returned a non-JSON response.`);
  }
}

function readRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  return value;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  return value;
}

function readNullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`${field} must be a string or null.`);
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
  return error instanceof Error ? error.message : "Unknown idea preflight fix error.";
}
