import { describe, expect, it } from "vitest";
import { brands } from "../data/mock-brands";
import { filterBrandsForAccess } from "./client-access";

describe("client access", () => {
  it("shows the complete client portfolio in the current all-client mode", () => {
    expect(filterBrandsForAccess(brands, { kind: "all" })).toEqual(brands);
  });

  it("can restrict the same portfolio to assigned clients later", () => {
    const first = brands[0];
    if (!first) throw new Error("Mock brand fixture is missing.");

    expect(
      filterBrandsForAccess(brands, {
        kind: "assigned",
        clientIds: [first.id]
      }).map((brand) => brand.id)
    ).toEqual([first.id]);
  });
});
