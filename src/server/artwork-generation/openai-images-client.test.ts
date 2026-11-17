import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  editImage,
  editImageWithAspectRatio,
  fitOpenAIImagePrompt,
  generateImage,
  OPENAI_IMAGE_PROMPT_SAFE_CHARACTERS
} from "./openai-images-client";

const validPng = await sharp({ create: { width: 16, height: 16, channels: 3, background: "red" } }).png().toBuffer();

const oversizedPrompt = [
  "CORE BRIEF — preserve this opening.",
  "Detailed lower-priority context. ".repeat(1_500),
  "FINAL REQUIREMENTS — preserve this ending."
].join("\n\n");

it.each(["generate", "edit", "aspect-ratio"] as const)("routes Nano Banana %s directly to Gemini with its own key", async operation => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
    candidates: [{ content: { parts: [
      { text: "Image generated" },
      { inlineData: { mimeType: "image/png", data: validPng.toString("base64") } }
    ] } }]
  })));
  const options = { apiKey: "openrouter-key", geminiApiKey: "gemini-key",
    model: "google/gemini-nano-banana-2.1", prompt: "Approved campaign", size: "1024x1024" as const, fetchImpl };
  const references = [{ bytes: validPng, mimeType: "image/png", label: "Official product" }];
  const result = operation === "generate" ? await generateImage(options)
    : operation === "edit" ? await editImage({ ...options, referenceImages: references })
    : await editImageWithAspectRatio({ ...options, aspectRatio: "1:1", referenceImages: references });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  const [url, init] = fetchImpl.mock.calls[0]!;
  expect(String(url)).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-nano-banana-2.1:generateContent");
  expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("gemini-key");
  expect(new Headers(init?.headers).has("Authorization")).toBe(false);
  expect(JSON.stringify(init)).not.toContain("openrouter-key");
  const body = JSON.parse(String(init?.body));
  expect(body.generationConfig).toEqual({ responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "1:1", imageSize: "1K" } });
  const parts = body.contents[0].parts;
  expect(parts[0]).toEqual({ text: "Approved campaign" });
  expect(parts.filter((part: { inlineData?: unknown }) => part.inlineData)).toHaveLength(operation === "generate" ? 0 : 1);
  if (operation !== "generate") {
    expect(parts[1]).toEqual({ text: "Official product" });
    expect(parts[2].inlineData.data).toBe(validPng.toString("base64"));
  }
  expect(result.model).toBe(options.model);
  expect(await sharp(Buffer.from(result.base64, "base64")).metadata()).toMatchObject({ width: 1024, height: 1024 });
});

it("surfaces a native Gemini safety block without switching back to OpenRouter", async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } })));
  await expect(generateImage({ apiKey: "router", geminiApiKey: "gemini", model: "google/gemini-nano-banana-2.1",
    prompt: "Campaign", size: "1024x1024", fetchImpl })).rejects.toThrow("refused or blocked");
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it("retries a transient native Gemini failure on the same provider", async () => {
  const fetchImpl = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Service unavailable" } }), { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: {
      mimeType: "image/png", data: validPng.toString("base64")
    } }] } }] })));
  await generateImage({ apiKey: "router", geminiApiKey: "gemini", model: "google/gemini-nano-banana-2.1",
    prompt: "Campaign", size: "1024x1024", fetchImpl });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(fetchImpl.mock.calls.every(([url]) => String(url).startsWith("https://generativelanguage.googleapis.com/"))).toBe(true);
});

function imageResponse(): Response {
  return new Response(
    JSON.stringify({
      data: [{ b64_json: validPng.toString("base64") }]
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
      model: "gpt-image-2.5-sunburst",
      prompt: oversizedPrompt,
      size: "1024x1024",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)).model).toBe(
      "openai/gpt-image-2.5-sunburst"
    );
    expect(sentPrompt.length).toBeLessThanOrEqual(
      OPENAI_IMAGE_PROMPT_SAFE_CHARACTERS
    );
  });

  it("enforces the limit on edit requests at the API boundary", async () => {
    let sentPrompt = "";
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      sentPrompt = (
        JSON.parse(String(init?.body)) as { prompt: string }
      ).prompt;
      return imageResponse();
    });

    await editImage({
      apiKey: "test-key",
      model: "gpt-image-2.5-sunburst",
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

    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)).model).toBe(
      "openai/gpt-image-2.5-sunburst"
    );
    expect(sentPrompt.length).toBeLessThanOrEqual(
      OPENAI_IMAGE_PROMPT_SAFE_CHARACTERS
    );
  });
});


