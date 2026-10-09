import { describe, expect, it, vi } from "vitest";
import { callGoogleHookApi, googleHookEndpoint, normalizeGoogleHookResponse } from "./google-hook-provider";
import { extractStructuredJsonText } from "../shared/structured-output";

const answer = (finishReason = "STOP", text = '{"ok":true}') => ({
  candidates: [{ finishReason, content: { parts: [{ thought: true, text: "private reasoning" }, { text }] },
    groundingMetadata: { webSearchQueries: ["query"], groundingChunks: [{ web: { uri: "https://example.com", title: "Source" } }] } }]
});

describe("Google Hook transport", () => {
  it.each(["gemini", "vertex"] as const)("sends native %s schema, search, and header key", async (provider) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(answer())));
    const result = await callGoogleHookApi({ provider, apiKey: "secret", model: "gemini-3.8-flash", fetchImpl,
      text: "brief", schema: { type: "object" }, schemaName: "moons_hook_generation", maxTokens: 5000, search: true });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(googleHookEndpoint(provider, "gemini-3.8-flash"));
    expect(String(url)).not.toContain("secret");
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("secret");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      contents: [{ parts: [{ text: "brief" }] }], tools: [{ googleSearch: {} }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: { type: "object" }, maxOutputTokens: 5000 }
    });
    expect(extractStructuredJsonText(result, "test")).toBe('{"ok":true}');
    expect(result).toMatchObject({ output: [{ type: "web_search_call" }, { content: [{ annotations: [{ url: "https://example.com" }] }] }] });
  });

  it.each([
    [answer("MAX_TOKENS"), "truncated"],
    [answer("SAFETY"), "refused"],
    [{ promptFeedback: { blockReason: "SAFETY" } }, "refused"],
    [answer("STOP", "broken"), "malformed JSON"],
    [answer("STOP", ""), "no final output"]
  ])("preserves validation for provider failures", (payload, message) => {
    expect(() => extractStructuredJsonText(normalizeGoogleHookResponse(payload), "test")).toThrow(String(message));
  });

  it("does not enable search on support passes and redacts keys from errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { message: "bad secret" } }), { status: 403 }));
    await expect(callGoogleHookApi({ provider: "gemini", apiKey: "secret", model: "gemini-test", fetchImpl,
      text: "brief", schema: {}, schemaName: "caption", maxTokens: 100, search: false })).rejects.toThrow("403 — bad [redacted]");
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))).not.toHaveProperty("tools");
  });
});
