import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const LOCAL_HOOK_GENERATION_DEBUG_LOG_DIR = "logs/hook-generation";

export interface HookGenerationDebugLog {
  kind: "hook-generation";
  createdAt: string;
  runId: string;
  hookIdeaMode: string;
  researchAgent: {
    provider: "openai" | "openrouter";
    model: string;
    promptSource: "agent_prompt/agent_hook_research.md";
    request: {
      endpoint: "/v1/responses" | "/api/v1/chat/completions";
      inputText: string;
      tools: readonly {
        type: "web_search_preview";
        user_location: {
          type: "approximate";
          country: "TH";
          timezone: "Asia/Bangkok";
        };
      }[];
      plugins: readonly {
        id: "web";
        engine: "native";
        max_results: number;
      }[];
      toolChoice?: "required";
      reasoningEffort?: "medium" | "high";
      responseSchema: "moons_hook_research";
    };
    response: {
      parsed: unknown;
      raw: unknown;
      researchAudit: {
        webSearchRequests: number;
        citationUrls: readonly string[];
      };
    };
  };
  hookAgent: {
    provider: "openai" | "openrouter";
    model: string;
    promptSource: "agent_prompt/agent_hook.md";
    batches: readonly {
      request: {
        endpoint: "/v1/responses" | "/api/v1/chat/completions";
        inputText: string;
        tools: readonly {
          type: "web_search_preview";
          user_location: {
            type: "approximate";
            country: "TH";
            timezone: "Asia/Bangkok";
          };
        }[];
        plugins: readonly {
          id: "web";
          engine: "native";
          max_results: number;
        }[];
        toolChoice?: "required";
        reasoningEffort?: "medium" | "high";
        attachedImages: readonly {
          id: string;
          name: string;
          mediaType: string;
          role: string;
          description: string;
          detail: "high";
        }[];
        responseSchema: "moons_hook_generation";
      };
      response: {
        parsed: unknown;
        raw: unknown;
        researchAudit: {
          webSearchRequests: number;
          citationUrls: readonly string[];
        };
      };
    }[];
  };
  finalResponse: unknown;
}

export type HookGenerationDebugLogger = (
  directory: string,
  entry: HookGenerationDebugLog
) => Promise<void>;

export function hookGenerationDebugLogDirectory(
  vercelEnvironment: string | undefined
): string | undefined {
  return vercelEnvironment === "production" || vercelEnvironment === "preview"
    ? undefined
    : LOCAL_HOOK_GENERATION_DEBUG_LOG_DIR;
}

export async function writeHookGenerationDebugLog(
  directory: string,
  entry: HookGenerationDebugLog
): Promise<void> {
  try {
    const logDirectory = join(process.cwd(), directory);
    await mkdir(logDirectory, { recursive: true });
    const timestamp = entry.createdAt.replaceAll(/[:.]/g, "-");
    const runId = safePathSegment(entry.runId);
    const filename = `${timestamp}-${runId}-hook-generation.json`;
    await writeFile(
      join(logDirectory, filename),
      `${JSON.stringify(entry, null, 2)}\n`,
      "utf8"
    );
  } catch (error) {
    console.warn("Could not write hook-generation debug log.", error);
  }
}

function safePathSegment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9._-]+/g, "-")
      .replaceAll(/-+/g, "-")
      .replaceAll(/^-|-$/g, "")
      .slice(0, 80) || "unknown"
  );
}
