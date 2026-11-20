import { useReducer } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { brands } from "../../../data/mock-brands";
import { createInitialWorkflowState, workflowReducer } from "../reducer";
import { buildDirectionFixtures } from "../test-fixtures";
import * as slides from "../export-client-slides-pptx";
import * as artwork from "../../../services/artwork-generation/openai-image-generation";
import { StudioStage } from "./studio-stage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each([
  [false, false], [true, false], [false, true], [true, true]
])("exports placeholders without changing website artwork (album: %s, export fails: %s)", async (album, fails) => {
  const user = userEvent.setup();
  const brand = brands[0]!;
  let initial = createInitialWorkflowState({ id: "placeholder-export", now: "2026-11-20T00:00:00Z" });
  initial = workflowReducer(initial, { type: "select-brand", brand });
  initial = workflowReducer(initial, { type: "generate-directions", directions: buildDirectionFixtures(brand.name) });
  initial = workflowReducer(initial, { type: "auto-select-directions" });
  initial = workflowReducer(initial, { type: "create-outputs" });
  const source = initial.outputs[0]!;
  initial = {
    ...initial,
    outputs: Array.from({ length: album ? 3 : 1 }, (_, index) => ({
      ...source,
      id: `${source.directionId}-album-${index + 1}-v1`,
      format: album ? "Album post" : "Static ad",
      assetUrl: `https://storage.example.com/original-${index}.png`,
      assetStoragePath: `original-${index}.png`,
      ...(album ? { albumMasterAssetUrl: "https://storage.example.com/original-master.png" } : {})
    }))
  };
  const originals = structuredClone(initial.outputs);
  const placeholders = initial.outputs.map((output, index) => ({
    ...output,
    assetUrl: `https://storage.example.com/placeholder-${index}.png`,
    assetStoragePath: `placeholder-${index}.png`,
    ...(album ? { albumMasterAssetUrl: "https://storage.example.com/placeholder-master.png" } : {})
  }));
  const single = vi.spyOn(artwork, "placeholderizeOutputImage").mockResolvedValue(placeholders[0]!);
  const panels = vi.spyOn(artwork, "placeholderizeAlbumOutputImages").mockResolvedValue(placeholders);
  const exportSlides = vi.spyOn(slides, "openCreateStageSlidesInGoogleSlides");
  if (fails) exportSlides.mockRejectedValue(new Error("Slides import failed"));
  else exportSlides.mockResolvedValue({ url: "https://docs.google.com/presentation/d/test/edit", id: "test", name: "Placeholder deck" });
  vi.spyOn(window, "open").mockImplementation(() => null);
  const dispatchSpy = vi.fn();
  function Flow() {
    const [state, dispatch] = useReducer(workflowReducer, initial);
    return <StudioStage state={state} dispatch={(action) => { dispatchSpy(action); dispatch(action); }} />;
  }
  const view = render(<Flow />);
  await user.click(screen.getByRole("button", { name: "Export" }));
  await user.click(screen.getByRole("button", { name: "Export to Slides (Placeholder)" }));
  await waitFor(() => expect(exportSlides).toHaveBeenCalledOnce());
  const exported = exportSlides.mock.calls[0]![0];
  expect(exported.outputs.map((output) => output.assetUrl)).toEqual(placeholders.map((output) => output.assetUrl));
  expect(exported.outputs.every((output) => output.isPlaceholder)).toBe(true);
  if (album) {
    expect(panels).toHaveBeenCalledOnce();
    expect(single).not.toHaveBeenCalled();
    expect(exported.outputs[0]?.albumMasterAssetUrl).toBe(placeholders[0]?.albumMasterAssetUrl);
  } else {
    expect(single).toHaveBeenCalledOnce();
    expect(panels).not.toHaveBeenCalled();
  }
  expect(dispatchSpy).not.toHaveBeenCalled();
  expect(initial.outputs).toEqual(originals);
  const displayedImage = album ? originals[0]!.albumMasterAssetUrl : originals[0]!.assetUrl;
  expect(view.container.querySelector(`img[src="${displayedImage}"]`)).toBeTruthy();
  if (fails) expect(await screen.findByText("Slides import failed")).toBeTruthy();
  else {
    await screen.findByRole("link", { name: "Open the presentation" });
    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("button", { name: "Export to Slides" }));
    await waitFor(() => expect(exportSlides).toHaveBeenCalledTimes(2));
    expect(exportSlides.mock.calls[1]![0].outputs).toEqual(originals);
  }
});
