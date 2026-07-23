import { describe, expect, it } from "vitest";
import type { MappingClient } from "../../ports/mapping-client-repository";
import { planActiveMappingClientImports } from "./plan-mapping-client-import";

const activeClient = (
  clientId: string,
  overrides: Partial<MappingClient> = {}
): MappingClient => ({
  clientId,
  status: "Active",
  serviceStatus: "Active",
  ...overrides
});

describe("planActiveMappingClientImports", () => {
  it("skips inactive rows and punctuation variants of existing clients", () => {
    const rows = planActiveMappingClientImports(
      [
        activeClient("A-Klass Auto"),
        activeClient("Inactive Prospect", { status: "Inactive" }),
        activeClient("New Active Client")
      ],
      [{ id: "aklass", name: "A Klass Auto" }]
    );

    expect(rows.map((row) => row.name)).toEqual(["New Active Client"]);
  });

  it("creates a not-started Compass row without deriving Facebook data from the sheet", () => {
    const [row] = planActiveMappingClientImports(
      [activeClient("New Client")],
      []
    );

    expect(row).toEqual({
      id: "new-client",
      name: "New Client",
      category: "Awaiting brand ingestion",
      initials: "NC",
      source: "mapping_import",
      is_active: true,
      facebook_url: null,
      ingestion_status: "not_started",
      ingestion_error: null
    });
  });

  it("deduplicates repeated mapping names and avoids existing id collisions", () => {
    const rows = planActiveMappingClientImports(
      [activeClient("New Client"), activeClient("New-Client")],
      [{ id: "new-client", name: "Different Brand" }]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toMatch(/^new-client-/);
  });
});
