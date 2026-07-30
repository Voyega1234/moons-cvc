import {
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialWorkflowState } from "./reducer";
import { DirectionsStage } from "./stages";
import { BriefConfirmationModal } from "./stages/brief-confirmation-modal";
import { buildDirectionFixtures } from "./test-fixtures";

afterEach(cleanup);

describe("Artwork generation settings", () => {
  it("keeps hook generation controls on Hook and moves artwork controls into confirmation", async () => {
    const user = userEvent.setup();
    const dispatch = vi.fn();
    const state = {
      ...createInitialWorkflowState({
        id: "run-1",
        now: "2026-07-10T00:00:00.000Z"
      }),
      stage: "directions" as const,
      directions: buildDirectionFixtures("BoneFit")
    };

    const directionsView = render(
      <DirectionsStage state={state} dispatch={dispatch} />
    );

    const hookModel = screen.getByRole("combobox", {
      name: "Hook generation model"
    }) as HTMLSelectElement;
    expect(hookModel.value).toBe("gpt-5.6-terra");
    expect(hookModel.selectedOptions[0]?.textContent).toBe("GPT · OpenAI");
    await user.selectOptions(hookModel, "anthropic/claude-sonnet-4.6");
    expect(dispatch).toHaveBeenCalledWith({
      type: "set-hook-generation-model",
      model: "anthropic/claude-sonnet-4.6"
    });
    expect(
      screen.queryByRole("button", { name: "Reference library" })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Design system" })
    ).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: "Creative concept model" })
    ).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Output size" })).toBeNull();

    directionsView.unmount();
    render(
      <BriefConfirmationModal
        open
        state={state}
        dispatch={dispatch}
        references={[]}
        uploadPending={false}
        uploadError={null}
        onUploadReference={vi.fn()}
        materialBrowser={null}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(
      screen.getByRole("button", { name: "Standard" }).getAttribute(
        "aria-pressed"
      )
    ).toBe("false");
    expect(
      screen.getByRole("button", { name: "Design system" }).getAttribute(
        "aria-pressed"
      )
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Design system (new)" }).getAttribute(
        "aria-pressed"
      )
    ).toBe("false");
    await user.click(
      screen.getByRole("button", { name: "Design system (new)" })
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "set-artwork-mode",
      mode: "design-system-new"
    });
    await user.click(
      screen.getByRole("button", { name: "Final artwork" })
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "set-artwork-mode",
      mode: "direct-final-artwork"
    });
    await user.click(screen.getByRole("button", { name: "Standard" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "set-artwork-mode",
      mode: "standard"
    });

    const pathSelect = screen.getByRole("combobox", {
      name: "Creative concept model"
    }) as HTMLSelectElement;
    expect(pathSelect.disabled).toBe(false);
    expect(pathSelect.selectedOptions[0]?.textContent).toBe(
      "GPT · OpenAI → GPT Image 2"
    );
    await user.selectOptions(pathSelect, "anthropic/claude-sonnet-4.6");
    expect(dispatch).toHaveBeenCalledWith({
      type: "set-image-prompt-model",
      model: "anthropic/claude-sonnet-4.6"
    });

    const sizeSelect = screen.getByRole("combobox", {
      name: "Output size"
    }) as HTMLSelectElement;
    expect(sizeSelect.value).toBe("1088x1360");

    await user.selectOptions(sizeSelect, "3840x2160");
    expect(dispatch).toHaveBeenCalledWith({
      type: "set-output-size",
      size: "3840x2160"
    });

    const artworkBrief = screen.getByRole("textbox", {
      name: "Artwork brief"
    }) as HTMLTextAreaElement;
    expect(artworkBrief.value).toBe("");
    expect(artworkBrief.maxLength).toBe(3000);
    fireEvent.change(
      artworkBrief,
      {
        target: {
          value:
            "Use one natural window light and avoid visible scent effects."
        }
      }
    );
    expect(dispatch).toHaveBeenLastCalledWith({
      type: "set-artwork-brief",
      brief: "Use one natural window light and avoid visible scent effects."
    });
  });

  it("moves a saved non-visible artwork mode to Design System", () => {
    const dispatch = vi.fn();
    const state = {
      ...createInitialWorkflowState({
        id: "run-1",
        now: "2026-07-10T00:00:00.000Z"
      }),
      stage: "directions" as const,
      artworkMode: "reference-library" as const,
      directions: buildDirectionFixtures("BoneFit")
    };

    render(
      <BriefConfirmationModal
        open
        state={state}
        dispatch={dispatch}
        references={[]}
        uploadPending={false}
        uploadError={null}
        onUploadReference={vi.fn()}
        materialBrowser={null}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(dispatch).toHaveBeenCalledWith({
      type: "set-artwork-mode",
      mode: "design-system"
    });
  });

  it("keeps Standard mode visible and selected when it is saved", () => {
    const dispatch = vi.fn();
    const state = {
      ...createInitialWorkflowState({
        id: "run-1",
        now: "2026-07-10T00:00:00.000Z"
      }),
      stage: "directions" as const,
      artworkMode: "standard" as const,
      directions: buildDirectionFixtures("BoneFit")
    };

    render(
      <BriefConfirmationModal
        open
        state={state}
        dispatch={dispatch}
        references={[]}
        uploadPending={false}
        uploadError={null}
        onUploadReference={vi.fn()}
        materialBrowser={null}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(
      screen.getByRole("button", { name: "Standard" }).getAttribute(
        "aria-pressed"
      )
    ).toBe("true");
    expect(dispatch).not.toHaveBeenCalledWith({
      type: "set-artwork-mode",
      mode: "design-system"
    });
  });

  it("opens Regenerate hooks with one tone field for the full Hook set", async () => {
    const user = userEvent.setup();
    const state = {
      ...createInitialWorkflowState({
        id: "run-1",
        now: "2026-07-10T00:00:00.000Z"
      }),
      stage: "directions" as const,
      directions: buildDirectionFixtures("BoneFit")
    };

    const view = render(<DirectionsStage state={state} dispatch={vi.fn()} />);
    const stage = within(view.container);

    await user.click(
      stage.getByRole("button", { name: "↻ Regenerate hooks" })
    );

    const dialog = stage.getByRole("dialog", {
      name: `Change the tone across all ${state.directions.length} hooks`
    });

    expect(
      within(dialog).getByRole("heading", {
        name: `Change the tone across all ${state.directions.length} hooks`
      })
    ).toBeTruthy();
    expect(within(dialog).getByLabelText("New writing tone")).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: "↻ Regenerate hooks" })
    ).toHaveProperty("disabled", true);
  });

  it("shows the selectable art direction model in confirmation", () => {
    const state = {
      ...createInitialWorkflowState({
        id: "run-1",
        now: "2026-07-10T00:00:00.000Z"
      }),
      stage: "directions" as const,
      artworkMode: "design-system" as const,
      directions: buildDirectionFixtures("BoneFit")
    };

    render(
      <BriefConfirmationModal
        open
        state={state}
        dispatch={vi.fn()}
        references={[]}
        uploadPending={false}
        uploadError={null}
        onUploadReference={vi.fn()}
        materialBrowser={null}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const pathSelect = screen.getByRole("combobox", {
      name: "Creative concept model"
    }) as HTMLSelectElement;
    expect(pathSelect.disabled).toBe(false);
    expect(pathSelect.selectedOptions[0]?.textContent).toBe(
      "GPT · OpenAI → GPT Image 2"
    );
    expect(screen.getByText("Creative concept model")).toBeTruthy();
  });

  it("shows the direct GPT Image 2 route without a concept-model control", () => {
    const state = {
      ...createInitialWorkflowState({
        id: "run-1",
        now: "2026-07-10T00:00:00.000Z"
      }),
      stage: "directions" as const,
      artworkMode: "direct-final-artwork" as const,
      directions: buildDirectionFixtures("BoneFit")
    };

    render(
      <BriefConfirmationModal
        open
        state={state}
        dispatch={vi.fn()}
        references={[]}
        uploadPending={false}
        uploadError={null}
        onUploadReference={vi.fn()}
        materialBrowser={null}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText("Hook JSON → GPT Image 2")).toBeTruthy();
    expect(
      screen.queryByRole("combobox", { name: "Creative concept model" })
    ).toBeNull();
  });
});
