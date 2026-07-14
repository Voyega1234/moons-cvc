import { resolveConvertCakeAuthorization } from "../shared/convert-cake-auth.js";
import {
  CS_QUALITY_CHECKLIST,
  GD_QUALITY_CHECKLIST
} from "../../domain/quality-check.js";

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
  subheadline: string;
  concept: string;
  visual: string;
  cta: string;
  caption: string;
  revisionFeedback: string;
  assetUrl: string;
}

interface QualityCheckBrandContext {
  name: string;
  category: string;
  brandKit: readonly string[];
  products: readonly string[];
  documents: readonly string[];
  working: readonly string[];
  avoid: readonly string[];
}

interface QualityCheckReferenceImage {
  label: string;
  url: string;
  kind: "brand-kit" | "creative-reference";
}

interface QualityCheckRequest {
  runId: string;
  brief: string;
  brandContext: QualityCheckBrandContext | null;
  referenceImages: readonly QualityCheckReferenceImage[];
  outputs: readonly QualityCheckOutputInput[];
}

interface QualityCheckResult {
  outputId: string;
  gdPassed: boolean;
  gdReason: string;
  csPassed: boolean;
  csReason: string;
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
      content: await buildContent(input, fetchImpl)
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
    const detail = await readProviderErrorDetail(response);
    throw new Error(
      `OpenAI quality check failed: ${response.status}${detail ? ` — ${detail}` : ""}`
    );
  }

  return readJsonResponse(response, "OpenAI quality check");
}

async function buildContent(
  input: QualityCheckRequest,
  fetchImpl: FetchLike
): Promise<readonly ResponseContent[]> {
  const content: ResponseContent[] = [
    {
      type: "input_text",
      text: [
        "คุณคือ Quality Agent สำหรับตรวจ Creative โฆษณา ให้ตรวจภาพจริงทุกชิ้นตาม GD Checklist และ CS Checklist ด้านล่าง",
        "",
        "GD Checklist",
        ...GD_QUALITY_CHECKLIST.map((item) => `- ${item}`),
        "",
        "CS Checklist",
        ...CS_QUALITY_CHECKLIST.map((item) => `- ${item}`),
        "",
        "กติกาการตรวจ:",
        "- ตรวจ GD จากองค์ประกอบ ลำดับสายตา ความประณีต ความสมจริงของภาพ Gen AI และความถูกต้องของสิ่งที่เทียบได้กับ Brand Context/Reference Images",
        "- ตรวจ CS โดยเทียบ Artwork, Hook, Subheadline, Concept, CTA และ Caption กับ Brief / Objective / Client Context / Revision Feedback",
        "- ถ้ามี Mockup หรือ Reference Image ให้ตรวจว่างาน Final พัฒนาต่อและไม่ดูแบนหรือเป็น Template เกินไป ถ้าไม่มีหลักฐานเปรียบเทียบ ห้ามตัดสินตกเฉพาะข้อนี้",
        "- ตรวจ Logo, Brand CI, ชื่อแบรนด์/สินค้า ราคา โปรโมชัน และรายละเอียดจากข้อมูลที่ให้มาเท่านั้น ห้ามเดาหรือสร้างข้อเท็จจริงเพิ่ม",
        "- ถ้าไม่มี Revision Feedback ให้ถือว่าข้อ Revision ผ่านโดยไม่มีสิ่งให้เทียบ",
        "- ระบุปัญหาที่เห็นและวิธีแก้แบบสั้น ชัดเจน ห้ามใช้รสนิยมส่วนตัวที่ไม่มีหลักฐาน",
        "- gdPassed ต้องเป็น true เมื่อไม่มีปัญหา GD ที่พิสูจน์ได้ และ csPassed ต้องเป็น true เมื่อไม่มีปัญหา CS ที่พิสูจน์ได้",
        "",
        `Brief: ${input.brief}`,
        `Brand Context:\n${formatBrandContext(input.brandContext)}`,
        "",
        "แต่ละภาพจะมี outputId กำกับไว้ ให้ตอบกลับด้วย outputId เดียวกันทุกรายการ"
      ].join("\n")
    }
  ];

  for (const reference of input.referenceImages) {
    const imageUrl = await resolveOptionalReferenceImageUrlForVision(
      reference.url,
      reference.label,
      fetchImpl
    );
    content.push({
      type: "input_text",
      text: imageUrl
        ? `Reference Image (${reference.kind}) — ${reference.label}. ใช้เพื่อเปรียบเทียบเท่านั้น ไม่ใช่ Artwork ที่ต้องให้คะแนน`
        : `Reference Image (${reference.kind}) — ${reference.label}. ข้ามภาพนี้เพราะ backend ดาวน์โหลดไม่ได้ ให้ตรวจต่อจาก references อื่นและข้อมูลที่มี ห้าม fail งานเพราะ reference นี้หาย`
    });
    if (imageUrl) {
      content.push({
        type: "input_image",
        image_url: imageUrl,
        detail: "auto"
      });
    }
  }

  for (const output of input.outputs) {
    content.push({
      type: "input_text",
      text: [
        `outputId: ${output.id}`,
        `Hook: ${output.hook}`,
        `Subheadline: ${output.subheadline}`,
        `Concept: ${output.concept}`,
        `Visual direction: ${output.visual}`,
        `CTA: ${output.cta}`,
        `Caption: ${output.caption}`,
        `Revision Feedback: ${output.revisionFeedback || "ไม่มี"}`
      ].join("\n")
    });
    content.push({
      type: "input_image",
      image_url: await resolveImageUrlForVision(
        output.assetUrl,
        `creative "${output.id}"`,
        fetchImpl
      ),
      detail: "auto"
    });
  }

  content.push({ type: "input_text", text: "Return only JSON ตาม schema." });

  return content;
}

