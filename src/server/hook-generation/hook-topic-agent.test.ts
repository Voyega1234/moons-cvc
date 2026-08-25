import { describe, expect, it } from "vitest";
import {
  buildHookTopicsPrompt,
  hookTopicShortlistBlock,
  parseHookTopicShortlist
} from "./hook-topic-agent";
import type { HookResearchDossier } from "./hook-research-agent";

const dossier: HookResearchDossier = {
  summary: "ผู้ชมต้องการหลักฐานเรื่องกระบวนการและเวลาใช้งานต่อ",
  references: [
    {
      id: "ref-01",
      title: "Mattress Cleaning",
      content: "หน้า Product ระบุว่าบริการใช้ระบบแห้ง",
      publishedAt: "current",
      sourceUrl: "https://example.com/mattress-cleaning"
    }
  ],
  insights: [
    {
      title: "ความกังวลเรื่องเวลารอเกิดจากภาพจำการซักแบบเปียก",
      content: "บริการใช้ระบบแห้งตามหน้า Product ทางการ แต่ลูกค้าอาจยังเชื่อว่าการทำความสะอาดที่นอนต้องรอแห้ง",
      referenceIds: ["ref-01"]
    }
  ],
  gaps: []
};

describe("Hook Topic Agent contract", () => {
  it("builds a topic prompt that carries the research dossier", () => {
    const prompt = buildHookTopicsPrompt(
      "ห้ามเขียน Hook หรือ Headline สำเร็จรูป",
      "Brand: De Hygienique\nCurrent brief: mattress cleaning",
      dossier
    );

    expect(prompt).toContain("ห้ามเขียน Hook หรือ Headline สำเร็จรูป");
    expect(prompt).toContain("Brand: De Hygienique");
    expect(prompt).toContain("# Dedicated Research Agent dossier");
    expect(prompt).toContain("ความกังวลเรื่องเวลารอเกิดจากภาพจำการซักแบบเปียก");
  });

  it("parses a valid topic shortlist", () => {
    const parsed = parseHookTopicShortlist(
      JSON.stringify({
        topics: [
          { topic: "ที่นอนสะอาดโดยไม่ต้องรอแห้งนาน", why: "แก้ความเข้าใจผิดเรื่องเวลารอ" }
        ]
      })
    );

    expect(parsed.topics).toEqual([
      { topic: "ที่นอนสะอาดโดยไม่ต้องรอแห้งนาน", why: "แก้ความเข้าใจผิดเรื่องเวลารอ" }
    ]);
  });

  it("unwraps a markdown-fenced JSON response", () => {
    const parsed = parseHookTopicShortlist(
      `\`\`\`json\n${JSON.stringify({
        topics: [{ topic: "ทดสอบ", why: "ทดสอบเหตุผล" }]
      })}\n\`\`\``
    );

    expect(parsed.topics).toHaveLength(1);
  });

  it("rejects a response without a topics array", () => {
    expect(() => parseHookTopicShortlist(JSON.stringify({}))).toThrow(
      "must return a topics array"
    );
  });

  it("rejects an empty topics array", () => {
    expect(() =>
      parseHookTopicShortlist(JSON.stringify({ topics: [] }))
    ).toThrow("at least one topic");
  });

  it("rejects topics missing a non-empty topic or why", () => {
    expect(() =>
      parseHookTopicShortlist(
        JSON.stringify({ topics: [{ topic: "", why: "เหตุผล" }] })
      )
    ).toThrow("topics[0] must include non-empty topic and why");

    expect(() =>
      parseHookTopicShortlist(
        JSON.stringify({ topics: [{ topic: "หัวข้อ", why: "" }] })
      )
    ).toThrow("topics[0] must include non-empty topic and why");
  });

  it("builds a shortlist block that frames topics as an idea pool, not a checklist", () => {
    const block = hookTopicShortlistBlock({
      topics: [
        { topic: "ที่นอนสะอาดโดยไม่ต้องรอแห้งนาน", why: "แก้ความเข้าใจผิดเรื่องเวลารอ" }
      ]
    });

    expect(block).toContain("# Topic Agent shortlist");
    expect(block).toContain("not a checklist to cover one-to-one");
    expect(block).toContain("ที่นอนสะอาดโดยไม่ต้องรอแห้งนาน");
    expect(block).toContain("แก้ความเข้าใจผิดเรื่องเวลารอ");
  });
});
