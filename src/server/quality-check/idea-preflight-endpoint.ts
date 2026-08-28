import { resolveConvertCakeAuthorization } from "../shared/convert-cake-auth.js";

type FetchLike = typeof fetch;
type CheckId = "quality" | "spelling" | "policy";

export interface IdeaPreflightEndpointEnv {
  OPENAI_API_KEY?: string;
  OPENAI_IDEA_PREFLIGHT_MODEL?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

export interface IdeaPreflightEndpointOptions {
  request: Request;
  env: IdeaPreflightEndpointEnv;
  fetchImpl?: FetchLike;
}

interface IdeaPreflightRequest {
  runId: string;
  brief: string;
  brandContext: {
    name: string;
    category: string;
    policies: readonly string[];
    products: readonly string[];
    documents: readonly string[];
    working: readonly string[];
    avoid: readonly string[];
  } | null;
  checks: readonly CheckId[];
  directions: readonly {
    id: string;
    service: string;
    hook: string;
    subheadline: string;
    concept: string;
    visual: string;
    cta: string;
    caption: string;
    formatBeats: readonly string[];
    revisionFeedback: string;
  }[];
}

const DEFAULT_MODEL = "gpt-5.6-luna";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const CHECK_IDS = new Set<CheckId>(["quality", "spelling", "policy"]);

export async function handleIdeaPreflightRequest({
  request,
  env,
  fetchImpl = fetch
}: IdeaPreflightEndpointOptions): Promise<Response> {
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
    if (!input.directions.length) {
      return jsonResponse({ ok: true, results: [] });
    }
    if (!input.checks.length) {
      return jsonResponse(
        { ok: false, error: "Choose at least one check." },
        400
      );
    }

    const model = env.OPENAI_IDEA_PREFLIGHT_MODEL?.trim() || DEFAULT_MODEL;
    const payload = await callResponsesApi({
      apiKey,
      model,
      fetchImpl,
      prompt: buildPrompt(input)
    });
    const results = parseResults(
      extractResponseText(payload),
      input.directions.map((direction) => direction.id),
      new Set(input.checks)
    );

    return jsonResponse({ ok: true, model, results });
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
          name: "moons_idea_preflight",
          strict: true,
          schema: resultsSchema
        }
      }
    })
  });

  if (!response.ok) {
    const detail = await readProviderErrorDetail(response);
    throw new Error(
      `GPT Luna idea preflight failed: ${response.status}${detail ? ` — ${detail}` : ""}`
    );
  }

  return readJsonResponse(response, "GPT Luna idea preflight");
}

