import type {
  OnboardingQuestionnaireSource,
  QuestionnaireExtractedField
} from "../../domain/brand.js";
import { ONBOARDING_QUESTIONNAIRE_MAX_LENGTH } from "../../domain/client-ingestion.js";
import type { MappingClient } from "../../ports/mapping-client-repository.js";

export const QUESTIONNAIRE_SHEET_TITLE = "1. Questionnaire";

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

export async function readMappingClientsFromGoogleSheet({
  sheetUrl,
  accessToken,
  fetchImpl = fetch
}: {
  sheetUrl: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<MappingSheetResult> {
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
  const [header = [], ...dataRows] = rows;
  const indexes = {
    clientId: findColumnIndex(header, "Client ID"),
    status: findColumnIndex(header, "Status"),
    serviceStatus: findColumnIndex(header, "Service Status"),
    clientPortal: findColumnIndex(header, "Client Portal")
  };
  if (indexes.clientId < 0) {
    throw new Error('Google Sheet must contain a "Client ID" column.');
  }

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
      sheetTitle: selectedSheet.title,
      rowCount: clients.length,
      fields: supportedHeaders
    }
  };
}

export async function readOnboardingQuestionnaireFromGoogleSheet({
  sheetUrl,
  fetchImpl = fetch
}: {
  sheetUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<OnboardingQuestionnaireSource | null> {
  const source = parseGoogleSheetUrl(sheetUrl);
  const table = await googleVisualizationTable(
    `https://docs.google.com/spreadsheets/d/${encodeURIComponent(source.spreadsheetId)}/gviz/tq?tqx=out:json&headers=0&sheet=${encodeURIComponent(QUESTIONNAIRE_SHEET_TITLE)}`,
    fetchImpl
  );
  const rows = readVisualizationRows(table);
  const extractedFields = extractQuestionnaireFields(rows);
  if (!extractedFields.length) {
    throw new Error(
      `No questionnaire fields were found in "${QUESTIONNAIRE_SHEET_TITLE}". Expected placeholders such as {{brand_name_en}} in the first column.`
    );
  }
  const text = questionnaireFieldsToText(extractedFields);
  const facebookUrls = extractFacebookUrls(extractedFields);

  return {
    sourceUrl: sheetUrl.trim(),
    text,
    preview: text.slice(0, 280),
    facebookUrls,
    sheetTitle: QUESTIONNAIRE_SHEET_TITLE,
    extractedFields
  };
}

async function googleVisualizationTable(
  url: string,
  fetchImpl: typeof fetch
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Questionnaire Google Sheet must be shared as "Anyone with the link" (HTTP ${response.status}).`
    );
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  let payload: unknown;
  try {
    payload = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error(
      'Questionnaire Google Sheet did not return readable public data. Confirm it is shared as "Anyone with the link".'
    );
  }
  if (!isRecord(payload) || payload.status !== "ok") {
    throw new Error(
      `Could not read the public "${QUESTIONNAIRE_SHEET_TITLE}" tab. Confirm the tab exists and the Sheet is shared as "Anyone with the link".`
    );
  }
  if (!isRecord(payload.table)) {
    throw new Error("Questionnaire Google Sheet returned invalid data.");
  }
  return payload.table;
}

function readVisualizationRows(
  table: Record<string, unknown>
): readonly string[][] {
  return Array.isArray(table.rows)
    ? table.rows.map((row) => {
        if (!isRecord(row) || !Array.isArray(row.c)) return [];
        return row.c.map(readVisualizationCell);
      })
    : [];
}

function readVisualizationCell(value: unknown): string {
  if (!isRecord(value)) return "";
  if (typeof value.f === "string") return value.f;
  return typeof value.v === "string" ||
    typeof value.v === "number" ||
    typeof value.v === "boolean"
    ? String(value.v)
    : "";
}

const QUESTIONNAIRE_FIELD_PATTERN = /^\{\{([a-z0-9_]+)\}\}$/i;
const EMPTY_ANSWER_PATTERNS = [
  /^e\.g\.\s/i,
  /^please fill out\b/i
] as const;

export function extractQuestionnaireFields(
  rows: readonly (readonly string[])[]
): readonly QuestionnaireExtractedField[] {
  const extracted: QuestionnaireExtractedField[] = [];

  for (const row of rows) {
    const placeholderIndex = row.findIndex((cell) =>
      QUESTIONNAIRE_FIELD_PATTERN.test(cell.trim())
    );
    if (placeholderIndex < 0) continue;

    const key = row[placeholderIndex]
      ?.trim()
      .match(QUESTIONNAIRE_FIELD_PATTERN)?.[1];
    if (!key) continue;

    const candidates = row
      .slice(placeholderIndex + 1)
      .map((cell) => cell.trim())
      .filter(Boolean);
    const checkboxValue = candidates.find((value) =>
      /^(true|false)$/i.test(value)
    );
    const values = checkboxValue
      ? [checkboxValue.toLowerCase() === "true" ? "Yes" : "No"]
      : candidates
          .filter(
            (value) =>
              !EMPTY_ANSWER_PATTERNS.some((pattern) => pattern.test(value))
          )
          .map((value) => stripQuestionnaireInputPrefix(key, value))
          .filter(Boolean);
    const uniqueValues = [...new Set(values)];
    if (!uniqueValues.length) continue;

    extracted.push({
      key,
      label: questionnaireFieldLabel(key),
      value: uniqueValues.join("\n\n")
    });
  }

  return extracted;
}

function questionnaireFieldsToText(
  fields: readonly QuestionnaireExtractedField[]
): string {
  return [
    `Source tab: ${QUESTIONNAIRE_SHEET_TITLE}`,
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

function questionnaireFieldLabel(key: string): string {
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
          typeof value === "string" || typeof value === "number"
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
