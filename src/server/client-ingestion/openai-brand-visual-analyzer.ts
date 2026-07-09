import type {
  BrandSignalAnalysis,
  BrandVisualAnalyzer,
  BrandVisualGuidance,
  MirroredBrandVisualAsset
} from "./client-ingestion-harness";

type FetchLike = typeof fetch;

export interface OpenAiBrandVisualAnalyzerOptions {
  apiKey: string;
  model?: string;
  endpoint?: string;
  fetchImpl?: FetchLike;
  maxImages?: number;
}

type ResponseContent =
  | {
      type: "input_text";
      text: string;
    }
  | {
      type: "input_image";
      image_url: string;
      detail: "auto";
    };

const DEFAULT_MODEL = "gpt-5.5";
const DEFAULT_ENDPOINT = "https://api.openai.com/v1/responses";

export class OpenAiBrandVisualAnalyzer implements BrandVisualAnalyzer {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly fetchImpl: FetchLike;
  private readonly maxImages: number;

  constructor({
    apiKey,
    model = DEFAULT_MODEL,
    endpoint = DEFAULT_ENDPOINT,
    fetchImpl = fetch,
    maxImages = 12
  }: OpenAiBrandVisualAnalyzerOptions) {
    if (!apiKey.trim()) throw new Error("OPENAI_API_KEY is required.");

    this.apiKey = apiKey;
    this.model = model;
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
    this.maxImages = maxImages;
  }

  async analyze(
    input: Parameters<BrandVisualAnalyzer["analyze"]>[0]
  ): Promise<BrandSignalAnalysis> {
    const visualAssets = selectBalancedBySource(
      input.visualAssets.filter((asset) => asset.assetUrl),
      this.maxImages
    );

    if (!visualAssets.length && !input.textEvidence.length) {
      throw new Error("No brand evidence is available for analysis.");
    }

    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        store: false,
        input: [
          {
            role: "user",
            content: buildResponseContent(input, visualAssets)
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "brand_visual_analysis",
            strict: true,
            schema: brandVisualAnalysisSchema
          }
        }
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI visual analysis failed: ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    const text = extractResponseText(payload);
    const analysis = parseBrandSignalAnalysisJson(text);

    return {
      ...analysis,
      rawOutput: payload
    };
  }
}

