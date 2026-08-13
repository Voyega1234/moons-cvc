import { describe, expect, it } from "vitest";
import {
  buildHookResearchPrompt,
  hookResearchDossierBlock,
  parseHookResearchDossier
} from "./hook-research-agent";

const dossier = {
  summary: "ผู้ชมต้องการหลักฐานเรื่องกระบวนการและเวลาใช้งานต่อ",
  references: [
    {
      id: "ref-01",
      title: "Mattress Cleaning",
      content: "หน้า Product ระบุว่าบริการใช้ระบบแห้ง",
      publishedAt: "current",
      sourceUrl: "https://example.com/mattress-cleaning",
    }
  ],
  insights: [
    {
      title: "ความกังวลเรื่องเวลารอเกิดจากภาพจำการซักแบบเปียก",
      content: "บริการใช้ระบบแห้งตามหน้า Product ทางการ แต่ลูกค้าอาจยังเชื่อว่าการทำความสะอาดที่นอนต้องรอแห้ง ความเข้าใจผิดนี้อาจทำให้เลื่อนการตัดสินใจ แบรนด์จึงมี Product truth ที่ใช้คลายข้อกังวลได้",
      referenceIds: ["ref-01"]
    }
  ],
  gaps: []
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
    expect(block).toContain("ความกังวลเรื่องเวลารอ");
    expect(block).toContain("Start creative reasoning from insights");
    expect(block).toContain("Treat references as factual guardrails");
    expect(block).toContain("not as a generic fact dump");
    expect(block).toContain(
      "must copy the matching reference sourceUrl into citations"
    );
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

  it("rejects insights that cite unknown reference ids", () => {
    expect(() =>
      parseHookResearchDossier(
        JSON.stringify({
          ...dossier,
          insights: [
            { ...dossier.insights[0], referenceIds: ["missing-ref"] }
          ]
        })
      )
    ).toThrow("references unknown reference id: missing-ref");
  });

  it("rejects insight cards without supporting evidence", () => {
    expect(() =>
      parseHookResearchDossier(
        JSON.stringify({
          ...dossier,
          insights: [{ ...dossier.insights[0], referenceIds: [] }]
        })
      )
    ).toThrow("must include referenceIds");
  });

  it("normalizes a previously saved verbose dossier", () => {
    const parsed = parseHookResearchDossier(JSON.stringify({
      overallFinding: "Legacy summary",
      references: [{
        id: "legacy-ref",
        sourceTitle: "Legacy source",
        proofSummary: "Legacy proof",
        sourceDate: "2026-01-01",
        sourceUrl: "https://example.com/legacy"
      }],
      insightCards: [{
        id: "legacy-insight",
        evidenceIds: ["legacy-ref"],
        tension: "Legacy tension",
        evidence: "Legacy evidence",
        brandConnection: "Legacy connection"
      }],
      researchGaps: []
    }));

    expect(parsed).toMatchObject({
      summary: "Legacy summary",
      references: [{ title: "Legacy source", content: "Legacy proof" }],
      insights: [{ title: "Legacy tension", referenceIds: ["legacy-ref"] }]
    });
  });
});
