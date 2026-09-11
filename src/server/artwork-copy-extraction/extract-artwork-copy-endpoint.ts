import { resolveConvertCakeAuthorization } from "../shared/convert-cake-auth.js";
import { openRouterTraceEnvironment } from "../shared/openrouter-trace.js";

type FetchLike = typeof fetch;

type ResponseContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "auto" };

export interface ExtractArtworkCopyEndpointEnv {
  OPENROUTER_API_KEY?: string;
  OPENROUTER_QUALITY_CHECK_MODEL?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

export interface ExtractArtworkCopyEndpointOptions {
  request: Request;
  env: ExtractArtworkCopyEndpointEnv;
  fetchImpl?: FetchLike;
}

interface ExtractArtworkCopyOutputInput {
  id: string;
  assetUrl: string;
}

interface ExtractArtworkCopyRequest {
  outputs: readonly ExtractArtworkCopyOutputInput[];
}

export interface ExtractedArtworkCopy {
  outputId: string;
  headline: string;
  keyMessage: readonly string[];
  cta: string;
  footer: string;
}

const OPENROUTER_RESPONSES_ENDPOINT = "https://openrouter.ai/api/v1/responses";

export async function handleExtractArtworkCopyRequest({
  request,
  env,
  fetchImpl = fetch
}: ExtractArtworkCopyEndpointOptions): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  try {
    const apiKey = env.OPENROUTER_API_KEY?.trim();
    const model = env.OPENROUTER_QUALITY_CHECK_MODEL?.trim();
    if (!apiKey || !model) {
      return jsonResponse(
        {
          ok: false,
          error: "OPENROUTER_API_KEY and OPENROUTER_QUALITY_CHECK_MODEL are required."
        },
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
  const response = await fetchImpl(OPENROUTER_RESPONSES_ENDPOINT, {
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
          name: "moons_artwork_copy_extraction",
          strict: true,
          schema: resultsSchema
        }
      },
      trace: {
        trace_name: "moons_artwork_copy_extraction",
        generation_name: "moons_artwork_copy_extraction",
        feature: "artwork-copy-extraction",
        environment: openRouterTraceEnvironment()
      }
    })
  });

  if (!response.ok) {
    const detail = await readProviderErrorDetail(response);
    throw new Error(
      `OpenRouter artwork copy extraction failed: ${response.status}${detail ? ` — ${detail}` : ""}`
    );
  }

  return readJsonResponse(response, "OpenRouter artwork copy extraction");
}

async function buildContent(
  input: ExtractArtworkCopyRequest,
  fetchImpl: FetchLike
): Promise<readonly ResponseContent[]> {
  const content: ResponseContent[] = [
    {
      type: "input_text",
      text: [
        "คุณคือระบบอ่านข้อความบนภาพโฆษณา (transcription เท่านั้น ไม่ใช่ QA และไม่ใช่ copywriter)",
        "หน้าที่เดียว: อ่านตัวอักษรทุกตัวที่ปรากฏจริงบนภาพแต่ละภาพ แล้วจัดเข้าหมวดตามตำแหน่ง/บทบาทที่เห็น",
        "",
        "กติกา:",
        "- transcribe คำต่อคำตามที่เห็นบนภาพเป๊ะ ๆ ห้ามแปล ห้ามสรุป ห้ามแก้คำ ห้ามเติมคำที่ไม่เห็น",
        "- headline: ข้อความหลักที่ใหญ่/เด่นที่สุดบนภาพ (ปกติอยู่บนสุดหรือกลางภาพ) ถ้าไม่มีให้เป็นสตริงว่าง",
        "- keyMessage: ข้อความสนับสนุน/bullet/รายละเอียดย่อยที่อยู่บนภาพ แยกเป็นรายการทีละบรรทัดตามที่เห็นจริง ถ้าไม่มีให้เป็น array ว่าง",
        "- cta: ข้อความบนปุ่ม/กล่อง Call-to-action ถ้าไม่มีให้เป็นสตริงว่าง",
        "- footer: ข้อความตัวเล็กด้านล่าง เช่น legal/disclaimer/เงื่อนไข/ข้อมูลติดต่อ ถ้าไม่มีให้เป็นสตริงว่าง",
        "- ถ้าไม่แน่ใจว่าข้อความหนึ่งอยู่หมวดไหน ให้เลือกหมวดที่ใกล้เคียงที่สุดจากตำแหน่งบนภาพ ห้ามทิ้งข้อความที่อ่านได้",
        "- ห้ามอธิบาย ห้ามให้ความเห็น ตอบเฉพาะข้อความที่อ่านได้จริงเท่านั้น",
        "",
        "แต่ละภาพจะมี outputId กำกับไว้ ให้ตอบกลับด้วย outputId เดียวกันทุกรายการ"
      ].join("\n")
    }
  ];

  for (const output of input.outputs) {
    content.push({
      type: "input_text",
      text: `outputId: ${output.id}`
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
          headline: { type: "string" },
          keyMessage: { type: "array", items: { type: "string" } },
          cta: { type: "string" },
          footer: { type: "string" }
        },
        required: ["outputId", "headline", "keyMessage", "cta", "footer"]
      }
    }
  },
  required: ["results"]
} as const;

function parseResults(
  text: string,
  outputs: readonly ExtractArtworkCopyOutputInput[]
): readonly ExtractedArtworkCopy[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return outputs.map((output) => emptyExtractedCopy(output.id));
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.results)) {
    return outputs.map((output) => emptyExtractedCopy(output.id));
  }

  const byId = new Map<string, ExtractedArtworkCopy>();
  for (const item of parsed.results) {
    if (!isRecord(item) || typeof item.outputId !== "string") continue;
    byId.set(item.outputId, {
      outputId: item.outputId,
      headline: typeof item.headline === "string" ? item.headline : "",
      keyMessage: Array.isArray(item.keyMessage)
        ? item.keyMessage.filter((line): line is string => typeof line === "string")
        : [],
      cta: typeof item.cta === "string" ? item.cta : "",
      footer: typeof item.footer === "string" ? item.footer : ""
    });
  }

  return outputs.map(
    (output) => byId.get(output.id) ?? emptyExtractedCopy(output.id)
  );
}

function emptyExtractedCopy(outputId: string): ExtractedArtworkCopy {
  return { outputId, headline: "", keyMessage: [], cta: "", footer: "" };
}

function parseRequestBody(value: unknown): ExtractArtworkCopyRequest {
  if (!isRecord(value)) throw new Error("Invalid artwork copy extraction request.");
  if (!Array.isArray(value.outputs)) {
    throw new Error("outputs must be an array.");
  }

  return {
    outputs: value.outputs.map((item, index) => {
      const record = readRecord(item, `outputs[${index}]`);
      return {
        id: readString(record.id, `outputs[${index}].id`),
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
    throw new Error("OpenRouter artwork copy extraction response did not include output text.");
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

  throw new Error("OpenRouter artwork copy extraction response did not include output text.");
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
    : "Unknown artwork copy extraction error.";
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
