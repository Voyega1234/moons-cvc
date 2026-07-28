import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { buildDirectionFixtures } from "../test-fixtures";
import { PreflightModal } from "./preflight-modal";

describe("PreflightModal", () => {
  it("matches the before-build flow and keeps its findings advisory", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const directions = buildDirectionFixtures("Compass").map(
      (direction, index) => ({
        ...direction,
        service:
          index < 3
            ? ("single-static" as const)
            : index === 3
              ? ("album-post" as const)
              : ("ugc-video" as const),
        albumFormat:
          index === 3 ? ("four-grid" as const) : direction.albumFormat
      })
    );

    render(
      <PreflightModal
        directions={directions}
        fallbackService="single-static"
        onContinue={onContinue}
      />
    );

    const dialog = within(document.body).getByRole("dialog", {
      name: "Check this creative set before you build"
    });
    const modal = within(dialog);

    expect(modal.getByText("1 · Ideas to check")).toBeTruthy();
    expect(modal.getByText("6 of 6 selected")).toBeTruthy();
    expect(modal.getAllByRole("checkbox")).toHaveLength(6);
    expect(modal.getByText("Album 04")).toBeTruthy();
    expect(modal.getByText("UGC 05")).toBeTruthy();
    expect(
      modal.getByRole("switch", { name: /Quality/i }).getAttribute("aria-checked")
    ).toBe("true");

    await user.click(modal.getByRole("button", { name: "Clear all" }));
    expect(modal.getByText("0 of 6 selected")).toBeTruthy();
    expect(
      (
        modal.getByRole("button", {
          name: "Choose artwork first"
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);

    await user.click(modal.getByRole("button", { name: "Select all" }));
    await user.click(modal.getByRole("button", { name: "Run checks on 6" }));
    expect(modal.getByText("Nothing flagged")).toBeTruthy();
    expect(onContinue).not.toHaveBeenCalled();

    await user.click(modal.getByRole("button", { name: "Open Create →" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