it.each([504, 429])("retries image timeout but stops immediately for exhausted credits (HTTP %s)", async status => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: status === 429 ? "You have no credits remaining" : "The operation was aborted" } }), { status }))
    .mockResolvedValueOnce(imageResponse());
  const result = generateImage({ apiKey: "test", model: "test/model", prompt: "Image", size: "1024x1024", fetchImpl });
  if (status === 429) {
    await expect(result).rejects.toThrow("no credits remaining");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  } else {
    expect(await result).toMatchObject({ mimeType: "image/png" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  }
});


describe("image model failover", () => {
  const gpt = "gpt-image-2.5-sunburst";
  const google = "google/gemini-nano-banana-2.1";
  const rejection = () => new Response(JSON.stringify({ error: { message: "Your request was rejected by the safety system. safety_violations=[sexual]" } }), { status: 400 });
  const references = [{ bytes: Buffer.from("reference"), mimeType: "image/png" }];

  it.each(["generate", "edit", "aspect-edit"] as const)("retries only the failed %s with Google, preserving prompt, references and ratio", async operation => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(rejection()).mockResolvedValueOnce(imageResponse());
    const options = { apiKey: "test", model: gpt, prompt: "Approved campaign", size: "1088x1360" as const, fetchImpl };
    const result = operation === "generate" ? await generateImage(options)
      : operation === "edit" ? await editImage({ ...options, referenceImages: references })
      : await editImageWithAspectRatio({ ...options, aspectRatio: "3:4", referenceImages: references });
    const bodies = fetchImpl.mock.calls.map(call => JSON.parse(String(call[1]?.body)));
    expect(bodies.map(body => body.model)).toEqual([`openai/${gpt}`, google]);
    expect(bodies[1]).toMatchObject({ prompt: bodies[0].prompt, aspect_ratio: "4:5", resolution: "2K" });
    expect(bodies[1].size).toBeUndefined();
    expect(bodies[1].quality).toBeUndefined();
    if (operation !== "generate") expect(bodies[1].input_references).toEqual(bodies[0].input_references);
    expect(result.model).toBe(google);
    expect(await sharp(Buffer.from(result.base64, "base64")).metadata()).toMatchObject({ width: 1088, height: 1360 });
  });

  it("does not change the next image's GPT selection after one image falls back", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(imageResponse()).mockResolvedValueOnce(rejection())
      .mockResolvedValueOnce(imageResponse()).mockResolvedValueOnce(imageResponse());
    const options = { apiKey: "test", model: gpt, prompt: "Campaign", size: "1024x1024" as const, fetchImpl };
    expect((await generateImage(options)).model).toBe(gpt);
    expect((await generateImage(options)).model).toBe(google);
    expect((await generateImage(options)).model).toBe(gpt);
    expect(fetchImpl.mock.calls.map(call => JSON.parse(String(call[1]?.body)).model))
      .toEqual([`openai/${gpt}`, `openai/${gpt}`, google, `openai/${gpt}`]);
  });

  it("does not switch back to GPT when the selected Google model fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(rejection());
    await expect(generateImage({ apiKey: "test", model: google, prompt: "Campaign", size: "1024x1024", fetchImpl })).rejects.toThrow("safety system");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports both failures without a fallback loop", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(rejection());
    await expect(generateImage({ apiKey: "test", model: gpt, prompt: "Campaign", size: "1024x1024", fetchImpl })).rejects.toThrow("Nano Banana 2.1 fallback failed");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("also fails over for provider error envelopes with HTTP 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 400, message: "safety system rejection" } })))
      .mockResolvedValueOnce(imageResponse());
    const result = await generateImage({ apiKey: "test", model: gpt, prompt: "Campaign", size: "3840x2160", fetchImpl });
    expect(result.model).toBe(google);
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toMatchObject({ aspect_ratio: "16:9", resolution: "4K" });
  });
});
