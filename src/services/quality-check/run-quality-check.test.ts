import { afterEach, describe, expect, it, vi } from "vitest";
import { brands } from "../../data/mock-brands";
import {
  emptyApprovalComments,
  emptyApprovalGate,
  type CreativeOutput
} from "../../domain/creative-run";
import { createInitialWorkflowState } from "../../features/workflow/reducer";
import { buildDirectionFixtures } from "../../features/workflow/test-fixtures";
import { runQualityCheck } from "./run-quality-check";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runQualityCheck", () => {
  it("sends creative copy, brand context, references, and revision feedback", async () => {
    const sourceBrand = brands[0];
    if (!sourceBrand) throw new Error("Expected a brand fixture.");

    const brand = {
      ...sourceBrand,
      library: {
        ...sourceBrand.library,
        brand: sourceBrand.library.brand.map((item, index) =>
          index === 0
            ? { ...item, assetUrl: "https://example.com/logo.png" }
            : item
        )
      }
    };
    const direction = buildDirectionFixtures(brand.name)[0];
    if (!direction) throw new Error("Expected a direction fixture.");

    const output: CreativeOutput = {
      id: "output-1",
      directionId: direction.id,
      format: "1:1 Static",
      status: "needs-revision",
      clientStatus: "queued",
      assetUrl: "https://example.com/output.png",
      revisionCount: 1,
      approval: emptyApprovalGate,
      approvalComments: {
        ...emptyApprovalComments,
        clientService: "Keep the approved product name."
      }
    };
    const run = {
      ...createInitialWorkflowState({
        id: "run-1",
        now: "2026-07-14T00:00:00.000Z",
        brand
      }),
      brief: "Promote the workday bundle.",
      referenceImages: [
        {
          id: "reference-1",
          label: "Approved layout",
          url: "https://example.com/reference.png"
        }
      ],
      directions: [direction],
      outputs: [output]
    };

    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            results: [
              {
                outputId: output.id,
                gdPassed: true,
                gdReason: "ผ่าน",
                csPassed: true,
                csReason: "ผ่าน",
                passed: true,
                reason: "GD ผ่าน: ผ่าน\nCS ผ่าน: ผ่าน",
                report: {
                  score: 91,
                  summary: "พร้อมสำหรับ human review",
                  gd: {
                    passed: true,
                    score: 92,
                    summary: "ผ่าน",
                    criteria: []
                  },
                  cs: {
                    passed: true,
                    score: 90,
                    summary: "ผ่าน",
                    criteria: []
                  },
                  suggestion: { title: "", detail: "", suggestedHook: "" }
                }
              }
            ]
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await runQualityCheck(run);

    const request = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body)
    ) as {
      brandContext: { name: string; products: string[] };
      referenceImages: { label: string; url: string; kind: string }[];
      outputs: {
        subheadline: string;
        cta: string;
        caption: string;
        revisionFeedback: string;
      }[];
    };
    expect(request.brandContext.name).toBe("BoneFit");
    expect(request.brandContext.products[0]).toContain("Posture support");
    expect(request.referenceImages).toEqual([
      {
        label: "Logo",
        url: "https://example.com/logo.png",
        kind: "brand-kit"
      },
      {
        label: "Approved layout",
        url: "https://example.com/reference.png",
        kind: "creative-reference"
      }
    ]);
    expect(request.outputs[0]).toMatchObject({
      subheadline: direction.subheadline,
      cta: direction.cta,
      caption: direction.caption,
      revisionFeedback: "CS: Keep the approved product name."
    });
    expect(results[0]?.report?.score).toBe(91);
  });

  it("checks only requested image outputs and excludes UGC", async () => {
    const outputs: CreativeOutput[] = ["output-1", "output-2"].map(
      (id, index) => ({
        id,
        directionId: `direction-${index + 1}`,
        format: index === 0 ? "9:16 UGC" : "1:1 Static",
        status: "draft",
        clientStatus: "queued",
        assetUrl: `https://example.com/${id}.png`,
        revisionCount: 1,
        approval: emptyApprovalGate,
        approvalComments: emptyApprovalComments
      })
    );
    const run = {
      ...createInitialWorkflowState({
        id: "run-targeted-qa",
        now: "2026-07-19T00:00:00.000Z"
      }),
      outputs
    };
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            results: [
              {
                outputId: "output-2",
                passed: true,
                reason: "Ready."
              }
            ]
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    await runQualityCheck(run, ["output-1", "output-2"]);

    const request = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body)
    ) as { outputs: { id: string }[] };
    expect(request.outputs.map((output) => output.id)).toEqual(["output-2"]);
  });
});
