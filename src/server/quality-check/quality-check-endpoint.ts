import { resolveConvertCakeAuthorization } from "../shared/convert-cake-auth.js";

type FetchLike = typeof fetch;

type ResponseContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "auto" };

export interface QualityCheckEndpointEnv {
  OPENAI_API_KEY?: string;
  OPENAI_QUALITY_CHECK_MODEL?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

export interface QualityCheckEndpointOptions {
  request: Request;
  env: QualityCheckEndpointEnv;
  fetchImpl?: FetchLike;
}

interface QualityCheckOutputInput {
  id: string;
  hook: string;
  concept: string;
  visual: string;
  assetUrl: string;
}

interface QualityCheckRequest {
  runId: string;
  brief: string;
  outputs: readonly QualityCheckOutputInput[];
}

interface QualityCheckResult {
  outputId: string;
  passed: boolean;
  reason: string;
}

const DEFAULT_MODEL = "gpt-5.6-terra";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

export async function handleQualityCheckRequest({
  request,
  env,
  fetchImpl = fetch
}: QualityCheckEndpointOptions): Promise<Response> {
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
    if (!input.outputs.length) {
      return jsonResponse({ ok: true, results: [] });
    }

    const model = env.OPENAI_QUALITY_CHECK_MODEL?.trim() || DEFAULT_MODEL;
    const payload = await callResponsesApi({
      apiKey,
      model,
      fetchImpl,
      content: buildContent(input)
    });
    const results = parseResults(extractResponseText(payload), input.outputs);

    return jsonResponse({ ok: true, results });
  } catch (error) {
    return jsonResponse({ ok: false, error: readableError(error) }, 500);
  }
}

async function callResponsesApi({
  apiKey,
  model,
  fetchImpl,
  content
}: {
  apiKey: string;
  model: string;
  fetchImpl: FetchLike;
  content: readonly ResponseContent[];
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
      input: [{ role: "user", content }],
      text: {
        format: {
          type: "json_schema",
          name: "moons_quality_check",
          strict: true,
          schema: resultsSchema
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI quality check failed: ${response.status}`);
  }

  return readJsonResponse(response, "OpenAI quality check");
}

function buildContent(
  input: QualityCheckRequest
): readonly ResponseContent[] {
  const content: ResponseContent[] = [
    {
      type: "input_text",
      text: [
        "คุณคือ QA reviewer สำหรับ creative โฆษณา ตรวจสอบภาพที่สร้างจริงแต่ละภาพเทียบกับ hook, concept, visual direction และ brief",
        "",
        "ตรวจสอบเฉพาะสิ่งที่เห็นได้จริงในภาพ:",
        "- ข้อความในภาพอ่านไม่ออก ตัวอักษรบิดเบี้ยว หรือปะปนกันจนอ่านไม่รู้เรื่อง",
        "- เนื้อหาที่ไม่ปลอดภัยต่อแบรนด์ (ไม่เหมาะสม, สร้างความเข้าใจผิด)",
        "- ภาพไม่ตรงกับ visual direction หรือ concept ที่ระบุไว้อย่างชัดเจน",
        "",
        "ห้ามตัดสินจากรสนิยมส่วนตัวหรือความชอบ ตัดสินเฉพาะปัญหาที่ชัดเจนและระบุได้",
        "ถ้าภาพไม่มีปัญหาที่ชัดเจน ให้ passed เป็น true",
        "",
        `Brief: ${input.brief}`,
        "",
        "แต่ละภาพจะมี outputId กำกับไว้ ให้ตอบกลับด้วย outputId เดียวกันทุกรายการ"
      ].join("\n")
    }
  ];

  for (const output of input.outputs) {
    content.push({
      type: "input_text",
      text: [
        `outputId: ${output.id}`,
        `Hook: ${output.hook}`,
        `Concept: ${output.concept}`,
        `Visual direction: ${output.visual}`
      ].join("\n")
    });
    content.push({
      type: "input_image",
      image_url: output.assetUrl,
      detail: "auto"
    });
  }

  content.push({ type: "input_text", text: "Return only JSON ตาม schema." });

  return content;
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
          outputId: { type: "string" },
          passed: { type: "boolean" },
          reason: { type: "string" }
        },
        required: ["outputId", "passed", "reason"]
      }
    }
  },
  required: ["results"]
} as const;

function parseResults(
  text: string,
  outputs: readonly QualityCheckOutputInput[]
): readonly QualityCheckResult[] {
  const parsed = JSON.parse(text) as unknown;
  const value = readRecord(parsed, "quality check payload");
  if (!Array.isArray(value.results)) {
    throw new Error("results must be an array.");
  }

  const validIds = new Set(outputs.map((output) => output.id));
  return value.results
    .map((item, index) => {
      const record = readRecord(item, `results[${index}]`);
      return {
        outputId: readString(record.outputId, `results[${index}].outputId`),
        passed: readBoolean(record.passed, `results[${index}].passed`),
        reason: readString(record.reason, `results[${index}].reason`)
      };
    })
    .filter((result) => validIds.has(result.outputId));
}

function parseRequestBody(value: unknown): QualityCheckRequest {
  if (!isRecord(value)) throw new Error("Invalid quality check request.");

  const runId = readString(value.runId, "runId");
  const brief = readString(value.brief, "brief");
  if (!Array.isArray(value.outputs)) {
    throw new Error("outputs must be an array.");
  }

  return {
    runId,
    brief,
    outputs: value.outputs.map((item, index) => {
      const record = readRecord(item, `outputs[${index}]`);
      return {
        id: readString(record.id, `outputs[${index}].id`),
        hook: readString(record.hook, `outputs[${index}].hook`),
        concept: readString(record.concept, `outputs[${index}].concept`),
        visual: readString(record.visual, `outputs[${index}].visual`),
        assetUrl: readString(record.assetUrl, `outputs[${index}].assetUrl`)
      };
    })
  };
}

function extractResponseText(payload: unknown): string {
  if (isRecord(payload) && typeof payload.output_text === "string") {
    return payload.output_text;
  }

  if (!isRecord(payload) || !Array.isArray(payload.output)) {
    throw new Error("OpenAI quality check response did not include output text.");
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

  throw new Error("OpenAI quality check response did not include output text.");
}

function readRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  return value;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  return value;
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean.`);
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
    : "Unknown quality check error.";
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
