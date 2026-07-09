import { describe, expect, it } from "vitest";
import { canSelectBrand, canStartBrandIngestion, type Brand } from "./brand";
import { initialsFromClientName, validateFacebookUrl } from "./client-ingestion";

const brand: Brand = {
  id: "client-1",
  name: "Client One",
  category: "Category",
  initials: "CO",
  library: { brand: [], products: [], docs: [], refs: [] },
  memory: { working: [], avoid: [] },
  existsInSystem: true,
  source: "system"
};

describe("client ingestion domain rules", () => {
  it("requires valid Facebook URLs", () => {
    expect(validateFacebookUrl("")).toBe("Facebook URL is required.");
    expect(validateFacebookUrl("not a url")).toBe("Enter a valid Facebook URL.");
    expect(validateFacebookUrl("https://example.com/page")).toBe(
      "Enter a Facebook page URL."
    );
    expect(validateFacebookUrl("https://www.facebook.com/example")).toBeNull();
    expect(validateFacebookUrl("https://fb.com/example")).toBeNull();
  });

  it("only selects clients after ingestion has produced memory", () => {
    expect(canSelectBrand({ ...brand, ingestionStatus: "queued" })).toBe(false);
    expect(canSelectBrand({ ...brand, ingestionStatus: "draft" })).toBe(false);
    expect(canSelectBrand({ ...brand, ingestionStatus: "failed" })).toBe(false);
    expect(canSelectBrand({ ...brand, ingestionStatus: "ready" })).toBe(true);
    expect(
      canSelectBrand({ ...brand, ingestionStatus: "needs_review" })
    ).toBe(true);
    expect(canSelectBrand({ ...brand, ingestionStatus: "not_started" })).toBe(
      false
    );
    expect(canSelectBrand(brand)).toBe(true);
  });

  it("allows setup for existing clients that have not completed ingestion", () => {
    expect(
      canStartBrandIngestion({ ...brand, ingestionStatus: "not_started" })
    ).toBe(true);
    expect(
      canStartBrandIngestion({ ...brand, ingestionStatus: "failed" })
    ).toBe(true);
    expect(
      canStartBrandIngestion({ ...brand, ingestionStatus: "queued" })
    ).toBe(false);
    expect(
      canStartBrandIngestion({
        ...brand,
        existsInSystem: false,
        ingestionStatus: "not_started"
      })
    ).toBe(false);
  });

  it("creates usable initials from client names", () => {
    expect(initialsFromClientName("Meisaku Premium Yakiniku")).toBe("MP");
    expect(initialsFromClientName("")).toBe("CL");
  });
});
