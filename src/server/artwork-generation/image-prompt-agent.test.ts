import { describe, expect, it, vi } from "vitest";
import { generateImagePrompt } from "./image-prompt-agent";

const baseInput = {
  brand: { name: "Flora Daily", category: "Flowers / lifestyle" },
  service: "single-static",
  brief: "Launch a soft summer bouquet offer.",
  hook: {
    hook: "Flowers that make the room feel softer",
    concept: "Lead with room mood.",
    why: "Connects the offer to a clear room mood.",
    cta: "Order a bouquet",
    caption: "Fresh flowers for calm homes."
  },
  textInputs: [],
  referenceImageLabels: [],
  canvasRatio: "1:1",
  brandLibrary: { brand: [], products: [] }
};

describe("generateImagePrompt", () => {
  it("sends the brief to the Responses API and returns the agent's prompt", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>
      });
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({ prompt: "Final production-ready prompt." })
        }),
        { status: 200 }
      );
    });

    const result = await generateImagePrompt({
      apiKey: "test-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
      input: baseInput
    });

    expect(result).toBe("Final production-ready prompt.");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/responses");
    expect(calls[0]?.body.model).toBe("gpt-5.6-terra");
    const promptText = (
      calls[0]?.body.input as { content: { text: string }[] }[]
    )[0]?.content[0]?.text;
    expect(promptText).toContain("Flowers that make the room feel softer");
    expect(promptText).toContain("Neo-Brutalism");
    expect(promptText).not.toContain("Visual direction:");
    expect(promptText).not.toContain("What's working (reuse these patterns):");
  });

  it("uses the provided model override", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({ prompt: "Prompt." })
        }),
        { status: 200 }
      )
    );

    await generateImagePrompt({
      apiKey: "test-key",
      model: "gpt-5.6-terra",
      fetchImpl: fetchMock as unknown as typeof fetch,
      input: baseInput
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { model: string };
    expect(body.model).toBe("gpt-5.6-terra");
  });

  it("throws when the API call fails", async () => {
    const fetchMock = vi.fn(async () => new Response("error", { status: 500 }));

    await expect(
      generateImagePrompt({
        apiKey: "test-key",
        fetchImpl: fetchMock as unknown as typeof fetch,
        input: baseInput
      })
    ).rejects.toThrow("OpenAI image prompt agent failed: 500");
  });

  it("throws when the response has no prompt text", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ output_text: JSON.stringify({ prompt: "" }) }),
        { status: 200 }
      )
    );

    await expect(
      generateImagePrompt({
        apiKey: "test-key",
        fetchImpl: fetchMock as unknown as typeof fetch,
        input: baseInput
      })
    ).rejects.toThrow("OpenAI image prompt agent returned an empty prompt.");
  });
});