function buildPrompt(input: IdeaPreflightRequest): string {
  const enabled = new Set(input.checks);
  return [
    "คุณคือ Creative Strategist และ Copy QA สำหรับตรวจ creative idea ก่อนสร้าง artwork",
    "ตรวจเฉพาะหลักฐานที่ให้มา ห้ามอ้างว่าเห็น final artwork เพราะขั้นตอนนี้มีเพียง hook, caption, concept และ visual direction",
    "คืนเฉพาะปัญหาที่ต้องแก้จริง ข้อความ finding ต้องสั้น ชัด และระบุวิธีแก้ได้ในประโยคเดียว",
    "ถ้าไม่พบปัญหา ให้ findings เป็น array ว่างสำหรับ idea นั้น",
    "",
    enabled.has("quality")
      ? [
          "QUALITY — ตรวจครบทุกข้อ:",
          "1. Key Message ชัดและตรง Brief / Objective",
          "2. Visual direction, Hook และ Caption สื่อสารไปในทิศทางเดียวกัน",
          "3. ราคา โปรโมชั่น เคลม รายละเอียดสินค้า และ CTA ไม่ขัดกับ confirmed context",
          "4. งานตรง Client Context และข้อมูลแก้ไขที่ให้มา",
          "ห้าม fail เพราะ context ไม่มีข้อมูลสำหรับเปรียบเทียบ ให้ flag เฉพาะความขัดแย้งที่พิสูจน์ได้"
        ].join("\n")
      : "QUALITY — disabled; ห้ามคืน finding ประเภท quality",
    "",
    enabled.has("spelling")
      ? [
          "SPELLING — ตรวจ Hook, Subheadline, Caption, CTA และ Format beats:",
          "- ตรวจเฉพาะคำสะกดผิดจริง คำเพี้ยน อักขระภาษาไทยเสีย หรือคำซ้ำโดยไม่ตั้งใจ",
          "- ตรวจการเว้นวรรคภาษาไทยผิดตำแหน่งเฉพาะเมื่อทำให้คำผิดหรือความหมายเปลี่ยน",
          "- ห้ามรายงานเรื่องเครื่องหมายวรรคตอน จุด bullet ช่องว่าง การขึ้นบรรทัด การแบ่งย่อหน้า หรือรูปแบบการจัดข้อความ",
          "- จุดหรือ bullet ที่อยู่เดี่ยวจากการขึ้นบรรทัดถือเป็น formatting และต้องเพิกเฉย"
        ].join("\n")
      : "SPELLING — disabled; ห้ามคืน finding ประเภท spelling",
    "",
    enabled.has("policy")
      ? [
          "POLICY — ตรวจความเสี่ยงจากคำรับประกันผลลัพธ์ คำกล่าวอ้างเด็ดขาด การเป็นอันดับหนึ่ง และ superlative ที่ไม่มีหลักฐาน",
          "ถ้าหลักฐานยังไม่พอ ให้เสนอถ้อยคำที่ปลอดภัยกว่า",
          "ตรวจตาม Brand-specific policy ต่อไปนี้เป็นข้อกำหนดเพิ่มเติมด้วย และ flag เฉพาะการฝ่าฝืนที่พิสูจน์ได้จากข้อความของ idea:",
          ...(input.brandContext?.policies.length
            ? input.brandContext.policies.map((policy) => `- ${policy}`)
            : ["- No brand-specific policy supplied."])
        ].join("\n")
      : "POLICY — disabled; ห้ามคืน finding ประเภท policy",
    "",
    `Run ID: ${input.runId}`,
    `Brief: ${input.brief}`,
    `Confirmed context:\n${formatBrandContext(input.brandContext)}`,
    "",
    "Ideas:",
    ...input.directions.map((direction, index) =>
      [
        `${index + 1}. directionId: ${direction.id}`,
        `Service: ${direction.service}`,
        `Hook: ${direction.hook}`,
        `Subheadline: ${direction.subheadline}`,
        `Concept: ${direction.concept}`,
        `Visual direction: ${direction.visual}`,
        `CTA: ${direction.cta}`,
        `Caption: ${direction.caption}`,
        `Format beats: ${direction.formatBeats.join(" | ")}`,
        `Revision feedback: ${direction.revisionFeedback || "None"}`
      ].join("\n")
    ),
    "",
    "ตอบ directionId ให้ครบและตรงกับทุก idea ตามลำดับ Return only JSON ตาม schema."
  ].join("\n");
}

function formatBrandContext(
  context: IdeaPreflightRequest["brandContext"]
): string {
  if (!context) return "No brand context supplied.";
  return [
    `Brand: ${context.name}`,
    `Category: ${context.category}`,
    `Products: ${context.products.join("\n- ") || "None"}`,
    `Documents: ${context.documents.join("\n- ") || "None"}`,
    `Working signals: ${context.working.join("\n- ") || "None"}`,
    `Avoid signals: ${context.avoid.join("\n- ") || "None"}`
  ].join("\n");
}

const resultsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          directionId: { type: "string" },
          findings: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                check: {
                  type: "string",
                  enum: ["quality", "spelling", "policy"]
                },
                message: { type: "string" }
              },
              required: ["check", "message"]
            }
          }
        },
        required: ["directionId", "findings"]
      }
    }
  },
  required: ["results"]
} as const;

function parseResults(
  text: string,
  expectedIds: readonly string[],
  enabledChecks: ReadonlySet<CheckId>
) {
  const parsed = JSON.parse(text) as unknown;
  const record = readRecord(parsed, "idea preflight payload");
  if (!Array.isArray(record.results)) {
    throw new Error("results must be an array.");
  }

  const expected = new Set(expectedIds);
  const seen = new Set<string>();
  const results = record.results.map((item, index) => {
    const result = readRecord(item, `results[${index}]`);
    const directionId = readString(
      result.directionId,
      `results[${index}].directionId`
    );
    if (!expected.has(directionId) || seen.has(directionId)) {
      throw new Error(`results[${index}].directionId is invalid.`);
    }
    seen.add(directionId);
    if (!Array.isArray(result.findings)) {
      throw new Error(`results[${index}].findings must be an array.`);
    }

    const findings = result.findings.map((itemFinding, findingIndex) => {
      const finding = readRecord(
        itemFinding,
        `results[${index}].findings[${findingIndex}]`
      );
      const check = readString(
        finding.check,
        `results[${index}].findings[${findingIndex}].check`
      );
      if (
        !CHECK_IDS.has(check as CheckId) ||
        !enabledChecks.has(check as CheckId)
      ) {
        throw new Error(
          `results[${index}].findings[${findingIndex}].check is invalid.`
        );
      }
      return {
        check: check as CheckId,
        message: readString(
          finding.message,
          `results[${index}].findings[${findingIndex}].message`
        )
      };
    });

    return {
      directionId,
      findings: findings.filter(
        (finding) => !isFormattingOnlyFinding(finding)
      )
    };
  });

  if (seen.size !== expected.size) {
    throw new Error("GPT Luna did not return every requested idea.");
  }
  return results;
}

