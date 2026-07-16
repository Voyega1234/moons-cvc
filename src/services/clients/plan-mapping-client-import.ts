import { initialsFromClientName } from "../../domain/client-ingestion";
import type { MappingClient } from "../../ports/mapping-client-repository";
import { slugify } from "../../shared/utils/text";
import { normalizeClientKey } from "./merge-mapping-clients";

export interface ExistingClientIdentity {
  id: string;
  name: string;
}

export interface MappingClientImportRow {
  id: string;
  name: string;
  category: string;
  initials: string;
  source: string;
  is_active: true;
  facebook_url: string | null;
  ingestion_status: "not_started";
  ingestion_error: null;
}

export function planActiveMappingClientImports(
  mappingClients: readonly MappingClient[],
  existingClients: readonly ExistingClientIdentity[]
): MappingClientImportRow[] {
  const existingNames = new Set(
    existingClients.map((client) => normalizeClientKey(client.name))
  );
  const usedIds = new Set(existingClients.map((client) => client.id));
  const plannedNames = new Set<string>();
  const rows: MappingClientImportRow[] = [];

  for (const mappingClient of mappingClients) {
    if (mappingClient.status.trim().toLowerCase() !== "active") continue;

    const name = mappingClient.clientId.trim();
    const normalizedName = normalizeClientKey(name);
    if (!name || !normalizedName) continue;
    if (existingNames.has(normalizedName) || plannedNames.has(normalizedName)) {
      continue;
    }

    const id = availableClientId(name, usedIds);
    usedIds.add(id);
    plannedNames.add(normalizedName);
    rows.push({
      id,
      name,
      category: "Awaiting brand ingestion",
      initials: initialsFromClientName(name),
      source: "mapping_import",
      is_active: true,
      facebook_url: mappingClient.questionnaire?.facebookUrls[0] ?? null,
      ingestion_status: "not_started",
      ingestion_error: null
    });
  }

  return rows;
}

function availableClientId(name: string, usedIds: ReadonlySet<string>): string {
  const base = slugify(name) || `client-${stableSuffix(name)}`;
  if (!usedIds.has(base)) return base;

  return `${base}-${stableSuffix(name)}`;
}

function stableSuffix(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value.normalize("NFKC")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}
