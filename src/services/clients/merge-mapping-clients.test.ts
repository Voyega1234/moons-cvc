import { describe, expect, it } from "vitest";
import type { Brand } from "../../domain/brand";
import { mergeMappingClients } from "./merge-mapping-clients";

const systemClient: Brand = {
  id: "bonefit",
  name: "BoneFit",
  category: "Health supplement",
  initials: "BF",
  library: { brand: [], products: [], docs: [], refs: [] },
  memory: { working: [], avoid: [] }
};

describe("mergeMappingClients", () => {
  it("keeps system clients selectable and adds sheet-only clients as disabled", () => {
    const merged = mergeMappingClients(
      [systemClient],
      [
        {
          clientId: "BoneFit",
          status: "Active",
          serviceStatus: "Retainer"
        },
        {
          clientId: "New Client",
          status: "Active",
          serviceStatus: "Pitching"
        }
      ]
    );

    const bonefit = merged.find((client) => client.name === "BoneFit");
    const newClient = merged.find((client) => client.name === "New Client");

    expect(bonefit?.existsInSystem).toBe(true);
    expect(bonefit?.mappingStatus).toBe("Active");
    expect(newClient?.existsInSystem).toBe(false);
    expect(newClient?.source).toBe("mapping");
  });

  it("sorts database clients before sheet-only clients", () => {
    const merged = mergeMappingClients(
      [
        {
          ...systemClient,
          id: "z-system",
          name: "Z System"
        }
      ],
      [
        {
          clientId: "A Sheet Only",
          status: "Active",
          serviceStatus: "Pitching"
        }
      ]
    );

    expect(merged.map((client) => client.name)).toEqual([
      "Z System",
      "A Sheet Only"
    ]);
  });
});
