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
            policies: ["Policy: Do not promise guaranteed results."],
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

  it("uses the fix agent to revise only the flagged field, not the whole idea", async () => {
    const user = userEvent.setup();
    const [direction] = buildDirectionFixtures("Compass");
    if (!direction) throw new Error("Expected a direction fixture.");
    const onApplyFinding = vi.fn();
    const runChecks = vi.fn().mockResolvedValue([
      {
        directionId: direction.id,
        findings: [
          {
            check: "quality",
            message: "คำว่า 'hook' ควรระบุให้ชัดเจนกว่านี้",
            field: "hook",
            suggestion: "ทำให้ hook ชัดเจนขึ้น"
          },
          {
            check: "policy",
            message: "ต้องให้ทีมกฎหมายตรวจสอบคำกล่าวอ้างนี้ก่อน",
            field: null,
            suggestion: null
          }
        ]
      }
    ]);
    const runApplyFix = vi.fn().mockResolvedValue("Compass hook 1 (revised)");

    const { unmount } = render(
      <PreflightModal
        directions={[direction]}
        fallbackService="single-static"
        context={{
          runId: "run-preflight-apply",
          brief: "Make the product benefit instantly clear.",
          brandContext: null
        }}
        artworkMode="design-system"
        onArtworkModeChange={vi.fn()}
        outputSize="1088x1360"
        onOutputSizeChange={vi.fn()}
        onCancel={vi.fn()}
        onContinue={vi.fn()}
        onApplyFinding={onApplyFinding}
        runChecks={runChecks}
        runApplyFix={runApplyFix}
      />
    );

    const dialog = within(document.body).getByRole("dialog", {
      name: "Check these ideas before you build"
    });
    const modal = within(dialog);

    await user.click(modal.getByRole("button", { name: "Run checks on 1" }));
    expect(await modal.findByText("คำว่า 'hook' ควรระบุให้ชัดเจนกว่านี้")).toBeTruthy();

    expect(modal.getAllByRole("button", { name: "Fix with AI" })).toHaveLength(1);

    await user.click(modal.getByRole("button", { name: "Fix with AI" }));
    expect(await modal.findByRole("button", { name: "Applied ✓" })).toBeTruthy();

    expect(runApplyFix).toHaveBeenCalledTimes(1);
    expect(runApplyFix).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "hook",
        check: "quality",
        message: "คำว่า 'hook' ควรระบุให้ชัดเจนกว่านี้",
        suggestion: "ทำให้ hook ชัดเจนขึ้น",
        direction: expect.objectContaining({ hook: "Compass hook 1" })
      })
    );
    expect(onApplyFinding).toHaveBeenCalledTimes(1);
    expect(onApplyFinding).toHaveBeenCalledWith(direction.id, {
      hook: "Compass hook 1 (revised)"
    });
    expect(
      (
        modal.getByRole("button", {
          name: "Applied ✓"
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);

    unmount();
  });

  it("sends the user's added instructions to the fix agent", async () => {
    const user = userEvent.setup();
    const [direction] = buildDirectionFixtures("Compass");
    if (!direction) throw new Error("Expected a direction fixture.");
    const onApplyFinding = vi.fn();
    const runChecks = vi.fn().mockResolvedValue([
      {
        directionId: direction.id,
        findings: [
          {
            check: "quality",
            message: "คำว่า 'hook' ควรระบุให้ชัดเจนกว่านี้",
            field: "hook",
            suggestion: "ทำให้ hook ชัดเจนขึ้น"
          }
        ]
      }
    ]);
    const runApplyFix = vi
      .fn()
      .mockResolvedValue("Compass hook 1 (revised and extra clear)");

    const { unmount } = render(
      <PreflightModal
        directions={[direction]}
        fallbackService="single-static"
        context={{
          runId: "run-preflight-edit-suggestion",
          brief: "Make the product benefit instantly clear.",
          brandContext: null
        }}
        artworkMode="design-system"
        onArtworkModeChange={vi.fn()}
        outputSize="1088x1360"
        onOutputSizeChange={vi.fn()}
        onCancel={vi.fn()}
        onContinue={vi.fn()}
        onApplyFinding={onApplyFinding}
        runChecks={runChecks}
        runApplyFix={runApplyFix}
      />
    );

    const dialog = within(document.body).getByRole("dialog", {
      name: "Check these ideas before you build"
    });
    const modal = within(dialog);

    await user.click(modal.getByRole("button", { name: "Run checks on 1" }));
    const instructionsInput = (await modal.findByRole("textbox", {
      name: "Additional instructions (optional)"
    })) as HTMLInputElement;
    expect(instructionsInput.value).toBe("ทำให้ hook ชัดเจนขึ้น");

    await user.clear(instructionsInput);
    await user.type(instructionsInput, "Keep it under 8 words");

    await user.click(modal.getByRole("button", { name: "Fix with AI" }));
    expect(await modal.findByRole("button", { name: "Applied ✓" })).toBeTruthy();

    expect(runApplyFix).toHaveBeenCalledWith(
      expect.objectContaining({ instructions: "Keep it under 8 words" })
    );
    expect(onApplyFinding).toHaveBeenCalledWith(direction.id, {
      hook: "Compass hook 1 (revised and extra clear)"
    });

    unmount();
  });

  it("applies every fixable finding across ideas in one click", async () => {
    const user = userEvent.setup();
    const [directionOne, directionTwo] = buildDirectionFixtures("Compass");
    if (!directionOne || !directionTwo) {
      throw new Error("Expected two direction fixtures.");
    }
    const onApplyFinding = vi.fn();
    const runChecks = vi.fn().mockResolvedValue([
      {
        directionId: directionOne.id,
        findings: [
          {
            check: "quality",
            message: "Fix hook 1",
            field: "hook",
            suggestion: "Make it clearer"
          },
          {
            check: "quality",
            message: "Fix subheadline 1",
            field: "subheadline",
            suggestion: "Tighten the subheadline"
          }
        ]
      },
      {
        directionId: directionTwo.id,
        findings: [
          {
            check: "quality",
            message: "Fix caption 2",
            field: "caption",
            suggestion: "Tighten the caption"
          },
          {
            check: "policy",
            message: "Needs legal review, no automatic fix",
            field: null,
            suggestion: null
          }
        ]
      }
    ]);
    const runApplyFix = vi.fn().mockImplementation(
      async ({ field }: { field: string }) => `Fixed ${field}`
    );

    const { unmount } = render(
      <PreflightModal
        directions={[directionOne, directionTwo]}
        fallbackService="single-static"
        context={{
          runId: "run-preflight-apply-all",
          brief: "Make the product benefit instantly clear.",
          brandContext: null
        }}
        artworkMode="design-system"
        onArtworkModeChange={vi.fn()}
        outputSize="1088x1360"
        onOutputSizeChange={vi.fn()}
        onCancel={vi.fn()}
        onContinue={vi.fn()}
        onApplyFinding={onApplyFinding}
        runChecks={runChecks}
        runApplyFix={runApplyFix}
      />
    );

    const dialog = within(document.body).getByRole("dialog", {
      name: "Check these ideas before you build"
    });
    const modal = within(dialog);

    await user.click(modal.getByRole("button", { name: "Run checks on 2" }));
    await modal.findByText("Fix hook 1");

    await user.click(
      modal.getByRole("button", { name: "Apply all fixes (3)" })
    );

    expect(
      await modal.findAllByRole("button", { name: "Applied ✓" })
    ).toHaveLength(3);
    expect(onApplyFinding).toHaveBeenCalledTimes(2);
    expect(onApplyFinding).toHaveBeenCalledWith(directionOne.id, {
      hook: "Fixed hook",
      subheadline: "Fixed subheadline"
    });
    expect(onApplyFinding).toHaveBeenCalledWith(directionTwo.id, {
      caption: "Fixed caption"
    });
    expect(
      modal.queryByRole("button", { name: /Apply all fixes/ })
    ).toBeNull();

    unmount();
  });

  it("locks the whole idea while one fix is in flight so a second click can't race it", async () => {
    const user = userEvent.setup();
    const [direction] = buildDirectionFixtures("Compass");
    if (!direction) throw new Error("Expected a direction fixture.");
    const onApplyFinding = vi.fn();
    const runChecks = vi.fn().mockResolvedValue([
      {
        directionId: direction.id,
        findings: [
          {
            check: "quality",
            message: "Fix hook",
            field: "hook",
            suggestion: "Make it clearer"
          },
          {
            check: "quality",
            message: "Fix subheadline",
            field: "subheadline",
            suggestion: "Tighten it"
          }
        ]
      }
    ]);
    let resolveFirstFix: (value: string) => void = () => undefined;
    const runApplyFix = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<string>((resolve) => (resolveFirstFix = resolve))
      )
      .mockResolvedValue("Fixed subheadline");

    const { unmount } = render(
      <PreflightModal
        directions={[direction]}
        fallbackService="single-static"
        context={{
          runId: "run-preflight-race",
          brief: "Make the product benefit instantly clear.",
          brandContext: null
        }}
        artworkMode="design-system"
        onArtworkModeChange={vi.fn()}
        outputSize="1088x1360"
        onOutputSizeChange={vi.fn()}
        onCancel={vi.fn()}
        onContinue={vi.fn()}
        onApplyFinding={onApplyFinding}
        runChecks={runChecks}
        runApplyFix={runApplyFix}
      />
    );

    const dialog = within(document.body).getByRole("dialog", {
      name: "Check these ideas before you build"
    });
    const modal = within(dialog);

    await user.click(modal.getByRole("button", { name: "Run checks on 1" }));
    await modal.findByText("Fix hook");

    const [firstFixButton, secondFixButton] = modal.getAllByRole("button", {
      name: "Fix with AI"
    }) as HTMLButtonElement[];
    await user.click(firstFixButton!);

    // The first fix is still in flight (its promise hasn't resolved yet), so
    // clicking the second finding's button for the SAME idea must be a no-op
    // — otherwise the two dispatches could race and one would clobber the
    // other's change. Both this idea's own "Fixing…" buttons (its per-idea
    // apply-all and the second finding) reflect the lock.
    expect(
      await modal.findAllByRole("button", { name: "Fixing…" })
    ).toHaveLength(2);
    expect(secondFixButton!.disabled).toBe(true);
    await user.click(secondFixButton!);
    expect(runApplyFix).toHaveBeenCalledTimes(1);

    resolveFirstFix("Fixed hook");
    expect(await modal.findAllByRole("button", { name: "Applied ✓" })).toHaveLength(1);

    // Now that the idea is unlocked again, the second finding can be fixed.
    const remainingFixButton = modal.getByRole("button", { name: "Fix with AI" });
    await user.click(remainingFixButton);
    expect(await modal.findAllByRole("button", { name: "Applied ✓" })).toHaveLength(2);

    expect(onApplyFinding).toHaveBeenCalledTimes(2);
    expect(onApplyFinding).toHaveBeenNthCalledWith(1, direction.id, {
      hook: "Fixed hook"
    });
    expect(onApplyFinding).toHaveBeenNthCalledWith(2, direction.id, {
      subheadline: "Fixed subheadline"
    });

    unmount();
  });

  it("lets you apply all fixes for just one idea from that idea's own button", async () => {
    const user = userEvent.setup();
    const [directionOne, directionTwo] = buildDirectionFixtures("Compass");
    if (!directionOne || !directionTwo) {
      throw new Error("Expected two direction fixtures.");
    }
    const onApplyFinding = vi.fn();
    const runChecks = vi.fn().mockResolvedValue([
      {
        directionId: directionOne.id,
        findings: [
          {
            check: "quality",
            message: "Fix hook 1",
            field: "hook",
            suggestion: "Make it clearer"
          },
          {
            check: "quality",
            message: "Fix subheadline 1",
            field: "subheadline",
            suggestion: "Tighten it"
          }
        ]
      },
      {
        directionId: directionTwo.id,
        findings: [
          {
            check: "quality",
            message: "Fix caption 2",
            field: "caption",
            suggestion: "Tighten it"
          }
        ]
      }
    ]);
    const runApplyFix = vi
      .fn()
      .mockImplementation(async ({ field }: { field: string }) => `Fixed ${field}`);

    const { unmount } = render(
      <PreflightModal
        directions={[directionOne, directionTwo]}
        fallbackService="single-static"
        context={{
          runId: "run-preflight-apply-all-one-idea",
          brief: "Make the product benefit instantly clear.",
          brandContext: null
        }}
        artworkMode="design-system"
        onArtworkModeChange={vi.fn()}
        outputSize="1088x1360"
        onOutputSizeChange={vi.fn()}
        onCancel={vi.fn()}
        onContinue={vi.fn()}
        onApplyFinding={onApplyFinding}
        runChecks={runChecks}
        runApplyFix={runApplyFix}
      />
    );

    const dialog = within(document.body).getByRole("dialog", {
      name: "Check these ideas before you build"
    });
    const modal = within(dialog);

    await user.click(modal.getByRole("button", { name: "Run checks on 2" }));
    await modal.findByText("Fix hook 1");

    expect(
      modal.getAllByRole("button", { name: /^Apply all \(\d+\)$/ })
    ).toHaveLength(2);

    await user.click(modal.getByRole("button", { name: "Apply all (2)" }));
    expect(
      await modal.findAllByRole("button", { name: "Applied ✓" })
    ).toHaveLength(2);

    expect(onApplyFinding).toHaveBeenCalledTimes(1);
    expect(onApplyFinding).toHaveBeenCalledWith(directionOne.id, {
      hook: "Fixed hook",
      subheadline: "Fixed subheadline"
    });
    // The second idea's finding is untouched — only its own button applies it.
    expect(modal.getByRole("button", { name: "Apply all (1)" })).toBeTruthy();
    expect(modal.getByRole("button", { name: "Fix with AI" })).toBeTruthy();

    await user.click(modal.getByRole("button", { name: "Apply all (1)" }));
    expect(
      await modal.findAllByRole("button", { name: "Applied ✓" })
    ).toHaveLength(3);
    expect(onApplyFinding).toHaveBeenCalledTimes(2);
    expect(onApplyFinding).toHaveBeenCalledWith(directionTwo.id, {
      caption: "Fixed caption"
    });

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
      "ออกแบบให้เป็นภาพโฆษณา Campaign Key Visual จริง ไม่ใช่ Infographic หรือ Information Sheet เน้น 1 Key Message + 1 Hero Visual / Offer ที่เด่นชัด ใช้ข้อความเท่าที่จำเป็น มี hierarchy ชัด อ่านจบไว สื่อสารด้วยภาพเป็นหลัก ไม่ใช้กล่องข้อความหลายส่วนเพื่ออธิบาย จัดองค์ประกอบให้ดูเป็นงานเอเจนซี่ มี balance, negative space และความน่าสนใจแบบภาพโฆษณาจริง ดูโดดเด่น ให้คนเห็นต้องหยุดดู และ ทำตามหลัก Design Principle"
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
