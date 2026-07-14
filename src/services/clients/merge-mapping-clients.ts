import type { Brand } from "../../domain/brand";
import type { MappingClient } from "../../ports/mapping-client-repository";

const emptyLibrary: Brand["library"] = {
  brand: [],
  products: [],
  docs: [],
  refs: []
};

const emptyMemory: Brand["memory"] = {
  working: [],
  avoid: []
};

export function mergeMappingClients(
  systemClients: readonly Brand[],
  mappingClients: readonly MappingClient[]
): readonly Brand[] {
  const systemByName = new Map<string, Brand>();

  const merged: Brand[] = systemClients.map((client) => {
    const normalized = normalizeClientKey(client.name);
    const nextClient: Brand = {
      ...client,
      existsInSystem: true,
      source: "system"
    };
    systemByName.set(normalized, nextClient);
    return nextClient;
  });

  for (const mappingClient of mappingClients) {
    const normalized = normalizeClientKey(mappingClient.clientId);
    const existingClient = systemByName.get(normalized);

    if (existingClient) {
      existingClient.mappingStatus = mappingClient.status;
      existingClient.serviceStatus = mappingClient.serviceStatus;
      continue;
    }

    merged.push({
      id: `mapping:${encodeURIComponent(mappingClient.clientId)}`,
      name: mappingClient.clientId,
      category: "No brand memory yet",
      initials: initialsFromName(mappingClient.clientId),
      library: emptyLibrary,
      memory: emptyMemory,
      existsInSystem: false,
      mappingStatus: mappingClient.status,
      serviceStatus: mappingClient.serviceStatus,
      source: "mapping"
    });
  }

  return merged.sort((a, b) => {
    if (a.existsInSystem !== b.existsInSystem) {
      return a.existsInSystem === false ? 1 : -1;
    }

    return a.name.localeCompare(b.name, "th");
  });
}

export function normalizeClientKey(clientName: string): string {
  return clientName.trim().toLowerCase();
}

function initialsFromName(clientName: string): string {
  const initials = clientName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  return initials || "-";
}
