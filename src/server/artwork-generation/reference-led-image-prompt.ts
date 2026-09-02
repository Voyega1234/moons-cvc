import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImagePromptAgentInput } from "./image-prompt-agent.js";
import {
  isBrandGuidelineItem,
  isEditableBrandGuidelineItem
} from "./prompt-context.js";
import { compactPromptLibrary } from "./prompt-runtime.js";
import type { ReferenceDesignGrammar } from "./reference-interpreter.js";

export async function buildReferenceLedImagePrompt(
  input: ImagePromptAgentInput,
  designGrammar: ReferenceDesignGrammar,
  loadPrompt: () => Promise<string> = defaultLoadPrompt,
  usePlaceholderCopy = false
): Promise<string> {
  const supportingLine = input.hook.subheadline?.replace(/\s+/g, " ").trim();
  const brandGuidelines = [
    ...input.brandLibrary.docs.filter(isEditableBrandGuidelineItem),
    ...input.brandLibrary.brand.filter(isBrandGuidelineItem)
  ];

  return [
    (await loadPrompt()).trim(),
    "",
    ...(usePlaceholderCopy
      ? [
          "PLACEHOLDER COPY MODE",
          "campaignIdea below carries the real, approved creative concept and objective — use it fully so the hero visual, mood, and mechanism genuinely fit this idea, the same as you would for a normal build. However, this is a layout/design preview: the artwork's final visible text must stay exactly the generic layout placeholders given in visibleCopy below, never the real campaign wording. Even though brandCI is the mandatory authority for colors, logo, typography, and visual style, do not substitute, translate, or replace visibleCopy with any brand tagline, slogan, product name, or claim found in brandCI, campaignIdea, designGrammar, or anywhere else in this prompt, and do not spell out any other real word, tagline, or claim as decorative/hand-drawn/gestural typography either. The only legible campaign text anywhere in the image is the literal visibleCopy given.",
          ""
        ]
      : []),
    "APPROVED CAMPAIGN INPUT",
    JSON.stringify(
      {
        brand: {
          name: input.brand?.name ?? "Unknown",
          category: input.brand?.category ?? "Unknown",
          personality: input.brand?.personality ?? [],
          colors: input.brand?.colors ?? []
        },
        brandCI: {
          authority: "MANDATORY — overrides every conflicting reference trait",
          guidelines: compactPromptLibrary(brandGuidelines, 4, 1_200),
          brandRules: compactPromptLibrary(input.brandLibrary.brand, 6, 600)
        },
        campaignIdea: {
          concept: input.hook.concept,
          objective: input.hook.why
        },
        designGrammar,
        visibleCopy: usePlaceholderCopy
          ? {
              headline: "Headline",
              ...(supportingLine ? { optionalSupportingLine: "Subheadline" } : {}),
              cta: "CTA"
            }
          : {
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
