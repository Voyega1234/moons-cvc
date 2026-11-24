import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createInitialWorkflowState } from "../reducer";
import { buildDirectionFixtures } from "../test-fixtures";
import { HookMaterialImage } from "./hook-material-image";
import { HookReferenceImage } from "./hook-reference-image";

afterEach(cleanup);

const run = createInitialWorkflowState({ id: "r", now: "2026-11-24T00:00:00Z" });
const base = buildDirectionFixtures("Acme")[0]!;
const material = (id: string) => ({ id, name: `${id}.png`, mediaType: "image/png", role: "main-object" as const, description: "", url: `https://x/${id}.png` });
const reference = (id: string) => ({ id, url: `https://x/${id}.png`, label: id, role: "style" as const });

it("clears every attached material on a hook card in one click", async () => {
  const dispatch = vi.fn();
  const direction = { ...base, id: "d1", uploadedMaterials: [material("a"), material("b")] };
  render(<HookMaterialImage run={run} direction={direction} dispatch={dispatch} />);
  await userEvent.click(screen.getByRole("button", { name: /Clear all materials/ }));
  expect(dispatch).toHaveBeenCalledWith({ type: "set-direction-uploaded-materials", id: "d1", materials: [] });
});

it("clears every attached reference on a hook card in one click", async () => {
  const dispatch = vi.fn();
  const direction = { ...base, id: "d1", referenceImages: [reference("a"), reference("b")] };
  render(<HookReferenceImage run={run} direction={direction} dispatch={dispatch} />);
  await userEvent.click(screen.getByRole("button", { name: /Clear all references/ }));
  expect(dispatch).toHaveBeenCalledWith({ type: "set-direction-reference-images", id: "d1", images: [] });
});

it("shows no Clear all button when nothing is attached", () => {
  const direction = { ...base, id: "d1", uploadedMaterials: [], referenceImages: [] };
  render(<><HookMaterialImage run={run} direction={direction} dispatch={vi.fn()} /><HookReferenceImage run={run} direction={direction} dispatch={vi.fn()} /></>);
  expect(screen.queryByRole("button", { name: /Clear all/ })).toBeNull();
});
