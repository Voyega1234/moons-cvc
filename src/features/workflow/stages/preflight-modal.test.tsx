import { useState } from "react";
import { fireEvent, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { buildDirectionFixtures } from "../test-fixtures";
import { PreflightModal } from "./preflight-modal";

describe("PreflightModal", () => {
  it("matches the before-build flow and keeps its findings advisory", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
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
    const runChecks = vi.fn().mockResolvedValue(
      directions.map((direction) => ({
        directionId: direction.id,
        findings: []
      }))
    );

    const { unmount } = render(
      <PreflightModal
        directions={directions}
        fallbackService="single-static"
        context={{
          runId: "run-preflight",
          brief: "Make the product benefit instantly clear.",
          brandContext: {
            name: "Compass",
            category: "Test",
            products: ["Compass product: Confirmed product proof."],
            documents: [],
            working: [],
            avoid: []
          }
        }}
        artworkMode="design-system"
        onArtworkModeChange={vi.fn()}
        outputSize="1088x1360"
        onOutputSizeChange={vi.fn()}
        onCancel={onCancel}
        onContinue={onContinue}
        runChecks={runChecks}
      />
    );

    const dialog = within(document.body).getByRole("dialog", {
      name: "Check these ideas before you build"
    });
    const modal = within(dialog);

    expect(modal.getByText("Ideas to check")).toBeTruthy();
    expect(modal.getByText("6 of 6 selected")).toBeTruthy();
    expect(
      modal.queryByRole("textbox", {
        name: "Artwork brief from Review & continue"
      })
    ).toBeNull();
    expect(
      dialog.querySelectorAll(".preflight-asset[role='checkbox']")
    ).toHaveLength(6);
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
    expect(await modal.findByText("Nothing flagged")).toBeTruthy();
    expect(runChecks).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-preflight",
        checks: ["quality", "spelling"],
        directions: expect.arrayContaining([
          expect.objectContaining({ id: directions[0]?.id })
        ])
      })
    );
    expect(onContinue).not.toHaveBeenCalled();

    await user.click(modal.getByRole("button", { name: "Open Create →" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    unmount();
  });

  it("cancels without continuing and previews editable visual inputs", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onContinue = vi.fn();
    const onArtworkBriefChange = vi.fn();
    const [direction] = buildDirectionFixtures("Compass");
    const portalRoot = document.createElement("div");
    portalRoot.className = "compass-app";
    document.body.append(portalRoot);

    const { unmount } = render(
      <PreflightModal
        directions={direction ? [direction] : []}
        fallbackService="single-static"
        context={{
          runId: "run-preflight-cancel",
          brief: "Keep the selected visual context.",
          brandContext: null
        }}
        visualInputs={{
          referenceCount: 2,
          materialCount: 1,
          referenceEditor: <div>Reference editor reused</div>,
          materialEditor: <div>Material editor reused</div>
        }}
        artworkBrief="Keep the composition calm with natural window light."
        onArtworkBriefChange={onArtworkBriefChange}
        artworkMode="design-system"
        onArtworkModeChange={vi.fn()}
        outputSize="1088x1360"
        onOutputSizeChange={vi.fn()}
        onCancel={onCancel}
        onContinue={onContinue}
      />
    );

    const dialog = within(document.body).getByRole("dialog", {
      name: "Check these ideas before you build"
    });
    const modal = within(dialog);

    expect(portalRoot.contains(dialog)).toBe(true);
    expect(modal.getByText("Image references")).toBeTruthy();
    expect(modal.getByText("Reference editor reused")).toBeTruthy();
    const artworkBrief = modal.getByRole("textbox", {
      name: "Artwork brief"
    }) as HTMLTextAreaElement;
    expect(artworkBrief.value).toBe(
      "Keep the composition calm with natural window light."
    );
    expect(artworkBrief.maxLength).toBe(3000);
    expect(artworkBrief.readOnly).toBe(false);
    fireEvent.change(artworkBrief, {
      target: { value: "Use warmer natural light." }
    });
    expect(onArtworkBriefChange).toHaveBeenCalledWith(
      "Use warmer natural light."
    );

    await user.click(
      modal.getByRole("tab", { name: /Image Materials/ })
    );
    expect(modal.getByText("Material editor reused")).toBeTruthy();

    await user.click(modal.getByRole("button", { name: "Close" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
    unmount();
    portalRoot.remove();
  });

  it("shows an editable artwork brief even when it starts empty", () => {
    const [direction] = buildDirectionFixtures("Compass");

    const { unmount } = render(
      <PreflightModal
        directions={direction ? [direction] : []}
        fallbackService="single-static"
        context={{
          runId: "run-preflight-empty-brief",
          brief: "Let the agent decide unless the user adds direction.",
          brandContext: null
        }}
        visualInputs={{
          referenceCount: 0,
          materialCount: 0,
          referenceEditor: <div>No references selected</div>,
          materialEditor: <div>No materials selected</div>
        }}
        artworkBrief=""
        onArtworkBriefChange={vi.fn()}
        artworkMode="design-system"
        onArtworkModeChange={vi.fn()}
        outputSize="1088x1360"
        onOutputSizeChange={vi.fn()}
        onCancel={vi.fn()}
        onContinue={vi.fn()}
      />
    );

    const artworkBrief = within(document.body).getByRole("textbox", {
      name: "Artwork brief"
    }) as HTMLTextAreaElement;
    expect(artworkBrief.value).toBe("");
    expect(artworkBrief.placeholder).toBe(
      "Add visual direction, composition, lighting, mood, or restrictions for the final artwork."
    );

    unmount();
  });

  it("keeps the artwork brief focused while controlled input updates", async () => {
    const user = userEvent.setup();
    const [direction] = buildDirectionFixtures("Compass");

    function ControlledPreflight() {
      const [artworkBrief, setArtworkBrief] = useState("");

      return (
        <PreflightModal
          directions={direction ? [direction] : []}
          fallbackService="single-static"
          context={{
            runId: "run-preflight-continuous-typing",
            brief: "Keep typing in the same field.",
            brandContext: null
          }}
          visualInputs={{
            referenceCount: 0,
            materialCount: 0,
            referenceEditor: <div>No references selected</div>,
            materialEditor: <div>No materials selected</div>
          }}
          artworkBrief={artworkBrief}
          onArtworkBriefChange={setArtworkBrief}
          artworkMode="design-system"
          onArtworkModeChange={() => undefined}
          outputSize="1088x1360"
          onOutputSizeChange={vi.fn()}
          onCancel={() => undefined}
          onContinue={() => undefined}
        />
      );
    }

    const { unmount } = render(<ControlledPreflight />);
    const artworkBrief = within(document.body).getByRole("textbox", {
      name: "Artwork brief"
    }) as HTMLTextAreaElement;

    await user.click(artworkBrief);
    await user.type(artworkBrief, "Continuous typing works");

    expect(artworkBrief.value).toBe("Continuous typing works");
    expect(document.activeElement).toBe(artworkBrief);
    unmount();
  });
});
