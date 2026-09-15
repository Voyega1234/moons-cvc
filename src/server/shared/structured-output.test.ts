import { describe, expect, it } from "vitest";
import { extractStructuredJsonText } from "./structured-output";

describe("structured output transport", () => {
  it("keeps bounded provider diagnostics without leaking metadata or credentials", () => {
    expect(() => extractStructuredJsonText({ status: "failed", error: {
      code: "server_error", message: "Upstream unavailable at https://example.com?token=secret Bearer secret sk-private-key",
      metadata: { raw: "private prompt" }
    } }, "Reference")).toThrow("Reference returned a provider error (server_error). Upstream unavailable at [URL] Bearer [redacted] [redacted]");
  });
  it("joins final text blocks and skips reasoning", () => {
    expect(extractStructuredJsonText({ output_text: "", output: [
      { type: "reasoning", summary: [{ text: "private reasoning" }] },
      { content: [{ type: "output_text", text: '{"caption":' }, { type: "output_text", text: '"hello"}' }] }
    ] }, "QC")).toBe('{"caption":"hello"}');
  });
  it("accepts chat content arrays and JSON fences", () => {
    expect(extractStructuredJsonText({ choices: [{ message: { content: [
      { type: "text", text: '```json\n{"caption":"hello"}\n```' }
    ] } }] }, "Hook")).toBe('{"caption":"hello"}');
  });
  it.each([
    [{ choices: [{ finish_reason: "length", message: { content: '{"caption":"cut' } }] }, "truncated"],
    [{ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }, "truncated"],
    [{ choices: [{ message: { content: '{"caption":"cut' }, finish_reason: "stop" }] }, "invalid_json"],
    [{ choices: [{ message: { content: null, reasoning: "thinking" }, finish_reason: "stop" }] }, "empty_output"],
    [{ choices: [{ message: { refusal: "cannot comply" } }] }, "refusal"],
    [{ output: [{ content: [{ type: "refusal", refusal: "cannot comply" }] }] }, "refusal"],
    [{ choices: [{ message: { tool_calls: [{ function: { arguments: "{}" } }] }, finish_reason: "tool_calls" }] }, "tool_calls"],
    [{ error: { message: "provider failed" } }, "provider_error"]
  ])("classifies incomplete and failed output without inventing data (%s)", (payload, code) => {
    try {
      extractStructuredJsonText(payload, "Hook test-model");
      expect.unreachable("must reject invalid output");
    } catch (error) {
      expect(error).toMatchObject({ code, message: expect.stringContaining("Hook test-model") });
    }
  });
});
