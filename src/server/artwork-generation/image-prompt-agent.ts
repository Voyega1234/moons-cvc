type FetchLike = typeof fetch;

export interface ImagePromptAgentHook {
  hook: string;
  concept: string;
  why: string;
  visual: string;
  cta: string;
  caption: string;
}

export interface ImagePromptAgentInput {
  brand: { name: string; category: string } | null;
  service: string;
  brief: string;
  hook: ImagePromptAgentHook;
  textInputs: readonly string[];
  referenceImageLabels: readonly string[];
  canvasRatio: string;
  brandMemory: {
    working: readonly string[];
    avoid: readonly string[];
  };
  brandLibrary: {
    brand: readonly { title: string; description: string }[];
    products: readonly { title: string; description: string }[];
  };
}

const DEFAULT_MODEL = "gpt-5.6-terra";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

export async function generateImagePrompt({
  apiKey,
  model,
  fetchImpl,
  input
}: {
  apiKey: string;
  model?: string;
  fetchImpl: FetchLike;
  input: ImagePromptAgentInput;
}): Promise<string> {
  const response = await fetchImpl(OPENAI_RESPONSES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model?.trim() || DEFAULT_MODEL,
      store: false,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: buildAgentPrompt(input) }]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "moons_image_generation_prompt",
          strict: true,
          schema: imagePromptSchema
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI image prompt agent failed: ${response.status}`);
  }

  const payload = await readJsonResponse(response, "OpenAI image prompt agent");
  const text = extractResponseText(payload);
  const parsed = JSON.parse(text) as { prompt?: unknown };

  if (typeof parsed.prompt !== "string" || !parsed.prompt.trim()) {
    throw new Error("OpenAI image prompt agent returned an empty prompt.");
  }

  return parsed.prompt.trim();
}

const STYLE_LIBRARY: readonly [string, string][] = [
  ["Luxury Typography", "premium beauty, wellness, hospitality, finance, high-value products"],
  ["Japandi", "wellness, home, mattress, skincare, natural products, mindful lifestyle"],
  ["Art Deco", "premium events, luxury property, jewelry, nightlife, upscale food"],
  ["Bauhaus", "technology, education, architecture, B2B, structured retail"],
  ["Neo-Brutalism", "direct response, SaaS, agencies, youth brands, lead generation"],
  ["Pop Art", "retail, FMCG, food, snacks, flash sales, mass-market promotions"],
  ["Modular Typography", "headline-led ads, automotive, technology, events, B2B"],
  ["Mixed Media", "social-native campaigns, travel, fashion, youth lifestyle"],
  ["Surrealism", "service metaphors, technology, finance, transformation, awareness"],
  ["Rebus / Visual Pun", "service advertising, education, B2B, witty awareness campaigns"],
  ["Utilitarian", "automotive, engineering, clinics, technical services, proof-led B2B"],
  ["Bento Box", "SaaS, service packages, ecosystems, multi-benefit campaigns"],
  ["Glassmorphism", "SaaS, mobile apps, fintech, digital services"],
  ["Tenebrism", "premium automotive, fragrance, dramatic launches, premium food"],
  ["Mid-Century Modern", "home, travel, food, family products, optimistic lifestyle"],
  ["Scrapbook", "UGC-inspired ads, testimonials, community, creators"],
  ["Y2K", "Gen Z fashion, beauty, entertainment, youth technology"],
  ["Neo Frutiger Aero", "playful technology, family apps, youth fintech"],
  ["Kawaii", "children's products, family campaigns, snacks, playful education"],
  ["Graffiti / Street Graphic", "streetwear, sports, music, youth events"]
];

function buildAgentPrompt(input: ImagePromptAgentInput): string {
  return [
    "You are a Senior Creative Director, Art Director, and AI Image Prompt Director.",
    "",
    "Transform the brief below into ONE final production-ready prompt for the GPT Image model to create a complete paid social advertising image.",
    "",
    "The result must look like a finished agency campaign key visual. It must NOT look like: a generic AI-generated ad, a Canva template, a product pasted over a gradient, a decorative moodboard, an unfinished concept, or a layout reused across unrelated brands.",
    "",
    "CONCRETE-DESIGN RULE: never rely on abstract words alone (premium, modern, dynamic, scroll-stopping...). Translate every such word into visible decisions: hero size and placement, camera angle, cropping, font personality, headline scale, background function, color hierarchy, lighting direction, shadow softness, CTA placement.",
    "",
    "SILENT INTERNAL PROCESS (do not output this reasoning):",
    "1. Reduce the brief to: the single message the viewer must understand first, the strongest audience desire, the main commercial promise, the required action.",
    "2. Choose ONE selling mechanism (visible benefit / problem-solution / transformation / proof / offer / emotional outcome / metaphor).",
    "3. Choose ONE creative mode (hero product ad / offer-led / lifestyle benefit / problem-solution / trust ad / premium editorial / technical authority / social-native, etc).",
    "4. Choose ONE energy level (calm premium / balanced commercial / high-energy promotional) and translate it into type scale, contrast, density, CTA intensity.",
    "5. Internally sketch three different composition concepts, score each for one-second clarity, selling strength, product prominence, brand fit, and mobile readability. Keep only the strongest. Do not output the alternatives.",
    "",
    "STYLE SELECTION: choose exactly ONE primary style from this library (name — best for), and let it control at least 80% of the visual system. Do not blend two styles equally.",
    ...STYLE_LIBRARY.map(([name, bestFor]) => `- ${name} — ${bestFor}`),
    "",
    "ANTI-AI-SLOP CHECK — reject and redesign internally if the concept relies on any of these without strategic reason: product floating over a generic gradient, hard 50/50 split layout, image-on-top-text-block-below, centered product surrounded by icons, random neon glow, glossy plastic 3D objects, floating geometric shapes, meaningless particles, fake futuristic UI, excessive lens flare/bokeh, unreadable packaging labels, duplicated products, incorrect anatomy, inconsistent shadows, unrelated scenery, stock-photo expressions, every element centered, logo larger than the selling message, or a composition reusable unchanged for another brand.",
    "",
    "THAI TEXT: if any provided copy is in Thai, use it exactly as given — do not rewrite, paraphrase, or invent filler text; preserve spelling, punctuation, tone marks, and line breaks based on meaning.",
    "",
    buildInputBrief(input),
    "",
    "Return only the final prompt via the schema field. The final prompt must explicitly cover: canvas ratio, selected creative mode and energy level, selected style and its concrete translation, single selling message and visual hook, hero visual (what/scale/placement/camera angle), layout archetype and visual axis, typography (personality, headline shape, emphasized keywords, CTA treatment), background function, color hierarchy, lighting direction, material/texture, product and logo fidelity, and confirmation it avoids the anti-AI-slop list above. Write it as one coherent production instruction in English, not a list of vague adjectives."
  ].join("\n");
}

function buildInputBrief(input: ImagePromptAgentInput): string {
  return [
    "## Input brief",
    `Brand: ${input.brand?.name ?? "Unknown"} (${input.brand?.category ?? "Unknown category"})`,
    `Service / format: ${input.service}`,
    `Canvas ratio: ${input.canvasRatio}`,
    "",
    `Hook (primary headline idea): ${input.hook.hook}`,
    `Concept: ${input.hook.concept}`,
    `Why it works: ${input.hook.why}`,
    `Visual direction: ${input.hook.visual}`,
    `CTA: ${input.hook.cta}`,
    `Caption / supporting copy: ${input.hook.caption}`,
    "",
    `Brief: ${input.brief}`,
    ...(input.textInputs.length
      ? ["", "Extra instructions:", ...input.textInputs.map((item) => `- ${item}`)]
      : []),
    "",
    "Brand personality / voice / CI (from Brand Kit):",
    ...(input.brandLibrary.brand.length
      ? input.brandLibrary.brand.map((item) => `- ${item.title}: ${item.description}`)
      : ["- Not provided."]),
    "",
    "Products / offers (from Brand Memory):",
    ...(input.brandLibrary.products.length
      ? input.brandLibrary.products.map((item) => `- ${item.title}: ${item.description}`)
      : ["- Not provided."]),
    "",
    "What's working (reuse these patterns):",
    ...(input.brandMemory.working.length
      ? input.brandMemory.working.map((item) => `- ${item}`)
      : ["- None recorded."]),
    "",
    "Elements to avoid:",
    ...(input.brandMemory.avoid.length
      ? input.brandMemory.avoid.map((item) => `- ${item}`)
      : ["- None recorded."]),
    "",
    "Reference images attached (already provided to the model as image input, describe how to use them, do not re-describe their content from imagination):",
    ...(input.referenceImageLabels.length
      ? input.referenceImageLabels.map((label) => `- ${label}`)
      : ["- None attached."])
  ].join("\n");
}

const imagePromptSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    prompt: { type: "string" }
  },
  required: ["prompt"]
} as const;

function extractResponseText(payload: unknown): string {
  if (isRecord(payload) && typeof payload.output_text === "string") {
    return payload.output_text;
  }

  if (!isRecord(payload) || !Array.isArray(payload.output)) {
    throw new Error("OpenAI image prompt agent response did not include output text.");
  }

  for (const item of payload.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (
        isRecord(content) &&
        content.type === "output_text" &&
        typeof content.text === "string"
      ) {
        return content.text;
      }
    }
  }

  throw new Error("OpenAI image prompt agent response did not include output text.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readJsonResponse(
  response: Response,
  label: string
): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(`${label} returned an empty response body.`);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} returned a non-JSON response.`);
  }
}
