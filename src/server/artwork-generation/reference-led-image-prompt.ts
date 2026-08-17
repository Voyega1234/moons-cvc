import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImagePromptAgentInput } from "./image-prompt-agent.js";
import type { ReferenceDesignGrammar } from "./reference-interpreter.js";

export async function buildReferenceLedImagePrompt(
  input: ImagePromptAgentInput,
  designGrammar: ReferenceDesignGrammar,
  loadPrompt: () => Promise<string> = defaultLoadPrompt
): Promise<string> {
  const supportingLine = input.hook.subheadline?.replace(/\s+/g, " ").trim();

  return [
    (await loadPrompt()).trim(),
    "",
    "APPROVED CAMPAIGN INPUT",
    JSON.stringify(
      {
        brand: {
          name: input.brand?.name ?? "Unknown",
          category: input.brand?.category ?? "Unknown",
          colors: input.brand?.colors ?? []
        },
        campaignIdea: {
          concept: input.hook.concept,
          objective: input.hook.why
        },
        designGrammar,
        visibleCopy: {
          headline: input.hook.hook,
          ...(supportingLine ? { optionalSupportingLine: supportingLine } : {}),
          cta: input.hook.cta
        },
        userInstructions: input.textInputs,
        references: input.referenceImageLabels.map((label, index) => ({
          image: index + 1,
          label
        })),
        output: {
          service: input.service,
          ratio: input.canvasRatio
        }
      },
      null,
      2
    )
  ].join("\n");
}

async function defaultLoadPrompt(): Promise<string> {
  return readFile(
    join(process.cwd(), "agent_prompt", "agent_reference_led_image.md"),
    "utf8"
  );
}