async function resolveOptionalReferenceImageUrlForVision(
  url: string,
  label: string,
  fetchImpl: FetchLike
): Promise<string | null> {
  try {
    return await resolveImageUrlForVision(
      url,
      `reference image "${label}"`,
      fetchImpl
    );
  } catch {
    return null;
  }
}

async function resolveImageUrlForVision(
  url: string,
  label: string,
  fetchImpl: FetchLike
): Promise<string> {
  if (url.startsWith("data:")) return url;

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Could not download ${label}: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "image/png";
  if (!contentType.startsWith("image/")) {
    throw new Error(
      `Could not use ${label}: expected image content, got ${contentType}.`
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  return `data:${contentType};base64,${bytes.toString("base64")}`;
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
          gdPassed: { type: "boolean" },
          gdReason: { type: "string" },
          csPassed: { type: "boolean" },
          csReason: { type: "string" }
        },
        required: [
          "outputId",
          "gdPassed",
          "gdReason",
          "csPassed",
          "csReason"
        ]
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
      const gdPassed = readBoolean(
        record.gdPassed,
        `results[${index}].gdPassed`
      );
      const gdReason = readString(
        record.gdReason,
        `results[${index}].gdReason`
      );
      const csPassed = readBoolean(
        record.csPassed,
        `results[${index}].csPassed`
      );
      const csReason = readString(
        record.csReason,
        `results[${index}].csReason`
      );
      return {
        outputId: readString(record.outputId, `results[${index}].outputId`),
        gdPassed,
        gdReason,
        csPassed,
        csReason,
        passed: gdPassed && csPassed,
        reason: [
          `GD ${gdPassed ? "ผ่าน" : "ต้องแก้"}: ${gdReason}`,
          `CS ${csPassed ? "ผ่าน" : "ต้องแก้"}: ${csReason}`
        ].join("\n")
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
    brandContext: parseBrandContext(value.brandContext),
    referenceImages: parseReferenceImages(value.referenceImages),
    outputs: value.outputs.map((item, index) => {
      const record = readRecord(item, `outputs[${index}]`);
      return {
        id: readString(record.id, `outputs[${index}].id`),
        hook: readString(record.hook, `outputs[${index}].hook`),
        subheadline: readOptionalString(record.subheadline),
        concept: readString(record.concept, `outputs[${index}].concept`),
        visual: readString(record.visual, `outputs[${index}].visual`),
        cta: readOptionalString(record.cta),
        caption: readOptionalString(record.caption),
        revisionFeedback: readOptionalString(record.revisionFeedback),
        assetUrl: readString(record.assetUrl, `outputs[${index}].assetUrl`)
      };
    })
  };
}

function formatBrandContext(context: QualityCheckBrandContext | null): string {
  if (!context) return "ไม่มี Brand Context";

  return [
    `Brand: ${context.name}`,
    `Category: ${context.category}`,
    `Brand kit: ${formatList(context.brandKit)}`,
    `Products: ${formatList(context.products)}`,
    `Client documents: ${formatList(context.documents)}`,
    `What works: ${formatList(context.working)}`,
    `Avoid: ${formatList(context.avoid)}`
  ].join("\n");
}

function formatList(items: readonly string[]): string {
  return items.length ? items.join(" | ") : "ไม่มีข้อมูล";
}

function parseBrandContext(value: unknown): QualityCheckBrandContext | null {
  if (value === undefined || value === null) return null;
  const record = readRecord(value, "brandContext");
  return {
    name: readOptionalString(record.name),
    category: readOptionalString(record.category),
    brandKit: readStringArray(record.brandKit, "brandContext.brandKit"),
    products: readStringArray(record.products, "brandContext.products"),
    documents: readStringArray(record.documents, "brandContext.documents"),
    working: readStringArray(record.working, "brandContext.working"),
    avoid: readStringArray(record.avoid, "brandContext.avoid")
  };
}

function parseReferenceImages(
  value: unknown
): readonly QualityCheckReferenceImage[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("referenceImages must be an array.");

  return value.map((item, index) => {
    const record = readRecord(item, `referenceImages[${index}]`);
    const kind = readString(record.kind, `referenceImages[${index}].kind`);
    if (kind !== "brand-kit" && kind !== "creative-reference") {
      throw new Error(`referenceImages[${index}].kind is invalid.`);
    }
    return {
      label: readString(record.label, `referenceImages[${index}].label`),
      url: readString(record.url, `referenceImages[${index}].url`),
      kind
    };
  });
}

function readStringArray(value: unknown, field: string): readonly string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  return value.map((item, index) => readString(item, `${field}[${index}]`));
}

function readOptionalString(value: unknown): string {
  return typeof value === "string" ? value : "";
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
      } else if (
        isRecord(payload.error) &&
        typeof payload.error.message === "string"
      ) {
        detail = payload.error.message;
      }
    }
  } catch {
    // Plain-text provider errors are already safe to summarize below.
  }

  return detail.replace(/\s+/g, " ").trim().slice(0, 300);
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