function isFormattingOnlyFinding(finding: {
  check: CheckId;
  message: string;
}): boolean {
  if (finding.check !== "spelling") return false;

  return /(?:เครื่องหมายวรรคตอน|จุด\s*[“"'.]?\.|bullet|บูลเล็ต|อักขระหลงเหลือ|ขึ้นบรรทัด|เว้นบรรทัด|แบ่งย่อหน้า|ย่อหน้า|line[\s-]?break|new[\s-]?line|punctuation|formatting)/iu.test(
    finding.message
  );
}

function parseRequestBody(value: unknown): IdeaPreflightRequest {
  const record = readRecord(value, "idea preflight request");
  if (!Array.isArray(record.checks)) throw new Error("checks must be an array.");
  if (!Array.isArray(record.directions)) {
    throw new Error("directions must be an array.");
  }

  const checks = record.checks.map((valueCheck, index) => {
    if (typeof valueCheck !== "string" || !CHECK_IDS.has(valueCheck as CheckId)) {
      throw new Error(`checks[${index}] is invalid.`);
    }
    return valueCheck as CheckId;
  });

  return {
    runId: readString(record.runId, "runId"),
    brief: readString(record.brief, "brief"),
    brandContext:
      record.brandContext === null
        ? null
        : parseBrandContext(record.brandContext),
    checks,
    directions: record.directions.map((item, index) => {
      const direction = readRecord(item, `directions[${index}]`);
      if (!Array.isArray(direction.formatBeats)) {
        throw new Error(`directions[${index}].formatBeats must be an array.`);
      }
      return {
        id: readString(direction.id, `directions[${index}].id`),
        service: readString(
          direction.service,
          `directions[${index}].service`
        ),
        hook: readString(direction.hook, `directions[${index}].hook`),
        subheadline: readString(
          direction.subheadline,
          `directions[${index}].subheadline`
        ),
        concept: readString(direction.concept, `directions[${index}].concept`),
        visual: readString(direction.visual, `directions[${index}].visual`),
        cta: readString(direction.cta, `directions[${index}].cta`),
        caption: readString(direction.caption, `directions[${index}].caption`),
        formatBeats: direction.formatBeats.map((beat, beatIndex) =>
          readString(
            beat,
            `directions[${index}].formatBeats[${beatIndex}]`
          )
        ),
        revisionFeedback: readString(
          direction.revisionFeedback,
          `directions[${index}].revisionFeedback`
        )
      };
    })
  };
}

function parseBrandContext(
  value: unknown
): NonNullable<IdeaPreflightRequest["brandContext"]> {
  const context = readRecord(value, "brandContext");
  return {
    name: readString(context.name, "brandContext.name"),
    category: readString(context.category, "brandContext.category"),
    policies:
      context.policies === undefined
        ? []
        : readStringArray(context.policies, "brandContext.policies"),
    products: readStringArray(context.products, "brandContext.products"),
    documents: readStringArray(context.documents, "brandContext.documents"),
    working: readStringArray(context.working, "brandContext.working"),
    avoid: readStringArray(context.avoid, "brandContext.avoid")
  };
}

function readStringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  return value.map((item, index) => readString(item, `${field}[${index}]`));
}

function extractResponseText(payload: unknown): string {
  if (isRecord(payload) && typeof payload.output_text === "string") {
    return payload.output_text;
  }
  if (!isRecord(payload) || !Array.isArray(payload.output)) {
    throw new Error(
      "GPT Luna idea preflight response did not include output text."
    );
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
  throw new Error("GPT Luna idea preflight response did not include output text.");
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
  return error instanceof Error ? error.message : "Unknown idea preflight error.";
}
