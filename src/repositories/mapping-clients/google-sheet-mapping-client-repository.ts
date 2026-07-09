import type {
  MappingClient,
  MappingClientRepository
} from "../../ports/mapping-client-repository";

const DEFAULT_MAPPING_CLIENTS_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRvN1Bg6vUI2MeCMCSAmG9jmBjTlV17sIsyRu5Nd-h2JXuZG8Gbmdr61a8lJMdto13stA_bfGiuLETe/pub?gid=147531213&single=true&output=csv";

const CACHE_TTL_MS = 5 * 60 * 1000;

export class GoogleSheetMappingClientRepository
  implements MappingClientRepository
{
  private cached:
    | { expiresAt: number; clients: readonly MappingClient[] }
    | null = null;

  constructor(private readonly csvUrl = mappingClientsCsvUrl()) {}

  async list(): Promise<readonly MappingClient[]> {
    if (this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached.clients;
    }

    try {
      const response = await fetch(this.csvUrl, { cache: "no-store" });
      if (!response.ok) return [];

      const rows = parseCsv(await response.text());
      const [, ...dataRows] = rows;
      const clients = dataRows
        .map((row) => ({
          clientId: (row[1] || "").trim(),
          status: (row[2] || "").trim(),
          serviceStatus: (row[3] || "").trim()
        }))
        .filter((client) => client.clientId);

      this.cached = {
        clients,
        expiresAt: Date.now() + CACHE_TTL_MS
      };

      return clients;
    } catch {
      return [];
    }
  }
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
