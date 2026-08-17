import {
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useReducer } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrandMemoryProvider } from "../../app/providers/brand-memory-provider";
import { MockBrandMemoryRepository } from "../../repositories/brand-memory/mock-brand-memory-repository";
import { createInitialWorkflowState, workflowReducer } from "./reducer";
import { DirectionsStage } from "./stages";
import { BriefConfirmationModal } from "./stages/brief-confirmation-modal";
import { HookGenerationModelSelect } from "./stages/shared";
import { buildDirectionFixtures } from "./test-fixtures";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function StatefulHookModelPicker() {
  const [state, dispatch] = useReducer(
    workflowReducer,
    createInitialWorkflowState({
      id: "hook-model-picker-run",
      now: "2026-08-11T08:00:00.000Z"
    })
  );
  return (
    <HookGenerationModelSelect
      disabled={false}
      state={state}
      dispatch={dispatch}
    />
  );
}

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

    const hookModelPicker = screen.getByLabelText("Hook generation models");
    expect(hookModelPicker.textContent).toContain("Gemini 3.6 Flash");
    await user.click(hookModelPicker);
    expect(screen.queryByText("Compass New")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Browse OpenRouter models" })
        .getAttribute("href")
    ).toBe("https://openrouter.ai/models");
    await user.type(
      screen.getByRole("textbox", { name: "OpenRouter model ID" }),
      "sakana/sakana-namazu"
    );
    await user.click(screen.getByRole("button", { name: "Add model" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "set-hook-generation-models",
      models: [
        "google/gemini-3.6-flash",
        "sakana/sakana-namazu"
      ]
    });
    fireEvent.pointerDown(document.body);
    expect(
      screen.queryByRole("group", { name: "Hook models" })
    ).toBeNull();
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

    const ideaIntent = screen.getByRole("combobox", {
      name: "Idea intent"
    }) as HTMLSelectElement;
    expect(ideaIntent.value).toBe("explore");
    await user.selectOptions(ideaIntent, "performance-iteration");
    expect(dispatch).toHaveBeenCalledWith({
      type: "set-idea-intent",
      intent: "performance-iteration"
    });

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

  it("saves added Hook models separately from per-run selection", async () => {
    const user = userEvent.setup();
    const firstView = render(<StatefulHookModelPicker />);

    await user.click(screen.getByLabelText("Hook generation models"));
    await user.type(
      screen.getByRole("textbox", { name: "OpenRouter model ID" }),
      "sakana/sakana-namazu"
    );
    await user.click(screen.getByRole("button", { name: "Add model" }));
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Unselect sakana/sakana-namazu"
        }) as HTMLInputElement
      ).checked
    ).toBe(true);

    await user.click(
      screen.getByRole("checkbox", {
        name: "Unselect sakana/sakana-namazu"
      })
    );
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Select sakana/sakana-namazu"
        }) as HTMLInputElement
      ).checked
    ).toBe(false);

    firstView.unmount();
    render(<StatefulHookModelPicker />);
    await user.click(screen.getByLabelText("Hook generation models"));
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Select sakana/sakana-namazu"
        }) as HTMLInputElement
      ).checked
    ).toBe(false);
  });

  it("presents a saved non-visible artwork mode as Standard", () => {
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
      screen.getByRole("button", { name: "Standard" }).getAttribute(
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
