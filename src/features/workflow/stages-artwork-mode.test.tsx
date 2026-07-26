import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createInitialWorkflowState } from "./reducer";
import { DirectionsStage } from "./stages";
import { buildDirectionFixtures } from "./test-fixtures";

describe("DirectionsStage artwork mode", () => {
  it("shows only Design System and keeps it as the active generation mode", async () => {
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

    render(<DirectionsStage state={state} dispatch={dispatch} />);

    expect(
      screen.getByRole("button", { name: "Design system" }).getAttribute(
        "aria-pressed"
      )
    ).toBe("true");
    const hookMode = within(
      screen.getByRole("group", { name: "Hook idea mode" })
    );
    expect(
      hookMode
        .getByRole("button", { name: "Standard" })
        .getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      hookMode.queryByRole("button", { name: "Fresh research" })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Reference library" })
    ).toBeNull();

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

    render(<DirectionsStage state={state} dispatch={dispatch} />);

    expect(dispatch).toHaveBeenCalledWith({
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

  it("shows the selectable art direction model in the Design System path", () => {
    const state = {
      ...createInitialWorkflowState({
        id: "run-1",
        now: "2026-07-10T00:00:00.000Z"
      }),
      stage: "directions" as const,
      artworkMode: "design-system" as const,
      directions: buildDirectionFixtures("BoneFit")
    };

    const view = render(<DirectionsStage state={state} dispatch={vi.fn()} />);
    const stage = within(view.container);

    const pathSelect = stage.getByRole("combobox", {
      name: "Creative concept model"
    }) as HTMLSelectElement;
    expect(pathSelect.disabled).toBe(false);
    expect(pathSelect.selectedOptions[0]?.textContent).toBe(
      "GPT · OpenAI → GPT Image 2"
    );
    expect(stage.getByText("Creative concept model")).toBeTruthy();
  });
});
