import { describe, expect, it } from "vitest";
import {
  buildHookResearchPrompt,
  hookResearchDossierBlock,
  parseHookResearchDossier
} from "./hook-research-agent";

const dossier = {
  brand: "De Hygienique",
  productFocus: "บริการทำความสะอาดที่นอน",
  overallFinding: "ผู้ชมต้องการหลักฐานเรื่องกระบวนการและเวลาใช้งานต่อ",
  references: [
    {
      id: "ref-01",
      name: "Dry mattress cleaning process",
      type: "product_truth",
      dateOrPeriod: "current",
      finding: "บริการใช้ระบบแห้ง",
      thaiAudienceRelevance: "ลดความกังวลเรื่องเวลารอ",
      brandRelevance: "เป็นกระบวนการของบริการ",
      sourceTitle: "Mattress Cleaning",
      sourcePublisher: "De Hygienique Thailand",
      sourceDate: "",
      sourceUrl: "https://example.com/mattress-cleaning",
      proofType: "official_product_page",
      proofSummary: "หน้า Product ระบุระบบแห้ง",
      brandSafety: "low_risk",
      evidenceStrength: "strong",
      confidenceScore: 94
    }
  ],
  strongestReferenceIds: ["ref-01"],
  researchGaps: [],
  researchLimitations: "",
  excluded: [],
  searchQueriesUsed: ["บริการทำความสะอาดที่นอนระบบแห้ง"]
} as const;

describe("Hook Research Agent contract", () => {
  it("builds a research-only prompt with current runtime evidence", () => {
    const prompt = buildHookResearchPrompt(
      "ห้ามสร้าง Hook, Headline หรือ Content Idea",
      "Brand: De Hygienique\nCurrent brief: mattress cleaning"
    );

    expect(prompt).toContain("ห้ามสร้าง Hook, Headline หรือ Content Idea");
    expect(prompt).toContain("Brand: De Hygienique");
    expect(prompt).toContain("Timezone: Asia/Bangkok");
  });

  it("passes source URLs to the Hook Agent for claim citations", () => {
    const parsed = parseHookResearchDossier(
      `\`\`\`json\n${JSON.stringify(dossier)}\n\`\`\``
    );
    const block = hookResearchDossierBlock(parsed);

    expect(block).toContain("Dedicated Research Agent dossier");
    expect(block).toContain("https://example.com/mattress-cleaning");
    expect(block).toContain("must copy its sourceUrl into citations");
  });

  it("rejects research references without a real HTTP source URL", () => {
    expect(() =>
      parseHookResearchDossier(
        JSON.stringify({
          ...dossier,
          references: [{ ...dossier.references[0], sourceUrl: "invented" }]
        })
      )
    ).toThrow("sourceUrl must be a valid HTTP URL");
  });
});
