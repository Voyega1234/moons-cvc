import { describe, expect, it } from "vitest";
import type { Brand } from "../../domain/brand";
import {
  mergeMappingClients,
  normalizeClientKey
} from "./merge-mapping-clients";

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
          serviceStatus: "Pitching",
          clientPortalUrl: "https://docs.google.com/spreadsheets/new-client"
        }
      ]
    );

    const bonefit = merged.find((client) => client.name === "BoneFit");
    const newClient = merged.find((client) => client.name === "New Client");

    expect(bonefit?.existsInSystem).toBe(true);
    expect(bonefit?.mappingStatus).toBe("Active");
    expect(newClient?.existsInSystem).toBe(false);
    expect(newClient?.source).toBe("mapping");
    expect(newClient?.mappingClientPortalUrl).toBe(
      "https://docs.google.com/spreadsheets/new-client"
    );
  });

  it("exposes mapped Facebook pages for existing and new clients without replacing saved pages", () => {
    const merged = mergeMappingClients(
      [{ ...systemClient, facebookUrl: "https://www.facebook.com/saved" }],
      [
        { clientId: "BoneFit", status: "Active", serviceStatus: "Active", facebookPage1Url: "https://www.facebook.com/mapped" },
        { clientId: "New", status: "Active", serviceStatus: "Active", facebookPage1Url: "https://www.facebook.com/new" }
      ]
    );
    expect(merged[0]).toMatchObject({ facebookUrl: "https://www.facebook.com/saved", mappingFacebookPage1Url: "https://www.facebook.com/mapped" });
    expect(merged[1]?.mappingFacebookPage1Url).toBe("https://www.facebook.com/new");
    expect(mergeMappingClients([systemClient], [{ clientId: "BoneFit", status: "Active", serviceStatus: "Active" }])[0]?.mappingFacebookPage1Url).toBeUndefined();
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

  it("matches punctuation variants without creating a sheet-only duplicate", () => {
    const merged = mergeMappingClients(
      [{ ...systemClient, id: "aklass", name: "A Klass Auto" }],
      [
        {
          clientId: "A-Klass Auto",
          status: "Inactive",
          serviceStatus: "Inactive"
        }
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "aklass",
      name: "A Klass Auto",
      existsInSystem: true,
      mappingStatus: "Inactive"
    });
    expect(normalizeClientKey("A-Klass Auto")).toBe(
      normalizeClientKey("A Klass Auto")
    );
  });
});
