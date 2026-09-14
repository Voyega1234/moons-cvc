export class StructuredOutputError extends Error {
  constructor(
    public readonly code: "truncated" | "invalid_json" | "empty_output" | "provider_error" | "refusal" | "tool_calls",
    message: string
  ) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

// Read final answer text only. Reasoning and tool arguments are not JSON output.
export function extractStructuredJsonText(payload: unknown, label: string): string {
  const record = isRecord(payload) ? payload : {};
  const choices = Array.isArray(record.choices) ? record.choices.filter(isRecord) : [];
  const choice = choices[0];
  const message = isRecord(choice?.message) ? choice.message : {};
  if (record.error || choice?.error || record.status === "failed" || choice?.finish_reason === "error") {
    throw new StructuredOutputError("provider_error", `${label} returned a provider error.`);
  }
  const incompleteReason = isRecord(record.incomplete_details) ? record.incomplete_details.reason : undefined;
  if (incompleteReason === "content_filter") {
    throw new StructuredOutputError("refusal", `${label} was refused or blocked by the provider.`);
  }
  if (record.status === "incomplete" || choice?.finish_reason === "length") {
    throw new StructuredOutputError("truncated", `${label} response was truncated before it finished (${typeof incompleteReason === "string" ? incompleteReason : "max output tokens reached"}).`);
  }
  const output = Array.isArray(record.output) ? record.output.filter(isRecord) : [];
  const parts = output.flatMap((item) => Array.isArray(item.content) ? item.content.filter(isRecord) : []);
  if (message.refusal || choice?.finish_reason === "content_filter" || parts.some((part) => part.type === "refusal")) {
    throw new StructuredOutputError("refusal", `${label} was refused or blocked by the provider.`);
  }
  let text = typeof record.output_text === "string" ? record.output_text : "";
  if (!text.trim()) {
    text = typeof message.content === "string" ? message.content :
      Array.isArray(message.content) ? message.content.filter(isRecord)
        .filter((part) => part.type === "text" || part.type === "output_text")
        .map((part) => typeof part.text === "string" ? part.text : "").join("") : "";
  }
  if (!text.trim()) {
    text = parts.filter((part) => part.type === "output_text")
      .map((part) => typeof part.text === "string" ? part.text : "").join("");
  }
  if (!text.trim()) {
    if (choice?.finish_reason === "tool_calls" || (Array.isArray(message.tool_calls) && message.tool_calls.length)) {
      throw new StructuredOutputError("tool_calls", `${label} returned tool calls without a final JSON answer.`);
    }
    throw new StructuredOutputError("empty_output", `${label} returned no final output text${choice?.finish_reason ? ` (finish_reason: ${String(choice.finish_reason)})` : ""}.`);
  }
  const json = text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1").trim();
  try {
    JSON.parse(json);
  } catch {
    throw new StructuredOutputError("invalid_json", `${label} returned malformed JSON. The output may be incomplete or contain invalid string escaping.`);
  }
  return json;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
