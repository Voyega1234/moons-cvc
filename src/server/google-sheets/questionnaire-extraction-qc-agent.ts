import type { QuestionnaireExtractedField } from "../../domain/brand.js";
import {
  questionnaireFieldLabel,
  questionnaireKnownFieldKeys,
  type QuestionnaireExtractionReviewInput
} from "./mapping-client-sheet.js";

type FetchLike = typeof fetch;

export interface QuestionnaireExtractionQcOptions
  extends QuestionnaireExtractionReviewInput {
  apiKey: string;
  model?: string;
  fetchImpl?: FetchLike;
}

const DEFAULT_MODEL = "gpt-5.6-luna";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const MAX_RAW_SHEET_CHARACTERS = 60_000;
const PLACEHOLDER_PATTERN = /^\{\{([a-z0-9_]+)\}\}$/i;

export async function reviewQuestionnaireExtractionWithLuna({
  rows,
  extractedFields,
  apiKey,
  model = DEFAULT_MODEL,
  fetchImpl = fetch
}: QuestionnaireExtractionQcOptions): Promise<
  readonly QuestionnaireExtractedField[]
> {
  const normalizedApiKey = apiKey.trim();
  if (!normalizedApiKey) {
    throw new Error("OPENAI_API_KEY is required for questionnaire QC.");
  }

  const sourceCells = collectSourceCells(rows);
  const rawSheet = sourceCells
    .map((cell) => `${cell.id}: ${cell.value}`)
    .join("\n");
  if (rawSheet.length > MAX_RAW_SHEET_CHARACTERS) {
    throw new Error(
      `Questionnaire is too large for reliable Luna QC (${rawSheet.length} characters; maximum ${MAX_RAW_SHEET_CHARACTERS}).`
    );
  }

  const allowedKeys = [
    ...new Set([
      ...questionnaireKnownFieldKeys(),
      ...extractedFields.map((field) => field.key),
      ...rows.flatMap((row) =>
        row.flatMap((cell) => {
          const key = cell.trim().match(PLACEHOLDER_PATTERN)?.[1];
          return key ? [key] : [];
        })
      )
    ])
  ].sort();
  const response = await fetchImpl(OPENAI_RESPONSES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${normalizedApiKey}`
    },
    body: JSON.stringify({
      model: model.trim() || DEFAULT_MODEL,
      store: false,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildPrompt(rawSheet, extractedFields, allowedKeys)
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "moons_questionnaire_extraction_qc",
          strict: true,
          schema: extractionSchema(allowedKeys)
        }
      }
    })
  });

  if (!response.ok) {
    const detail = await readProviderErrorDetail(response);
    throw new Error(
      `GPT Luna questionnaire QC failed: ${response.status}${detail ? ` — ${detail}` : ""}`
    );
  }

  const payload = await readJsonResponse(response);
  return parseGroundedFields(
    extractResponseText(payload),
    allowedKeys,
    sourceCells.map((cell) => cell.value)
  );
}

function buildPrompt(
  rawSheet: string,
  extractedFields: readonly QuestionnaireExtractedField[],
  allowedKeys: readonly string[]
): string {
  return [
    "คุณคือ Questionnaire Mapping QA ของ Moons หน้าที่เดียวคือตรวจและจัดคำตอบจาก Google Sheet ให้ตรง field",
    "ใช้ Raw Sheet cells เป็น source of truth ส่วน deterministic candidates เป็นเพียงร่างที่อาจวางผิดช่อง ซ้ำ หรือกินข้อความข้าม section",
    "",
    "กฎบังคับ:",
    "1. คืนเฉพาะ field ที่มีคำตอบจริง ห้ามคืนหัวข้อ คำถาม คำแนะนำ ตัวอย่าง placeholder หรือช่องว่างเป็นคำตอบ",
    "2. sourceQuotes ทุกชิ้นต้องคัดลอกแบบ verbatim เป็น substring ที่ต่อเนื่องจาก Raw Sheet cell จริง ห้ามสรุป แปล แก้คำ หรือแต่งข้อมูล",
    "3. sourceQuotes ต้องมีเฉพาะเนื้อหาคำตอบ ไม่รวมชื่อหัวข้อ ลูกศร คำว่า Page URL/URL หรือคำอธิบายคำถาม ถ้าตัดให้เป็น substring ที่สะอาดได้",
    "4. คำตอบหลายบรรทัดของ field เดียวให้คืนหลาย sourceQuotes ตามลำดับที่ปรากฏ",
    "5. ชื่อแบรนด์ คำอ่าน และคำอธิบายแบรนด์เป็นคนละ field; ถ้าคำอ่านว่างให้ตัด field นั้นทิ้ง",
    "6. ช่องทางของแบรนด์ต้องเป็นบัญชีของแบรนด์เอง ห้ามนำ URL ของคู่แข่งไปใส่ brand_media_channel_*",
    "7. รายชื่อและลิงก์คู่แข่งทั้งหมดให้รวมใน products_main_competitors โดยคงลำดับและความสัมพันธ์ของแต่ละคู่แข่ง",
    "8. ถ้ามี checkbox Yes/No และมี URL/คำตอบจริงของ field เดียวกัน ให้ใช้คำตอบจริงและไม่คืน checkbox ซ้ำ",
    "9. ถ้าหลักฐานกำกวมจนระบุ field ไม่ได้ ให้ตัดทิ้ง ห้ามเดา",
    "10. ใช้ได้เฉพาะ key ใน Allowed keys และคืนแต่ละ key ได้ครั้งเดียว",
    "",
    `Allowed keys: ${allowedKeys.join(", ")}`,
    "",
    "Deterministic candidates (อาจผิด):",
    extractedFields.length
      ? extractedFields
          .map(
            (field) =>
              `${field.key}\n${field.value}`
          )
          .join("\n---\n")
      : "None",
    "",
    "Raw Sheet cells:",
    rawSheet,
    "",
    "Return only JSON ตาม schema."
  ].join("\n");
}

function extractionSchema(allowedKeys: readonly string[]) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      fields: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            key: { type: "string", enum: allowedKeys },
            sourceQuotes: {
              type: "array",
              items: { type: "string" }
            }
          },
          required: ["key", "sourceQuotes"]
        }
      }
    },
    required: ["fields"]
  } as const;
}

function collectSourceCells(rows: readonly (readonly string[])[]) {
  return rows.flatMap((row, rowIndex) =>
    row.flatMap((value, columnIndex) => {
      const normalized = value.trim();
      return normalized
        ? [{ id: `R${rowIndex + 1}C${columnIndex + 1}`, value: normalized }]
        : [];
    })
  );
}

function parseGroundedFields(
  text: string,
  allowedKeys: readonly string[],
  sourceCells: readonly string[]
): readonly QuestionnaireExtractedField[] {
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.fields)) {
    throw new Error("GPT Luna questionnaire QC fields must be an array.");
  }

  const allowed = new Set(allowedKeys);
  const seen = new Set<string>();
  const fields = parsed.fields.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Questionnaire QC fields[${index}] must be an object.`);
    }
    const key = readString(item.key, `fields[${index}].key`).trim();
    if (!allowed.has(key) || seen.has(key)) {
      throw new Error(`Questionnaire QC fields[${index}].key is invalid.`);
    }
    seen.add(key);
    if (!Array.isArray(item.sourceQuotes) || !item.sourceQuotes.length) {
      throw new Error(
        `Questionnaire QC fields[${index}].sourceQuotes must contain evidence.`
      );
    }
    const quotes = item.sourceQuotes.map((quote, quoteIndex) => {
      const value = readString(
        quote,
        `fields[${index}].sourceQuotes[${quoteIndex}]`
      ).trim();
      if (!value || !sourceCells.some((cell) => cell.includes(value))) {
        throw new Error(
          `Questionnaire QC fields[${index}].sourceQuotes[${quoteIndex}] is not grounded in the Google Sheet.`
        );
      }
      return value;
    });
    return {
      key,
      label: questionnaireFieldLabel(key),
      value: [...new Set(quotes)].join("\n\n")
    };
  });

  if (!fields.length) {
    throw new Error("GPT Luna questionnaire QC found no answered fields.");
  }
  return fields;
}

function extractResponseText(payload: unknown): string {
  if (isRecord(payload) && typeof payload.output_text === "string") {
    return payload.output_text;
  }
  if (isRecord(payload) && Array.isArray(payload.output)) {
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
  }
  throw new Error("GPT Luna questionnaire QC response did not include output text.");
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

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error("GPT Luna questionnaire QC returned an empty response body.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("GPT Luna questionnaire QC returned a non-JSON response.");
  }
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
