import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const LOCAL_HOOK_GENERATION_DEBUG_LOG_DIR = "logs/hook-generation";

export interface HookGenerationDebugLog {
  kind: "hook-generation";
  createdAt: string;
  runId: string;
  hookIdeaMode: string;
  candidateAgent: {
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
        toolChoice?: "required";
        attachedImages: readonly {
          id: string;
          name: string;
          mediaType: string;
          role: string;
          description: string;
          detail: "high";
        }[];
        responseSchema: "moons_hook_candidates";
      };
      response: {
        parsed: unknown;
        raw: unknown;
      };
    }[];
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
        toolChoice?: "required";
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
      };
    }[];
  };
  pastContentAgent?: {
    provider: "openai";
    model: string;
    request: {
      endpoint: "/v1/responses";
      inputText: string;
      responseSchema: "moons_past_content_profile";
    };
    response: {
      parsed: unknown;
      raw: unknown;
    };
  };
  captionAgent?: {
    provider: "openai";
    model: string;
    request: {
      endpoint: "/v1/responses";
      inputText: string;
      responseSchema: "moons_caption_style";
    };
    response: {
      parsed: unknown;
      raw: unknown;
    };
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