function buildResponseContent(
  input: Parameters<BrandVisualAnalyzer["analyze"]>[0],
  visualAssets: readonly MirroredBrandVisualAsset[]
): ResponseContent[] {
  const content: ResponseContent[] = [
    {
      type: "input_text",
      text: buildPrompt(input, visualAssets)
    }
  ];

  for (const asset of visualAssets) {
    content.push({
      type: "input_text",
      text: [
        `Source asset path: ${asset.assetStoragePath}`,
        `Source type: ${asset.sourceType}`,
        asset.captionContext ? `Caption context: ${asset.captionContext}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    });
    content.push({
      type: "input_image",
      image_url: asset.assetUrl ?? "",
      detail: "auto"
    });
  }

  return content;
}

function buildPrompt(
  input: Parameters<BrandVisualAnalyzer["analyze"]>[0],
  visualAssets: readonly MirroredBrandVisualAsset[]
): string {
  const textEvidence = selectBalancedBySource(
    input.textEvidence.filter((evidence) => evidence.text.trim()),
    60
  );

  return [
    `วิเคราะห์และทำความรู้จักแบรนด์ ${input.client.name} สำหรับใช้สร้างครีเอทีฟโฆษณา`,
    "",
    "ใช้เฉพาะข้อมูลโพสต์ โฆษณา และรูปภาพที่ให้มา ห้ามแต่งข้อมูลที่ไม่มีหลักฐาน",
    "ตอบทุก field เป็นภาษาไทย ยกเว้นชื่อแบรนด์ ชื่อสินค้า Tagline ชื่อแพลตฟอร์ม และศัพท์เฉพาะ",
    "ห้ามสรุปว่าคอนเทนต์ทำงานดีจาก engagement เพียงอย่างเดียว และห้ามวิเคราะห์วิดีโอ",
    "ต้องวิเคราะห์ทั้ง Organic Facebook Posts และ Facebook Ads Library เมื่อมีข้อมูลจากทั้งสองแหล่ง",
    "ใช้ Posts เพื่อเข้าใจตัวตนแบรนด์ เนื้อหาปกติ และความสัมพันธ์กับผู้ติดตาม",
    "ใช้ Ads เพื่อเข้าใจข้อเสนอ ประโยชน์ กลุ่มเป้าหมาย CTA และ claim ที่ใช้เชิงพาณิชย์",
    "หากสองแหล่งให้ข้อมูลไม่ตรงกัน ให้ระบุความไม่แน่นอนและตั้ง needsReview เป็น true",
    "",
    "Brand kit ต้องครอบคลุม:",
    "- แบรนด์ทำอะไร",
    "- กลุ่มเป้าหมายและปัญหาที่ต้องการแก้",
    "- จุดยืน จุดแตกต่าง และคุณค่าหลัก",
    "- น้ำเสียงและแนวทางการสื่อสาร",
    "- ข้อความหรือกฎที่ควรใช้ในการสร้างครีเอทีฟ",
    "",
    "แยกสินค้าและบริการที่พบออกเป็น products โดยแต่ละรายการต้องมี:",
    "- name: ชื่อสินค้า/บริการ",
    "- description: คืออะไร",
    "- offer: ข้อเสนอหรือสิ่งที่ลูกค้าจะได้รับ",
    "- keyBenefit: ประโยชน์หลัก",
    "- audience: กลุ่มเป้าหมาย",
    "- claimNotes: claim ที่พบพร้อมข้อควรระวัง ห้ามรับรอง claim ที่ไม่มีหลักฐาน",
    "หากระบุสินค้า/บริการไม่ได้อย่างมีหลักฐาน ให้คืน products เป็น array ว่าง",
    "",
    "Visual guidance เป็นเพียงหนึ่งส่วน โดยสรุป mood, สี, layout, typography และ visual do/don't",
    "Brand learning ในขั้นนี้เป็นเพียง observed signals ไม่ใช่ผลการทดสอบ performance",
    "ทุกข้อสรุปสำคัญต้องตรวจสอบย้อนกลับไปยังหลักฐานที่ให้มาได้",
    "",
    `Source summary: ${input.sourceSummary.postsSaved} posts, ${input.sourceSummary.adsSaved} ads, fallback search used: ${input.sourceSummary.usedFallbackSearch}.`,
    `Mirrored image count: ${visualAssets.length}.`,
    "",
    "Text evidence:",
    ...textEvidence.map(
      (evidence) =>
        `- [${evidence.sourceType}:${evidence.sourceId}] ${evidence.text.slice(0, 1200)}`
    ),
    "",
    "Available source asset paths:",
    ...visualAssets.map((asset) => `- ${asset.assetStoragePath}`)
  ].join("\n");
}

export function selectBalancedBySource<
  T extends { sourceType: "facebook_post" | "facebook_ad" }
>(items: readonly T[], limit: number): T[] {
  if (limit <= 0) return [];

  const posts = items.filter((item) => item.sourceType === "facebook_post");
  const ads = items.filter((item) => item.sourceType === "facebook_ad");
  if (!posts.length || !ads.length) return items.slice(0, limit);

  const selected = [
    ...posts.slice(0, Math.ceil(limit / 2)),
    ...ads.slice(0, Math.floor(limit / 2))
  ];

  if (selected.length >= limit) return selected.slice(0, limit);

  const selectedSet = new Set(selected);
  return [
    ...selected,
    ...items.filter((item) => !selectedSet.has(item))
  ].slice(0, limit);
}

const stringArraySchema = {
  type: "array",
  items: { type: "string" }
} as const;

const brandVisualAnalysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    brandKitEntries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          description: { type: "string" }
        },
        required: ["title", "description"]
      }
    },
    learning: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          polarity: {
            type: "string",
            enum: ["working", "avoid"]
          },
          note: { type: "string" }
        },
        required: ["polarity", "note"]
      }
    },
    products: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          offer: { type: "string" },
          keyBenefit: { type: "string" },
          audience: { type: "string" },
          claimNotes: { type: "string" }
        },
        required: [
          "name",
          "description",
          "offer",
          "keyBenefit",
          "audience",
          "claimNotes"
        ]
      }
    },
    visualGuidance: {
      type: "object",
      additionalProperties: false,
      properties: {
        mood: stringArraySchema,
        colorPalette: stringArraySchema,
        layoutPatterns: stringArraySchema,
        textOverlay: stringArraySchema,
        typographyFeel: stringArraySchema,
        productPersonEnvironment: stringArraySchema,
        dos: stringArraySchema,
        donts: stringArraySchema,
        sourceAssetPaths: stringArraySchema
      },
      required: [
        "mood",
        "colorPalette",
        "layoutPatterns",
        "textOverlay",
        "typographyFeel",
        "productPersonEnvironment",
        "dos",
        "donts",
        "sourceAssetPaths"
      ]
    },
    needsReview: { type: "boolean" },
    reviewReason: { type: "string" }
  },
  required: [
    "brandKitEntries",
    "learning",
    "products",
    "visualGuidance",
    "needsReview",
    "reviewReason"
  ]
} as const;

export function extractResponseText(payload: unknown): string {
  if (isRecord(payload) && typeof payload.output_text === "string") {
    return payload.output_text;
  }

  if (!isRecord(payload) || !Array.isArray(payload.output)) {
    throw new Error("OpenAI visual analysis response did not include output text.");
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

  throw new Error("OpenAI visual analysis response did not include output text.");
}

export function parseBrandSignalAnalysisJson(text: string): BrandSignalAnalysis {
  const parsed = JSON.parse(text) as unknown;

  if (!isRecord(parsed)) {
    throw new Error("OpenAI visual analysis returned invalid JSON.");
  }

  return {
    brandKitEntries: readBrandKitEntries(parsed.brandKitEntries),
    learning: readLearning(parsed.learning),
    products: readProducts(parsed.products),
    visualGuidance: readVisualGuidance(parsed.visualGuidance),
    needsReview: parsed.needsReview === true,
    reviewReason: typeof parsed.reviewReason === "string" ? parsed.reviewReason : ""
  };
}

function readProducts(value: unknown): BrandSignalAnalysis["products"] {
  if (!Array.isArray(value)) throw new Error("products must be an array.");

  return value.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.name !== "string" ||
      typeof item.description !== "string" ||
      typeof item.offer !== "string" ||
      typeof item.keyBenefit !== "string" ||
      typeof item.audience !== "string" ||
      typeof item.claimNotes !== "string"
    ) {
      throw new Error("products contains an invalid item.");
    }

    return {
      name: item.name,
      description: item.description,
      offer: item.offer,
      keyBenefit: item.keyBenefit,
      audience: item.audience,
      claimNotes: item.claimNotes
    };
  });
}

function readBrandKitEntries(value: unknown): BrandSignalAnalysis["brandKitEntries"] {
  if (!Array.isArray(value)) throw new Error("brandKitEntries must be an array.");

  return value.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.title !== "string" ||
      typeof item.description !== "string"
    ) {
      throw new Error("brandKitEntries contains an invalid item.");
    }

    return {
      title: item.title,
      description: item.description
    };
  });
}

function readLearning(value: unknown): BrandSignalAnalysis["learning"] {
  if (!Array.isArray(value)) throw new Error("learning must be an array.");

  return value.map((item) => {
    if (
      !isRecord(item) ||
      (item.polarity !== "working" && item.polarity !== "avoid") ||
      typeof item.note !== "string"
    ) {
      throw new Error("learning contains an invalid item.");
    }

    return {
      polarity: item.polarity,
      note: item.note
    };
  });
}

function readVisualGuidance(value: unknown): BrandVisualGuidance {
  if (!isRecord(value)) throw new Error("visualGuidance must be an object.");

  return {
    mood: readStringArray(value.mood, "mood"),
    colorPalette: readStringArray(value.colorPalette, "colorPalette"),
    layoutPatterns: readStringArray(value.layoutPatterns, "layoutPatterns"),
    textOverlay: readStringArray(value.textOverlay, "textOverlay"),
    typographyFeel: readStringArray(value.typographyFeel, "typographyFeel"),
    productPersonEnvironment: readStringArray(
      value.productPersonEnvironment,
      "productPersonEnvironment"
    ),
    dos: readStringArray(value.dos, "dos"),
    donts: readStringArray(value.donts, "donts"),
    sourceAssetPaths: readStringArray(value.sourceAssetPaths, "sourceAssetPaths")
  };
}

function readStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${fieldName} must be an array of strings.`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
