import { afterEach, describe, expect, it, vi } from "vitest";
import { isRetryableAiError, withAiRetry } from "./ai-retry";
import { StructuredOutputError } from "./structured-output";

afterEach(() => vi.useRealTimers());
describe("AI retry policy", () => {
  it("recovers on the third attempt with increasing delays", async () => {
    vi.useFakeTimers();
    const task = vi.fn().mockRejectedValueOnce(new Error("failed: 504 — The operation was aborted"))
      .mockRejectedValueOnce(new StructuredOutputError("invalid_json", "Malformed JSON"))
      .mockResolvedValue("done");
    const result = withAiRetry(task);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toBe("done");
    expect(task).toHaveBeenCalledTimes(3);
  });
  it("stops after three failures", async () => {
    vi.useFakeTimers();
    const task = vi.fn().mockRejectedValue(new Error("failed: 503"));
    const assertion = expect(withAiRetry(task)).rejects.toThrow("503");
    await vi.runAllTimersAsync();
    await assertion;
    expect(task).toHaveBeenCalledTimes(3);
  });
  it.each([
    new StructuredOutputError("provider_error", "No credits remaining", "429"),
    new StructuredOutputError("provider_error", "Quota", "insufficient_quota"),
    new Error("failed: 402"), new Error("failed: 401"),
    new StructuredOutputError("refusal", "Refused"),
    new StructuredOutputError("tool_calls", "Needs tools"),
    new Error("Invalid input"), new TypeError("Cannot read properties of undefined")
  ])("does not retry a permanent failure: %s", async error => {
    const task = vi.fn().mockRejectedValue(error);
    await expect(withAiRetry(task)).rejects.toBe(error);
    expect(task).toHaveBeenCalledTimes(1);
  });
  it.each([
    new StructuredOutputError("empty_output", "Empty answer"),
    new StructuredOutputError("provider_error", "Unknown provider failure"),
    new DOMException("Aborted", "AbortError"),
    new TypeError("fetch failed"), new SyntaxError("Unterminated string")
  ])("recognizes transient response and network failures: %s", error => {
    expect(isRetryableAiError(error)).toBe(true);
  });
});
