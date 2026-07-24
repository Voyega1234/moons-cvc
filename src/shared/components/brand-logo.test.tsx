import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Brand } from "../../domain/brand";
import { BrandLogo } from "./brand-logo";

const brand: Brand = {
  id: "brand-1",
  name: "Centre Point Group",
  category: "Hospitality",
  initials: "CP",
  library: {
    brand: [
      {
        id: "logo-1",
        title: "Logo",
        description: "",
        assetUrl: "https://storage.example.com/expired-logo.png"
      }
    ],
    products: [],
    docs: [],
    refs: []
  },
  memory: { working: [], avoid: [] }
};

describe("BrandLogo", () => {
  it("shows brand initials when the stored image cannot load", () => {
    const view = render(<BrandLogo brand={brand} />);
    const image = view.container.querySelector("img");
    expect(image).not.toBeNull();

    fireEvent.error(image!);

    expect(view.getByText("CP")).toBeTruthy();
    expect(view.container.querySelector("img")).toBeNull();
  });
});
