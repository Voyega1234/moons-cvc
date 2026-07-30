import { describe, expect, it, vi } from "vitest";
import {
  normalizeCampaignTruth,
  type AuthoritativeCampaignPacket
} from "./campaign-truth-normalizer-agent";

const packet: AuthoritativeCampaignPacket = {
  campaign: {
    brand: "Power Art Material",
    productOrService: "พื้นกระเบื้องยาง SPC ลายไม้",
    campaignObjective: "Conversion",
    platform: "Meta Feed",
    canvas: "4:5 single-static",
    targetAudience: "เจ้าของบ้านที่ต้องการเปลี่ยนบรรยากาศบ้าน",
    audienceMoment: "กังวลว่าการเปลี่ยนพื้นจะเป็นงานรีโนเวทใหญ่",
    mainMessage: "เปลี่ยนบรรยากาศบ้านโดยไม่ขยาย claim เกินข้อมูลสินค้า"
  },
  copy: {
    headline: "พื้นเดิมยังอยู่ บ้านก็เปลี่ยนได้",
    highlightedPhrase: "บ้านก็เปลี่ยนได้",
    featureName: "ปูทับพื้นเดิม",
    featureValueProposition:
      "ปูทับพื้นเดิมได้ตามความเหมาะสมของหน้างาน",
    supportingConversionLine: "OMIT",
    cta: "ปรึกษาการปูทับพื้นเดิม",
    requiredUtilityInformation: []
  },
  creative: {
    executionMode: "product-led-performance",
    informationDensity: "low",
    humanPresence: "not-required"
  },
  brandVisual: {
    brandVisualCharacter: ["warm", "practical"],
    brandPalette: ["#163F35", "#D3A544"],
    referenceIntent: "OMIT"
  },
  truthAndGuardrails: {
    verifiedFacts: [
      "ปูทับพื้นเดิมได้ตามความเหมาะสมของหน้างาน"
    ],
    restrictions: [
      "Do not claim that every existing floor is suitable for overlay installation"
    ],
    latestUserCorrection: "OMIT"
  },
  officialAssets: [
    {
      assetId: "image-1",
      assetType: "official-logo",
      role: "brand identification",
      preservationInstruction: "Preserve exactly and use once"
    }
  ]
};

const input = {
  brand: {
    name: "Power Art Material",
    category: "พื้นกระเบื้องยาง SPC ลายไม้",
    personality: ["warm", "practical"],
    colors: ["#163F35", "#D3A544"]
  },
  service: "single-static",
  platform: "Meta Feed",
  canvas: "4:5 single-static",
  brief: "สร้างงาน Conversion สำหรับเจ้าของบ้าน",
  hook: {
    hook: "พื้นเดิมยังอยู่ บ้านก็เปลี่ยนได้",
    concept: "เปลี่ยนบรรยากาศบ้านโดยไม่ขยาย claim เกินข้อมูลสินค้า",
    why: "ลดความกังวลเรื่องงานรีโนเวท",
    visual: "",
    cta: "ปรึกษาการปูทับพื้นเดิม",
    supportingPoints: [
      "ปูทับพื้นเดิม",
      "ปูทับพื้นเดิมได้ตามความเหมาะสมของหน้างาน"
    ],
    caption: ""
  },
  latestUserCorrection: null,
  selectedProducts: [
    {
      title: "พื้นกระเบื้องยาง SPC ลายไม้",
      description:
        "ปูทับพื้นเดิมได้ตามความเหมาะสมของหน้างาน"
    }
  ],
  brandGuidelines: [],
  brandRestrictions: [],
  officialAssetInventory: [
    {
      assetId: "image-1",
      assetType: "official-logo",
      role: "brand identification",
      preservationInstruction: "Preserve exactly and use once"
    }
  ]
};

describe("normalizeCampaignTruth", () => {
  it("returns and validates the locked nested campaign packet", async () => {
    const calls: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({ output_text: JSON.stringify(packet) }),
          { status: 200 }
        );
      }
    );

    const result = await normalizeCampaignTruth({
      apiKey: "test-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
      input
    });

    expect(result).toEqual(packet);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toMatchObject({
      format: {
        name: "moons_authoritative_campaign_packet",
        strict: true,
        schema: {
          required: [
            "campaign",
            "copy",
            "creative",
            "brandVisual",
            "truthAndGuardrails",
            "officialAssets"
          ]
        }
      }
    });
    expect(JSON.stringify(calls[0]?.text)).not.toContain("maxItems");
  });

  it("rejects a feature value that removes a material qualifier", async () => {
    const unsafePacket = {
      ...packet,
      copy: {
        ...packet.copy,
        featureValueProposition: "เปลี่ยนพื้นได้ทันทีโดยไม่ต้องรื้อ"
      }
    };
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ output_text: JSON.stringify(unsafePacket) }),
        { status: 200 }
      )
    );

    await expect(
      normalizeCampaignTruth({
        apiKey: "test-key",
        fetchImpl: fetchMock as unknown as typeof fetch,
        input
      })
    ).rejects.toThrow(
      "featureValueProposition is not a verbatim excerpt of supplied evidence"
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
