import { expect, it } from "vitest";
import { assetFolderPath } from "./material-ai";

const folder = (id: string, name: string, parentId: string | null) => ({ id, clientId: "c", parentId, kind: "material" as const, name });

it("builds the nested folder path and is empty at the library root", () => {
  const folders = [folder("a", "Products", null), folder("b", "Serum", "a")];
  expect(assetFolderPath("b", folders)).toBe("Products / Serum");
  expect(assetFolderPath(null, folders)).toBe("");
  expect(assetFolderPath("missing", folders)).toBe("");
});

it("does not loop forever on a corrupt folder cycle", () => {
  const folders = [folder("a", "A", "b"), folder("b", "B", "a")];
  expect(assetFolderPath("a", folders)).toBe("B / A");
});
