import { describe, expect, it, vi } from "vitest";
import {
  editImage,
  fitOpenAIImagePrompt,
  generateImage,
  OPENAI_IMAGE_PROMPT_SAFE_CHARACTERS
} from "./openai-images-client";

const oversizedPrompt = [
  "CORE BRIEF — preserve this opening.",
  "Detailed lower-priority context. ".repeat(1_500),
  "FINAL REQUIREMENTS — preserve this ending."
].join("\n\n");

function imageResponse(): Response {
  return new Response(
    JSON.stringify({
      data: [{ b64_json: Buffer.from("image").toString("base64") }]
    }),
    { status: 200 }
  );
}

describe("OpenAI image prompt limit", () => {
  it("preserves the beginning and end while enforcing the safe limit", () => {
    const prompt = fitOpenAIImagePrompt(oversizedPrompt);

    expect(prompt.length).toBeLessThanOrEqual(
      OPENAI_IMAGE_PROMPT_SAFE_CHARACTERS
    );
    expect(prompt).toContain("CORE BRIEF");
    expect(prompt).toContain("FINAL REQUIREMENTS");
    expect(prompt).toContain("Lower-priority context was shortened");
  });

  it("enforces the limit on generation requests at the API boundary", async () => {
    let sentPrompt = "";
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      sentPrompt = (
        JSON.parse(String(init?.body)) as { prompt: string }
      ).prompt;
      return imageResponse();
    });

    await generateImage({
      apiKey: "test-key",
      model: "gpt-image-2",
      prompt: oversizedPrompt,
      size: "1024x1024",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    expect(sentPrompt.length).toBeLessThanOrEqual(
      OPENAI_IMAGE_PROMPT_SAFE_CHARACTERS
    );
  });

  it("enforces the limit on edit requests at the API boundary", async () => {
    let sentPrompt = "";
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      sentPrompt = String((init?.body as FormData).get("prompt"));
      return imageResponse();
    });

    await editImage({
      apiKey: "test-key",
      model: "gpt-image-2",
      prompt: oversizedPrompt,
      size: "1024x1024",
      referenceImages: [
        {
          bytes: Buffer.from("reference"),
          mimeType: "image/png"
        }
      ],
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    expect(sentPrompt.length).toBeLessThanOrEqual(
      OPENAI_IMAGE_PROMPT_SAFE_CHARACTERS
    );
  });
});
