import { expect, it } from "vitest";
import { buildCampaignArtifactRole, buildRequiredMainObjectInstruction } from "./prompt-context";
import { PEOPLE_PHOTO_PREFIX } from "../../domain/people-photos";

it("does not turn people-library photos into required product/logo material based on their filename", () => {
  const label = `${PEOPLE_PHOTO_PREFIX}woman holding product with logo.jpg`;
  const role = buildCampaignArtifactRole({ bytes: Buffer.from("person"), mimeType: "image/jpeg", label }, 2);
  expect(role.kind).toBe("reference");
  expect(role.instruction).toContain("Optional real-person casting source only");
  expect(buildRequiredMainObjectInstruction([label])).toBe("");
});

it("requires every selected main object, preserving image numbers without requiring duplicate products", () => {
  const labels = [
    "Official logo",
    "Hook reference · Style · Inspiration",
    "Uploaded main object (use as the hero/source object): serum-front.png",
    "Uploaded main object (use as the hero/source object): serum-dropper.png",
    "Uploaded main object (use as the hero/source object): serum-side.png",
    "Uploaded main object (use as the hero/source object): gel.png",
    "Uploaded supporting component: leaf.png"
  ];
  const instruction = buildRequiredMainObjectInstruction(labels);
  for (let index = 2; index < 6; index++) expect(instruction).toContain(`Image ${index + 1}: ${labels[index]}`);
  expect(instruction).toContain("Every distinct object/product");
  expect(instruction).toContain("without duplicating that product");
  expect(instruction).not.toContain("Inspiration");
  expect(instruction).not.toContain("leaf.png");
});

it("does not make styles, optional products, or supporting materials mandatory", () => {
  expect(buildRequiredMainObjectInstruction([
    "Official logo", "Uploaded product: serum.png", "Uploaded supporting component: leaf.png", "Hook reference · Style · collage.png"
  ])).toBe("");
});
