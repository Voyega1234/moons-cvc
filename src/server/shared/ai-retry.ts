import { StructuredOutputError } from "./structured-output.js";

export function isRetryableAiError(error: unknown): boolean {
  if (!(error instanceof Error) && !(error instanceof DOMException)) return false;
  const code = error instanceof StructuredOutputError ? error.providerCode ?? "" : "";
  const detail = `${code} ${error.message}`;
  // A credit/quota rejection can arrive as 429 or inside an HTTP-200 envelope.
  if (/insufficient[_ ](?:credits|quota|funds)|credits? (?:remaining|exhausted)|no credits|out of credits|credit balance|payment required|billing|invalid[_ ]api[_ ]key|unauthorized|forbidden|invalid_(?:request|schema|model|parameter)|content_filter|safety|moderation/i.test(detail)) return false;
  if (/\b(?:400|401|402|403|404|405|413|422)\b/.test(code) || /(?:failed:|HTTP)\s*(?:400|401|402|403|404|405|413|422)\b/i.test(error.message)) return false;
  if (error instanceof StructuredOutputError) {
    return ["provider_error", "invalid_json", "empty_output"].includes(error.code);
  }
  return error instanceof SyntaxError ||
    ["AbortError", "TimeoutError"].includes(error.name) ||
    /\b(?:408|429|500|502|503|504|529)\b|fetch failed|network error|ECONNRESET|ETIMEDOUT|operation was aborted|returned (?:an empty response|a non-JSON response|non-JSON data)/i.test(error.message);
}

// Retry only the failed agent operation, never the whole artwork pipeline.
export async function withAiRetry<T>(task: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= 2 || !isRetryableAiError(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
}
