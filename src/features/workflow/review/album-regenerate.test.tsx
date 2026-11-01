import { useReducer } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { OutputGrid } from "./output-grid";
import { createInitialWorkflowState, workflowReducer } from "../reducer";
import { buildDirectionFixtures } from "../test-fixtures";
import { emptyApprovalComments, emptyApprovalGate } from "../../../domain/creative-run";
import { reviseAlbumOutputImages } from "../../../services/artwork-generation/openai-image-generation";

vi.mock("../../../services/artwork-generation/openai-image-generation", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../services/artwork-generation/openai-image-generation")>(),
  reviseAlbumOutputImages: vi.fn()
}));
vi.mock("../../../shared/utils/notification-sound", () => ({ playGenerationSuccessSound: vi.fn() }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function albumState() {
  const base = createInitialWorkflowState({ id: "album-run", now: "2026-11-01T00:00:00.000Z" });
  const direction = { ...buildDirectionFixtures("Brand")[0]!, service: "album-post" as const, albumFormat: "three-horizontal" as const };
  return {
    ...base,
    directions: [direction],
    outputs: [1, 2, 3].map((index) => ({
      id: `${direction.id}-album-${index}-v1`, directionId: direction.id,
      format: "Album post", status: "draft" as const, clientStatus: "queued" as const,
      assetUrl: `https://example.com/panel-${index}.png`,
      albumMasterAssetUrl: "https://example.com/master-v1.png",
      revisionCount: 0, approval: emptyApprovalGate, approvalComments: emptyApprovalComments
    }))
  };
}

it("selects individual panels, blocks an empty selection, and supports selecting all", async () => {
  const user = userEvent.setup();
  render(<OutputGrid state={albumState()} dispatch={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Regenerate draft" }));
  const dialog = within(screen.getByRole("dialog", { name: "Regenerate album" }));
  const cover = dialog.getByRole("checkbox", { name: "Regenerate image 1 (cover)" }) as HTMLInputElement;
  expect(cover.checked).toBe(true);
  await user.type(dialog.getByRole("textbox", { name: "Regeneration instructions" }), "Change the background");
  await user.click(cover);
  expect((dialog.getByRole("button", { name: "Regenerate album" }) as HTMLButtonElement).disabled).toBe(true);
  await user.keyboard("{Enter}");
  expect(reviseAlbumOutputImages).not.toHaveBeenCalled();
  await user.click(dialog.getByRole("checkbox", { name: "Regenerate image 2" }));
  expect((dialog.getByRole("button", { name: "Regenerate album" }) as HTMLButtonElement).disabled).toBe(false);
  await user.click(dialog.getByRole("button", { name: "Select all" }));
  expect(dialog.getAllByRole("checkbox").every((input) => (input as HTMLInputElement).checked)).toBe(true);
  await user.click(dialog.getByRole("button", { name: "Deselect all" }));
  expect(dialog.getAllByRole("checkbox").every((input) => !(input as HTMLInputElement).checked)).toBe(true);
});

it("revises only the chosen panel and restores the complete previous album version", async () => {
  const user = userEvent.setup();
  const initial = albumState();
  const revised = initial.outputs.map((panel, index) => ({
    ...panel,
    assetUrl: index === 1 ? "https://example.com/revised-panel-2.png" : panel.assetUrl,
    albumMasterAssetUrl: "https://example.com/master-v2.png"
  }));
  vi.mocked(reviseAlbumOutputImages).mockResolvedValueOnce(revised);
  function Album() {
    const [state, dispatch] = useReducer(workflowReducer, initial);
    return <OutputGrid state={state} dispatch={dispatch} />;
  }
  render(<Album />);
  await user.click(screen.getByRole("button", { name: "Regenerate draft" }));
  const dialog = within(screen.getByRole("dialog", { name: "Regenerate album" }));
  await user.click(dialog.getByRole("checkbox", { name: "Regenerate image 1 (cover)" }));
  await user.click(dialog.getByRole("checkbox", { name: "Regenerate image 2" }));
  await user.type(dialog.getByRole("textbox", { name: "Regeneration instructions" }), "Make the background blue");
  await user.click(dialog.getByRole("button", { name: "Regenerate album" }));
  await waitFor(() => expect(reviseAlbumOutputImages).toHaveBeenCalledWith(expect.objectContaining({
    selectedOutputIds: [initial.outputs[1]!.id], outputs: initial.outputs
  })));
  await dialog.findByText("Version 2 is ready.");
  const panelThumbnails = () => dialog.getAllByRole("checkbox").map((input) => input.closest("label")!.querySelector("img")!.src);
  expect(panelThumbnails()).toEqual(revised.map((panel) => panel.assetUrl));
  await user.click(dialog.getByRole("button", { name: "Restore version 1 as the current draft" }));
  await waitFor(() => expect(panelThumbnails()).toEqual(initial.outputs.map((panel) => panel.assetUrl)));
  expect((dialog.getByRole("checkbox", { name: "Regenerate image 2" }) as HTMLInputElement).checked).toBe(true);
});

it("keeps the selection and instructions available after a failed revision", async () => {
  const user = userEvent.setup();
  const dispatch = vi.fn();
  vi.mocked(reviseAlbumOutputImages).mockRejectedValueOnce(new Error("Image service unavailable"));
  render(<OutputGrid state={albumState()} dispatch={dispatch} />);
  await user.click(screen.getByRole("button", { name: "Regenerate draft" }));
  const dialog = within(screen.getByRole("dialog", { name: "Regenerate album" }));
  await user.type(dialog.getByRole("textbox", { name: "Regeneration instructions" }), "Blue background");
  await user.click(dialog.getByRole("button", { name: "Regenerate album" }));
  await dialog.findByText("Image service unavailable");
  expect(dispatch).not.toHaveBeenCalled();
  expect((dialog.getByRole("textbox", { name: "Regeneration instructions" }) as HTMLTextAreaElement).value).toBe("Blue background");
  expect((dialog.getByRole("checkbox", { name: "Regenerate image 1 (cover)" }) as HTMLInputElement).checked).toBe(true);
});
