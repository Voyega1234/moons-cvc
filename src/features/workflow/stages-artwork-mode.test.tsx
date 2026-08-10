import {
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrandMemoryProvider } from "../../app/providers/brand-memory-provider";
import { MockBrandMemoryRepository } from "../../repositories/brand-memory/mock-brand-memory-repository";
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
      artworkMode: "design-system" as const,
      directions: buildDirectionFixtures("BoneFit")
    };

    const directionsView = render(
      <BrandMemoryProvider repository={new MockBrandMemoryRepository()}>
        <DirectionsStage state={state} dispatch={dispatch} />
      </BrandMemoryProvider>
    );

    const hookModel = screen.getByRole("combobox", {
      name: "Hook generation model"
    }) as HTMLSelectElement;
    expect(hookModel.value).toBe("google/gemini-3.6-flash");
    expect(hookModel.selectedOptions[0]?.textContent).toBe("OpenRouter");
    expect(
      within(hookModel).getByRole("option", { name: "n8n · Compass New" })
    ).toBeTruthy();
    await user.selectOptions(hookModel, "gpt-5.6-terra");
    expect(dispatch).toHaveBeenCalledWith({
      type: "set-hook-generation-model",
      model: "gpt-5.6-terra"
    });
    await user.selectOptions(hookModel, "n8n-compass-new");
    expect(dispatch).toHaveBeenCalledWith({
      type: "set-hook-generation-model",
      model: "n8n-compass-new"
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
      screen.getByRole("button", { name: "Design system" }).getAttribute(
        "aria-pressed"
      )
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Design system (new)" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Final artwork" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Standard" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "set-artwork-mode",
      mode: "standard"
    });

    expect(
      screen.queryByRole("combobox", { name: "Creative concept model" })
    ).toBeNull();

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

  it("presents a saved non-visible artwork mode as Design system", () => {
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

    expect(
      screen.getByRole("button", { name: "Design system" }).getAttribute(
        "aria-pressed"
      )
    ).toBe("true");
    expect(dispatch).not.toHaveBeenCalled();
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
      artworkMode: "design-system" as const,
      directions: buildDirectionFixtures("BoneFit")
    };

    const view = render(
      <BrandMemoryProvider repository={new MockBrandMemoryRepository()}>
        <DirectionsStage state={state} dispatch={vi.fn()} />
      </BrandMemoryProvider>
    );
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

  it("hides the concept-model control for a saved hidden mode", () => {
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

    expect(
      screen.queryByRole("combobox", { name: "Creative concept model" })
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Standard" })).toBeTruthy();
  });

  it("shows Standard as a direct GPT Image 2 route without a concept-model control", () => {
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

    expect(
      screen.getByText(
        "agent_image.md + Campaign input → GPT Image 2 → Visual QC"
      )
    ).toBeTruthy();
    expect(
      screen.queryByRole("combobox", { name: "Creative concept model" })
    ).toBeNull();
  });

  it("presents a saved Final artwork mode as Standard", () => {
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

    expect(
      screen.getByText(
        "agent_image.md + Campaign input → GPT Image 2 → Visual QC"
      )
    ).toBeTruthy();
    expect(
      screen.queryByRole("combobox", { name: "Creative concept model" })
    ).toBeNull();
  });
});
