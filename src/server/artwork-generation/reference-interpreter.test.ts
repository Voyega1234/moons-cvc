import { describe, expect, it, vi } from "vitest";
import { interpretReferenceDesign } from "./reference-interpreter";

describe("interpretReferenceDesign", () => {
  const input = {
    apiKey: "test", provider: "openrouter" as const, model: "test/model", mode: "standard" as const,
    references: [{ bytes: Buffer.from("ref"), mimeType: "image/png" }],
    campaign: { concept: "Idea", objective: "Objective", headline: "Headline", targetRatio: "1:1" },
    loadPrompt: async () => "Interpret the reference."
  };
  const validGrammar = {
    artworkConcept: "A", keyVisualGrammar: "B", compositionGrammar: "C", graphicDeviceLogic: "D",
    hierarchyAndDensity: "E", secondaryAndFooterGrammar: "F", conceptTranslation: "G", preserve: [], replace: []
  };
  it("inspects four materials alongside design references without treating materials as style sources", async () => {
    const materialReferences = ["serum-front", "serum-side", "serum-dropper", "gel"].map((name) => ({
      bytes: Buffer.from(name), mimeType: "image/png", label: `Uploaded main object (use as the hero/source object): ${name}.png`
    }));
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ output_text: JSON.stringify(validGrammar) })));
    await interpretReferenceDesign({ ...input, materialReferences, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    const content = body.input[0].content;
    expect(content.slice(1)).toEqual([...input.references, ...materialReferences].map((image) => ({
      type: "input_image", image_url: `data:${image.mimeType};base64,${image.bytes.toString("base64")}`, detail: "high"
    })));
    expect(content[0].text).toContain('"kind": "design-reference"');
    expect(content[0].text).toContain('"kind": "user-material"');
    expect(content[0].text).toContain("not design references");
    expect(content[0].text).toContain("MANDATORY USER-SELECTED MAIN OBJECTS");
    expect(content[0].text).toContain("Image 5: Uploaded main object");
  });
  it.each([true, false])("retries one transient provider failure, HTTP-200 envelope: %s", async (envelope) => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "failed", error: { code: "server_error", message: "Temporarily unavailable" } }), { status: envelope ? 200 : 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: JSON.stringify(validGrammar) })));
    const writeTrace = vi.fn();
    expect(await interpretReferenceDesign({ ...input, fetchImpl, writeTrace })).toEqual(validGrammar);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[1]).toEqual(fetchImpl.mock.calls[1]?.[1]);
    expect(writeTrace.mock.calls.map(call => call[0].status)).toEqual(["failed", "succeeded"]);
  });
  it("stops after the third transient failure", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: 503, message: "Unavailable" } })));
    await expect(interpretReferenceDesign({ ...input, fetchImpl })).rejects.toThrow("test/model");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it.each(["invalid_api_key", "insufficient_credits", "content_filter", "invalid_request_error"])("does not retry terminal or unclassified errors: %s", async code => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code, message: "Provider rejected request" } })));
    await expect(interpretReferenceDesign({ ...input, fetchImpl })).rejects.toThrow(code);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([
    { output: [{ content: [{ type: "refusal", refusal: "Cannot comply" }] }] },
    { output_text: JSON.stringify({ ...validGrammar, keyVisualGrammar: "" }) }
  ])("does not hide content or grammar failures by retrying", async payload => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload)));
    await expect(interpretReferenceDesign({ ...input, fetchImpl })).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("recovers from malformed reference JSON without bypassing the interpreter", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: '{"artworkConcept":"cut' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: JSON.stringify(validGrammar) })));
    expect(await interpretReferenceDesign({ ...input, fetchImpl })).toEqual(validGrammar);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
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
