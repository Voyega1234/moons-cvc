import { describe, expect, it } from "vitest";
import {
  buildQualityRegenerationInstructions,
  type CreativeQualityReport
} from "./quality-check";

describe("buildQualityRegenerationInstructions", () => {
  it("uses the consolidated Creative Strategist direction without duplicating fixes", () => {
    const report: CreativeQualityReport = {
      agentName: "Creative Strategist",
      score: 78,
      summary: "พื้นยังไม่ใช่จุดเด่นและแบรนด์ยังเบาเกินไป",
      gd: {
        passed: false,
        score: 76,
        summary: "ต้องปรับ hierarchy และ brand presence",
        criteria: [
          {
            criterion: "จุดนำสายตา (Visual Hierarchy)",
            passed: false,
            score: 72,
            detail: "เก้าอี้เด่นกว่าพื้นซึ่งเป็นสินค้า",
            suggestion: "ลด contrast เก้าอี้และเพิ่มแสงบนพื้น"
          },
          {
            criterion: "ภาพ Gen AI ต้องเก็บให้สมูธ (AI Retouch)",
            passed: true,
            score: 90,
            detail: "แสงและเงาต่อเนื่องดี",
            suggestion: ""
          }
        ]
      },
      cs: {
        passed: false,
        score: 80,
        summary: "CTA ยังไม่ bottom funnel",
        criteria: [
          {
            criterion: "Key Message ชัด และตรง Brief / Objective",
            passed: false,
            score: 80,
            detail: "ข้อความยังบอกประโยชน์กว้างเกินไป",
            suggestion: "เปลี่ยน CTA เป็นขอตัวอย่างสีจริง"
          }
        ]
      },
      suggestion: {
        title: "ทำให้พื้นเป็น Hero",
        detail: "1. ลดความเด่นของเก้าอี้\n2. เพิ่ม contrast บนพื้น\n3. ใช้ CTA ขอสีตัวอย่าง",
        suggestedHook: "เพิ่มมิติให้พื้นที่เล็ก ด้วยพื้นลายก้างปลา"
      }
    };

    const instructions = buildQualityRegenerationInstructions(report);

    expect(instructions).toContain("Creative review direction:");
    expect(instructions).toContain("1. ลดความเด่นของเก้าอี้");
    expect(instructions).toContain("3. ใช้ CTA ขอสีตัวอย่าง");
    expect(instructions).not.toContain("จุดนำสายตา (Visual Hierarchy)");
    expect(instructions).not.toContain("Key Message ชัด และตรง Brief / Objective");
    expect(instructions).not.toContain("เพิ่มมิติให้พื้นที่เล็ก ด้วยพื้นลายก้างปลา");
    expect(instructions).not.toContain("quality score");
  });
});
