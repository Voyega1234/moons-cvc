import type {
  MappingClient,
  MappingClientRepository
} from "../../ports/mapping-client-repository";
import type { QuestionnaireBrandSource } from "../../domain/brand";

const DEFAULT_MAPPING_CLIENTS_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRvN1Bg6vUI2MeCMCSAmG9jmBjTlV17sIsyRu5Nd-h2JXuZG8Gbmdr61a8lJMdto13stA_bfGiuLETe/pub?gid=147531213&single=true&output=csv";

const CACHE_TTL_MS = 5 * 60 * 1000;

export class GoogleSheetMappingClientRepository
  implements MappingClientRepository
{
  private cached:
    | { expiresAt: number; clients: readonly MappingClient[] }
    | null = null;

  constructor(
    private readonly csvUrl = mappingClientsCsvUrl(),
    private readonly fetchImpl: typeof fetch = (input, init) =>
      fetch(input, init)
  ) {}

  async list(): Promise<readonly MappingClient[]> {
    if (this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached.clients;
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const clients = await this.fetchClients();
        this.cached = {
          clients,
          expiresAt: Date.now() + CACHE_TTL_MS
        };
        return clients;
      } catch {
        // Google occasionally returns an HTML storage-access page with 200.
        // Retry once and never cache the invalid response.
      }
    }

    return [];
  }

  private async fetchClients(): Promise<readonly MappingClient[]> {
    const response = await this.fetchImpl(this.csvUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Mapping sheet failed: ${response.status}`);

    const rows = parseCsv(await response.text());
    const [header = [], ...dataRows] = rows;
    const indexes = {
      clientId: findColumnIndex(header, "Client ID"),
      status: findColumnIndex(header, "Status"),
      serviceStatus: findColumnIndex(header, "Service Status"),
      clientPortal: findColumnIndex(header, "Client Portal"),
      questionnaire: findColumnIndex(header, "Questionnaire")
    };

    if (indexes.clientId < 0) {
      throw new Error("Mapping sheet did not return CSV client data.");
    }

    return dataRows
      .map((row) => {
        const questionnaireText = cell(row, indexes.questionnaire);
        const sourceUrl = cell(row, indexes.clientPortal);
        return {
          clientId: cell(row, indexes.clientId),
          status: cell(row, indexes.status),
          serviceStatus: cell(row, indexes.serviceStatus),
          ...(questionnaireText
            ? {
                questionnaire: buildQuestionnaireBrandSource(
                  questionnaireText,
                  sourceUrl
                )
              }
            : {})
        };
      })
      .filter((client) => client.clientId);
  }
}

export function buildQuestionnaireBrandSource(
  questionnaire: string,
  sourceUrl = ""
): QuestionnaireBrandSource {
  const text = questionnaireBrandEvidence(questionnaire);
  return {
    ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}),
    text,
    preview: text.slice(0, 280),
    facebookUrls: extractFacebookUrls(questionnaire)
  };
}

export function extractFacebookUrls(text: string): string[] {
  const matches = text.match(
    /(?:https?:\/\/)?(?:www\.)?(?:facebook\.com|fb\.com)\/[^\s,;)'"<>]+/gi
  );
  if (!matches) return [];

  const urls = matches
    .map((match) => match.replace(/[.\]}]+$/g, ""))
    .map((match) => (/^https?:\/\//i.test(match) ? match : `https://${match}`))
    .filter((value) => {
      try {
        const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
        return hostname === "facebook.com" || hostname === "fb.com";
      } catch {
        return false;
      }
    });

  return [...new Set(urls)];
}

export function questionnaireBrandEvidence(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const contactMarkers = [
    /\bContacts?\b/i,
    /\bPrimary Contact\b/i,
    /\bPrimary Point of Contact\b/i,
    /\bSession 2:\s*Contact/i
  ];
  const cutAt = contactMarkers
    .map((pattern) => normalized.search(pattern))
    .filter((index) => index >= 0)
    .reduce((earliest, index) => Math.min(earliest, index), normalized.length);

  return normalized.slice(0, cutAt).trim().slice(0, 12_000);
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

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);

  return rows;
}

function mappingClientsCsvUrl(): string {
  return (
    import.meta.env.VITE_MAPPING_CLIENTS_CSV_URL ||
    import.meta.env.MAPPING_CLIENTS_CSV_URL ||
    DEFAULT_MAPPING_CLIENTS_CSV_URL
  );
}
