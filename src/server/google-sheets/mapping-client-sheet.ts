import type {
  OnboardingQuestionnaireSource,
  QuestionnaireExtractedField
} from "../../domain/brand.js";
import { ONBOARDING_QUESTIONNAIRE_MAX_LENGTH } from "../../domain/client-ingestion.js";
import type { MappingClient } from "../../ports/mapping-client-repository.js";

export const QUESTIONNAIRE_SHEET_TITLE = "1. Questionnaire";
const QUESTIONNAIRE_SHEET_TITLE_ALIASES = new Set([
  "questionnaire",
  "questionnaires",
  "questionaire",
  "questionaires",
  "questionaies"
]);

export interface MappingSheetExtraction {
  spreadsheetTitle: string;
  sheetTitle: string;
  rowCount: number;
  fields: readonly string[];
}

export interface MappingSheetResult {
  clients: readonly MappingClient[];
  extraction: MappingSheetExtraction;
}

export interface QuestionnaireExtractionReviewInput {
  rows: readonly (readonly string[])[];
  extractedFields: readonly QuestionnaireExtractedField[];
}

export type QuestionnaireExtractionReviewer = (
  input: QuestionnaireExtractionReviewInput
) => Promise<readonly QuestionnaireExtractedField[]>;

export async function readMappingClientsFromGoogleSheet({
  sheetUrl,
  accessToken,
  fetchImpl = fetch
}: {
  sheetUrl: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<MappingSheetResult> {
  if (isPublishedGoogleSheetUrl(sheetUrl)) {
    return readMappingClientsFromPublishedCsv(sheetUrl, fetchImpl);
  }

  const source = parseGoogleSheetUrl(sheetUrl);
  const metadata = await googleJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(source.spreadsheetId)}?fields=properties.title,sheets.properties`,
    accessToken,
    fetchImpl
  );
  const spreadsheetTitle = readSpreadsheetTitle(metadata);
  const sheets = readSheetProperties(metadata);
  const selectedSheet =
    sheets.find((sheet) => sheet.sheetId === source.sheetId) ?? sheets[0];
  if (!selectedSheet) throw new Error("Google Sheet has no readable tabs.");

  const range = encodeURIComponent(
    `'${selectedSheet.title.replaceAll("'", "''")}'`
  );
  const valuesPayload = await googleJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(source.spreadsheetId)}/values/${range}?majorDimension=ROWS`,
    accessToken,
    fetchImpl
  );
  const rows = readRows(valuesPayload);
  return mappingSheetResultFromRows(
    rows,
    spreadsheetTitle,
    selectedSheet.title
  );
}

async function readMappingClientsFromPublishedCsv(
  sheetUrl: string,
  fetchImpl: typeof fetch
): Promise<MappingSheetResult> {
  const response = await fetchImpl(sheetUrl.trim(), { cache: "no-store" });
  const csv = await response.text();
  if (!response.ok) {
    throw new Error(
      `Published mapping Google Sheet read failed: HTTP ${response.status}`
    );
  }
  const url = new URL(sheetUrl.trim());
  const gid = url.searchParams.get("gid");
  return mappingSheetResultFromRows(
    parseCsvRows(csv),
    "Published mapping sheet",
    gid ? `gid ${gid}` : "Published tab"
  );
}

function mappingSheetResultFromRows(
  rows: readonly string[][],
  spreadsheetTitle: string,
  sheetTitle: string
): MappingSheetResult {
  const headerIndex = rows.findIndex(
    (row) => findColumnIndex(row, "Client ID") >= 0
  );
  if (headerIndex < 0) {
    throw new Error('Google Sheet must contain a "Client ID" column.');
  }
  const header = rows[headerIndex] ?? [];
  const dataRows = rows.slice(headerIndex + 1);
  const indexes = {
    clientId: findColumnIndex(header, "Client ID"),
    status: findColumnIndex(header, "Status"),
    serviceStatus: findColumnIndex(header, "Service Status"),
    clientPortal: findColumnIndex(header, "Client Portal")
  };
  const clients = dataRows
    .map((row) => {
      const clientPortalUrl = cell(row, indexes.clientPortal);
      return {
        clientId: cell(row, indexes.clientId),
        status: cell(row, indexes.status),
        serviceStatus: cell(row, indexes.serviceStatus),
        ...(clientPortalUrl ? { clientPortalUrl } : {})
      };
    })
    .filter((client) => client.clientId);
  const supportedHeaders = [
    ["Client ID", indexes.clientId],
    ["Status", indexes.status],
    ["Service Status", indexes.serviceStatus],
    ["Client Portal", indexes.clientPortal]
  ]
    .filter(([, index]) => Number(index) >= 0)
    .map(([name]) => String(name));

  return {
    clients,
    extraction: {
      spreadsheetTitle,
      sheetTitle,
      rowCount: clients.length,
      fields: supportedHeaders
    }
  };
}

export function isPublishedGoogleSheetUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (
      url.hostname === "docs.google.com" &&
      /^\/spreadsheets\/d\/e\/[^/]+\/pub$/.test(url.pathname) &&
      url.searchParams.get("output")?.toLowerCase() === "csv"
    );
  } catch {
    return false;
  }
}

function parseCsvRows(value: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      if (quoted && value[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && character === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && value[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += character;
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (rows[0]?.[0]) rows[0][0] = rows[0][0].replace(/^\uFEFF/, "");
  return rows;
}

export async function readOnboardingQuestionnaireFromGoogleSheet({
  sheetUrl,
  accessToken,
  fetchImpl = fetch,
  reviewExtraction
}: {
  sheetUrl: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
  reviewExtraction?: QuestionnaireExtractionReviewer;
}): Promise<OnboardingQuestionnaireSource | null> {
  const source = parseGoogleSheetUrl(sheetUrl);
  const metadata = await googleJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(source.spreadsheetId)}?fields=properties.title,sheets.properties`,
    accessToken,
    fetchImpl
  );
  const sheets = readSheetProperties(metadata);
  const questionnaireSheet =
    sheets.find((sheet) => sheet.title.trim() === QUESTIONNAIRE_SHEET_TITLE) ??
    sheets.find((sheet) => isQuestionnaireSheetTitle(sheet.title));
  if (!questionnaireSheet) return null;
  const questionnaireSheetTitle = questionnaireSheet.title;
  const range = encodeURIComponent(
    `'${questionnaireSheetTitle.replaceAll("'", "''")}'`
  );
  const valuesPayload = await googleJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(source.spreadsheetId)}/values/${range}?majorDimension=ROWS`,
    accessToken,
    fetchImpl
  );
  const rows = readRows(valuesPayload);
  const deterministicFields = extractQuestionnaireFields(rows);
  const extractedFields = reviewExtraction
    ? await reviewExtraction({ rows, extractedFields: deterministicFields })
    : deterministicFields;
  if (!extractedFields.length) return null;
  const text = questionnaireFieldsToText(extractedFields, questionnaireSheetTitle);
  const facebookUrls = extractFacebookUrls(extractedFields);

  return {
    sourceUrl: sheetUrl.trim(),
    text,
    preview: text.slice(0, 280),
    facebookUrls,
    sheetTitle: questionnaireSheetTitle,
    extractedFields
  };
}

const QUESTIONNAIRE_FIELD_PATTERN = /^\{\{([a-z0-9_]+)\}\}$/i;
const EMPTY_ANSWER_PATTERNS = [
  /^e\.g\.\s/i,
  /^please fill out\b/i
] as const;
const QUESTIONNAIRE_HEADING_ALIASES: Readonly<
  Record<string, readonly string[]>
> = {
  brand_name_th: [
    "ชื่อแบรนด์ภาษาไทย",
    "ชื่อแบรนด์ (ภาษาไทย)",
    "Brand Name in Thai",
    "Brand Name in Thai (ชื่อแบรนด์ภาษาไทย)"
  ],
  brand_name_en: [
    "ชื่อแบรนด์ภาษาอังกฤษ",
    "ชื่อแบรนด์ (ภาษาอังกฤษ)",
    "Brand Name in English",
    "Brand Name in English (ชื่อแบรนด์ภาษาอังกฤษ)",
    "Brand info. Brand"
  ],
  brand_name_pronunciation: [
    "คำอ่านชื่อแบรนด์",
    "การออกเสียงชื่อแบรนด์",
    "Pronunciation",
    "Pronunciation (การออกเสียง เช่น คอน-เวิด-เค้ก)"
  ],
  brand_description: [
    "รายละเอียดแบรนด์",
    "แบรนด์ของคุณทำอะไร",
    "Brand Description",
    "Brand Descripton",
    "Brand Descripton (เล่าเกี่ยวกับแบรนด์สั้นๆ)"
  ],
  company_name: ["Company Name"],
  company_address: ["Company Address"],
  brand_media_channel_website: ["Website"],
  brand_media_channel_facebook: ["Facebook"],
  brand_media_channel_instagram: ["Instagram"],
  brand_media_channel_tiktok: ["TikTok"],
  brand_media_channel_line: ["Line"],
  brand_media_channel_shopee: ["Shopee"],
  brand_media_channel_lazada: ["Lazada"],
  brand_media_channel_youtube: ["YouTube"],
  marketing_challenge: ["โจทย์การตลาด", "ความท้าทายด้านการตลาด"],
  marketing_obstacle: ["อุปสรรคด้านการตลาด", "ปัญหาด้านการตลาด"],
  marketing_past_efforts: [
    "สิ่งที่เคยทำด้านการตลาด",
    "การตลาดที่ผ่านมา"
  ],
  marketing_additional_context: [
    "ข้อมูลการตลาดเพิ่มเติม",
    "บริบทการตลาดเพิ่มเติม"
  ],
  products_services_and_pricing: [
    "สินค้า บริการ และราคา",
    "สินค้าและบริการพร้อมราคา"
  ],
  products_growth_priority: [
    "สินค้าหรือบริการที่ต้องการผลักดัน",
    "สิ่งที่ต้องการผลักดัน"
  ],
  products_customer_pain_points: [
    "ปัญหาของลูกค้า",
    "Pain point ของลูกค้า",
    "Customer pain points"
  ],
  products_target_customer: [
    "กลุ่มลูกค้าเป้าหมาย",
    "ลูกค้าเป้าหมาย",
    "Target audience",
    "Target customer"
  ],
  products_unique_selling_points: [
    "จุดขายของสินค้าและบริการ",
    "จุดเด่นของสินค้าและบริการ",
    "USP",
    "Unique selling point"
  ],
  products_main_competitors: ["คู่แข่งหลัก", "Main competitors"],
  creative_references: [
    "ตัวอย่างงานที่ชอบ",
    "Creative references",
    "Reference งานครีเอทีฟ"
  ],
  creative_restrictions: [
    "ข้อจำกัดด้านครีเอทีฟ",
    "สิ่งที่ไม่ควรทำในงานครีเอทีฟ",
    "Creative restrictions"
  ],
  billing_method_messenger: []
};
const QUESTIONNAIRE_HEADING_TO_KEY = new Map(
  Object.entries(QUESTIONNAIRE_HEADING_ALIASES).flatMap(([key, aliases]) =>
    [key, questionnaireFieldLabel(key), ...aliases].map(
      (heading) => [normalizeQuestionnaireHeading(heading), key] as const
    )
  )
);
const QUESTIONNAIRE_ANSWER_LOOKAHEAD_ROWS = 5;

export function extractQuestionnaireFields(
  rows: readonly (readonly string[])[]
): readonly QuestionnaireExtractedField[] {
  const extracted: QuestionnaireExtractedField[] = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const placeholderIndex = row.findIndex((cell) =>
      QUESTIONNAIRE_FIELD_PATTERN.test(cell.trim())
    );
    const headingMatch =
      placeholderIndex < 0 ? findQuestionnaireHeading(row) : null;
    const fieldIndex =
      placeholderIndex >= 0 ? placeholderIndex : headingMatch?.index ?? -1;
    const key =
      placeholderIndex >= 0
        ? row[placeholderIndex]
            ?.trim()
            .match(QUESTIONNAIRE_FIELD_PATTERN)?.[1]
        : headingMatch?.key;
    if (!key) continue;

    let candidates = questionnaireAnswerValues(
      key,
      row.slice(fieldIndex + 1)
    );
    if (!candidates.length && headingMatch) {
      candidates = questionnaireAnswersBelow(rows, rowIndex, key);
    }
    if (!candidates.length) continue;

    extracted.push({
      key,
      label: questionnaireFieldLabel(key),
      value: [...new Set(candidates)].join("\n\n")
    });
  }

  for (const row of rows) {
    for (const cell of row) {
      for (const field of questionnaireFieldsFromEmbeddedText(cell)) {
        if (
          !extracted.some(
            (existing) =>
              existing.key === field.key && existing.value === field.value
          )
        ) {
          extracted.push(field);
        }
      }
    }
  }

  return extracted;
}

function questionnaireFieldsFromEmbeddedText(
  value: string
): QuestionnaireExtractedField[] {
  const source = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!source) return [];

  const normalizedSource = source.toLocaleLowerCase("th-TH");
  const candidates = Object.entries(QUESTIONNAIRE_HEADING_ALIASES).flatMap(
    ([key, aliases]) =>
      [questionnaireFieldLabel(key), ...aliases].flatMap((heading) => {
        const normalizedHeading = heading
          .normalize("NFKC")
          .toLocaleLowerCase("th-TH");
        const matches: { start: number; end: number; key: string }[] = [];
        let start = normalizedSource.indexOf(normalizedHeading);
        while (start >= 0) {
          const end = start + normalizedHeading.length;
          if (
            isEmbeddedHeadingBoundary(normalizedSource[start - 1]) &&
            isEmbeddedHeadingBoundary(normalizedSource[end])
          ) {
            matches.push({ start, end, key });
          }
          start = normalizedSource.indexOf(normalizedHeading, start + 1);
        }
        return matches;
      })
  );
  candidates.sort(
    (left, right) =>
      left.start - right.start || right.end - right.start - (left.end - left.start)
  );

  const matches: typeof candidates = [];
  for (const candidate of candidates) {
    const previous = matches.at(-1);
    if (previous && candidate.start < previous.end) continue;
    matches.push(candidate);
  }
  if (!matches.length || (matches.length === 1 && matches[0]!.start > 80)) {
    return [];
  }

  return matches.flatMap((match, index) => {
    const nextStart = matches[index + 1]?.start ?? source.length;
    const answer = cleanEmbeddedQuestionnaireAnswer(
      source.slice(match.end, nextStart)
    );
    if (!answer) return [];
    return [
      {
        key: match.key,
        label: questionnaireFieldLabel(match.key),
        value: answer
      }
    ];
  });
}

function isEmbeddedHeadingBoundary(value: string | undefined): boolean {
  return value === undefined || /[\s·•():：→\-]/.test(value);
}

function cleanEmbeddedQuestionnaireAnswer(value: string): string {
  return value
    .trim()
    .replace(/^\([^)]*\)\s*/, "")
    .replace(/^(?:→|:|：|-)\s*/, "")
    .replace(/^[·•]\s*/, "")
    .trim();
}

function questionnaireAnswerValues(
  key: string,
  cells: readonly string[]
): string[] {
  const candidates = cells.map((cell) => cell.trim()).filter(Boolean);
  const checkboxValue = candidates.find((value) =>
    /^(true|false)$/i.test(value)
  );
  return checkboxValue
    ? [checkboxValue.toLowerCase() === "true" ? "Yes" : "No"]
    : candidates
        .filter(
          (value) =>
            !EMPTY_ANSWER_PATTERNS.some((pattern) => pattern.test(value))
        )
        .map((value) => stripQuestionnaireInputPrefix(key, value))
        .filter(Boolean);
}

function questionnaireAnswersBelow(
  rows: readonly (readonly string[])[],
  headingRowIndex: number,
  key: string
): string[] {
  const answerCells: string[] = [];
  const endIndex = Math.min(
    rows.length,
    headingRowIndex + QUESTIONNAIRE_ANSWER_LOOKAHEAD_ROWS + 1
  );
  for (let rowIndex = headingRowIndex + 1; rowIndex < endIndex; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    if (hasQuestionnaireFieldMarker(row)) break;
    answerCells.push(...row);
  }
  return questionnaireAnswerValues(key, answerCells);
}

function hasQuestionnaireFieldMarker(row: readonly string[]): boolean {
  return (
    row.some((cell) => QUESTIONNAIRE_FIELD_PATTERN.test(cell.trim())) ||
    findQuestionnaireHeading(row) !== null
  );
}

function findQuestionnaireHeading(
  row: readonly string[]
): { index: number; key: string } | null {
  for (let index = 0; index < row.length; index += 1) {
    const key = QUESTIONNAIRE_HEADING_TO_KEY.get(
      normalizeQuestionnaireHeading(row[index] ?? "")
    );
    if (key) return { index, key };
  }
  return null;
}

function normalizeQuestionnaireHeading(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("th-TH")
    .replace(/^[0-9๐-๙]+\s*[.)\-:]\s*/, "")
    .replace(/[?*：:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function questionnaireFieldsToText(
  fields: readonly QuestionnaireExtractedField[],
  sheetTitle = QUESTIONNAIRE_SHEET_TITLE
): string {
  return [
    `Source tab: ${sheetTitle}`,
    `Extracted fields: ${fields.length}`,
    "",
    ...fields.flatMap((field) => [
      `${field.label} [${field.key}]`,
      field.value,
      ""
    ])
  ]
    .join("\n")
    .trim()
    .slice(0, ONBOARDING_QUESTIONNAIRE_MAX_LENGTH);
}

function isQuestionnaireSheetTitle(title: string): boolean {
  const normalizedTitle = title
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/^[0-9๐-๙]+\s*[.)\-:]?\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  return QUESTIONNAIRE_SHEET_TITLE_ALIASES.has(normalizedTitle);
}

export function questionnaireFieldLabel(key: string): string {
  const abbreviations: Record<string, string> = {
    th: "TH",
    en: "EN",
    ugc: "UGC"
  };
  const words = key
    .split("_")
    .map((word) => abbreviations[word] ?? word)
    .join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function questionnaireKnownFieldKeys(): readonly string[] {
  return Object.keys(QUESTIONNAIRE_HEADING_ALIASES);
}

function stripQuestionnaireInputPrefix(key: string, value: string): string {
  const match = value.match(/^([A-Za-z][A-Za-z ]{0,30}):\s*([\s\S]*)$/);
  if (!match) return value;

  const prefix = match[1]?.trim().toLowerCase().replaceAll(" ", "_");
  const answer = match[2]?.trim() ?? "";
  const keySuffix = key.split("_").at(-1);
  const knownPrefixes = new Set([
    "name",
    "position",
    "phone",
    "email",
    "website",
    "facebook",
    "instagram",
    "tiktok",
    "shopee",
    "lazada",
    "youtube",
    "other"
  ]);
  return prefix === keySuffix || knownPrefixes.has(prefix ?? "")
    ? answer
    : value;
}

function extractFacebookUrls(
  fields: readonly QuestionnaireExtractedField[]
): readonly string[] {
  const urls = fields.flatMap((field) =>
    field.value.match(/https?:\/\/(?:www\.)?(?:facebook\.com|fb\.com)\/[^\s),]+/gi) ??
    []
  );
  return [...new Set(urls.map((url) => url.replace(/[.;]+$/, "")))];
}

export function parseGoogleSheetUrl(value: string): {
  spreadsheetId: string;
  sheetId?: number;
} {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid Google Sheet URL.");
  }
  if (url.hostname !== "docs.google.com") {
    throw new Error("Enter a docs.google.com spreadsheet URL.");
  }
  const match = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)/);
  const spreadsheetId = match?.[1];
  if (!spreadsheetId || spreadsheetId === "e") {
    throw new Error(
      "Use the normal Google Sheet URL, not a Publish to web URL."
    );
  }
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const rawSheetId = url.searchParams.get("gid") ?? hashParams.get("gid");
  const parsedSheetId =
    rawSheetId !== null && /^\d+$/.test(rawSheetId)
      ? Number(rawSheetId)
      : undefined;

  return {
    spreadsheetId,
    ...(parsedSheetId !== undefined ? { sheetId: parsedSheetId } : {})
  };
}

async function googleJson(
  url: string,
  accessToken: string,
  fetchImpl: typeof fetch
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const text = await response.text();
  if (response.status === 401) {
    throw new Error(
      "Google access has expired. Try again to renew it automatically."
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Google Sheets returned ${response.status} with invalid JSON.`);
  }
  if (!response.ok) {
    const message =
      isRecord(body) &&
      isRecord(body.error) &&
      typeof body.error.message === "string"
        ? body.error.message
        : `HTTP ${response.status}`;
    throw new Error(`Google Sheets read failed: ${message}`);
  }
  if (!isRecord(body)) throw new Error("Google Sheets returned invalid JSON.");
  return body;
}

