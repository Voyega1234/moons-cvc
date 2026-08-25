import type { HookResearchDossier } from "./hook-research-agent.js";

export interface HookTopicItem {
  topic: string;
  why: string;
}

export interface HookTopicShortlist {
  topics: HookTopicItem[];
}

export const hookTopicsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    topics: {
      type: "array",
      minItems: 12,
      maxItems: 15,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          topic: { type: "string" },
          why: { type: "string" }
        },
        required: ["topic", "why"]
      }
    }
  },
  required: ["topics"]
} as const;

export function buildHookTopicsPrompt(
  policyPrompt: string,
  runtimeInput: string,
  researchDossier: HookResearchDossier
): string {
  return [
    policyPrompt.trim(),
    "",
    "# Runtime input",
    runtimeInput,
    "",
    "# Dedicated Research Agent dossier",
    JSON.stringify(researchDossier)
  ].join("\n");
}

export function parseHookTopicShortlist(text: string): HookTopicShortlist {
  const raw = JSON.parse(unwrapJsonCodeFence(text)) as unknown;
  if (!isRecord(raw) || !Array.isArray(raw.topics)) {
    throw new Error("Hook Topic Agent must return a topics array.");
  }
  if (raw.topics.length < 1) {
    throw new Error("Hook Topic Agent must return at least one topic.");
  }
  const topics = raw.topics.map((item, index) => {
    if (
      !isRecord(item) ||
      typeof item.topic !== "string" ||
      item.topic.trim() === "" ||
      typeof item.why !== "string" ||
      item.why.trim() === ""
    ) {
      throw new Error(
        `Hook Topic Agent topics[${index}] must include non-empty topic and why.`
      );
    }
    return { topic: item.topic, why: item.why };
  });
  return { topics };
}

export function hookTopicShortlistBlock(shortlist: HookTopicShortlist): string {
  return [
    "# Topic Agent shortlist",
    "A dedicated Topic Agent already explored the brand and Research dossier and shortlisted candidate pain points, product roles, and angles. Treat this list as an expanded idea pool, not a checklist to cover one-to-one — you are not required to use every topic, and you may still discover a stronger angle outside this list.",
    "Every topic here already passed the same Product Truth rules as this prompt: do not turn an unsupported topic into a stronger factual claim than what the Research dossier or Brand context actually supports.",
    "Use topics to widen where you start from, not as pre-written Hook wording — still write every Hook, Headline, and Concept from scratch following the rules above.",
    JSON.stringify(shortlist)
  ].join("\n");
}

function unwrapJsonCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
