import { describe, expect, it, vi } from "vitest";
import { interpretReferenceDesign } from "./reference-interpreter";

describe("interpretReferenceDesign", () => {
  it("sends only the Primary reference to vision and returns structured design grammar", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            artworkConcept: "Reveal an invisible problem through a cutaway.",
            keyVisualGrammar: "One physical cutaway is the proof mechanism.",
            compositionGrammar: "Asymmetric editorial grid.",
            graphicDeviceLogic: "A footer groups secondary proof.",
            hierarchyAndDensity: "One dominant headline and one hero.",
            secondaryAndFooterGrammar: "Grounded green footer zone.",
            conceptTranslation: "Create a new mattress cutaway hero.",
            preserve: ["editorial hierarchy"],
            replace: ["source people", "source scene"]
          })
        }),
        { status: 200 }
      )
    );

    const grammar = await interpretReferenceDesign({
      apiKey: "test-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
      mode: "standard",
      references: [
        {
          bytes: Buffer.from("primary-reference"),
          mimeType: "image/png",
          label: "Primary reference · Style · Client artwork"
        }
      ],
      campaign: {
        concept: "Reveal the hidden mattress layer.",
        objective: "Make the invisible problem tangible.",
        headline: "Clean sheets are not a clean mattress",
        targetRatio: "1:1"
      },
      loadPrompt: async () => "Extract design grammar, not source content."
    });

    expect(grammar.conceptTranslation).toBe(
      "Create a new mattress cutaway hero."
    );
    expect(grammar.keyVisualGrammar).toContain("cutaway");
    const body = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body)
    ) as {
      input: Array<{ content: Array<{ type: string; image_url?: string }> }>;
      text: { format: { name: string } };
    };
    expect(body.text.format.name).toBe("moons_reference_design_grammar");
    expect(JSON.stringify(body.text)).toContain("keyVisualGrammar");
    expect(JSON.stringify(body.text)).not.toContain("typographyGrammar");
    expect(body.input[0]?.content).toContainEqual({
      type: "input_image",
      image_url: `data:image/png;base64,${Buffer.from("primary-reference").toString("base64")}`,
      detail: "high"
    });
  });
});
