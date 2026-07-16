import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createInitialWorkflowState } from "./reducer";
import { DirectionsStage } from "./stages";
import { buildDirectionFixtures } from "./test-fixtures";

describe("DirectionsStage artwork mode", () => {
  it("shows Standard by default and dispatches artwork mode selections", async () => {
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
      screen.getByRole("button", { name: "Standard" }).getAttribute(
        "aria-pressed"
      )
    ).toBe("true");

    await user.click(screen.getByRole("button", { name: "Design system" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "set-artwork-mode",
      mode: "design-system"
    });

    await user.click(
      screen.getByRole("button", { name: "Reference library" })
    );

    expect(dispatch).toHaveBeenCalledWith({
      type: "set-artwork-mode",
      mode: "reference-library"
    });

    const modelSelect = screen.getByRole("combobox", {
      name: "Image prompt model"
    }) as HTMLSelectElement;
    expect(modelSelect.value).toBe("gpt-5.6-terra");

    await user.selectOptions(modelSelect, "anthropic/claude-sonnet-4.6");
    expect(dispatch).toHaveBeenCalledWith({
      type: "set-image-prompt-model",
      model: "anthropic/claude-sonnet-4.6"
    });

    const sizeSelect = screen.getByRole("combobox", {
      name: "Output size"
    }) as HTMLSelectElement;
    expect(sizeSelect.value).toBe("1024x1024");

    await user.selectOptions(sizeSelect, "3840x2160");
    expect(dispatch).toHaveBeenCalledWith({
      type: "set-output-size",
      size: "3840x2160"
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
});