function readSpreadsheetTitle(payload: Record<string, unknown>): string {
  const properties = payload.properties;
  if (!isRecord(properties) || typeof properties.title !== "string") {
    throw new Error("Google Sheets metadata did not include a title.");
  }
  return properties.title;
}

function readSheetProperties(
  payload: Record<string, unknown>
): readonly { sheetId: number; title: string }[] {
  if (!Array.isArray(payload.sheets)) return [];
  return payload.sheets.flatMap((entry) => {
    if (!isRecord(entry) || !isRecord(entry.properties)) return [];
    const { sheetId, title } = entry.properties;
    return typeof sheetId === "number" && typeof title === "string"
      ? [{ sheetId, title }]
      : [];
  });
}

function readRows(payload: Record<string, unknown>): string[][] {
  if (!Array.isArray(payload.values)) return [];
  return payload.values.map((row) =>
    Array.isArray(row)
      ? row.map((value) =>
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
            ? String(value)
            : ""
        )
      : []
  );
}

function findColumnIndex(header: readonly string[], name: string): number {
  const normalizedName = name.trim().toLowerCase();
  return header.findIndex(
    (value) => value.trim().toLowerCase() === normalizedName
  );
}

function cell(row: readonly string[], index: number): string {
  return index < 0 ? "" : (row[index] || "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
