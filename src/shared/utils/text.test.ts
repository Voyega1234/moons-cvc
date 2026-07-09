import { describe, expect, it } from "vitest";
import { interpolate, pluralize, slugify } from "./text";

describe("text utilities", () => {
  it("creates stable slugs", () => {
    expect(slugify("Brand Guideline.pdf")).toBe("brand-guideline-pdf");
  });

  it("interpolates shared templates", () => {
    expect(interpolate("{brand}: {product}", {
      brand: "BoneFit",
      product: "Posture support"
    })).toBe("BoneFit: Posture support");
  });

  it("pluralizes simple labels", () => {
    expect(pluralize(1, "file")).toBe("file");
    expect(pluralize(2, "file")).toBe("files");
  });
});
