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

  it("adds mandatory production fixes when brand impact, lighting, or AI-origin checks fail", () => {
    const report: CreativeQualityReport = {
      agentName: "Creative Strategist",
      score: 68,
      summary: "ภาพยังมีร่องรอยงาน Gen AI ที่เห็นได้ชัด",
      gd: {
        passed: false,
        score: 64,
        summary: "แสงและวัสดุยังไม่เป็นระบบเดียวกัน",
        criteria: [
          {
            criterion:
              "ภาพหยุดสายตาและส่งผลต่อแบรนด์อย่างไร? (Stop-scroll & Brand Impact Audit)",
            passed: false,
            score: 55,
            detail:
              "Stop-scroll verdict: Weak; Brand perception: Risk เพราะภาพดู generic และไม่สร้างความน่าเชื่อถือ",
            suggestion:
              "สร้าง visual hook ที่เฉพาะกับแบรนด์และลดองค์ประกอบ generic ที่ทำให้งานดูราคาถูก"
          },
          {
            criterion:
              "แสง เงา วัสดุ และความสมจริง (Lighting, Shadow & Material Realism)",
            passed: false,
            score: 62,
            detail: "เงาสัมผัสพื้นหายและแสงบนวัตถุขัดกัน",
            suggestion:
              "จัดทิศทางแสงใหม่และเพิ่ม contact shadow ให้ทุกวัตถุสัมผัสพื้น"
          },
          {
            criterion: "งานนี้ดูออกว่าทำจาก AI หรือไม่? (AI-origin Audit)",
            passed: false,
            score: 58,
            detail:
              "AI-origin verdict: Looks AI-generated เพราะวัสดุพลาสติกและลายพื้นซ้ำ",
            suggestion:
              "ลดผิวพลาสติก แก้ลายซ้ำ และ retouch ขอบวัตถุให้เป็นธรรมชาติ"
          }
        ]
      },
      cs: {
        passed: true,
        score: 90,
        summary: "สารและ CTA ตรงกับ Brief",
        criteria: []
      },
      suggestion: {
        title: "ทำให้งานดูผ่านการผลิตจริง",
        detail: "1. ลดความแน่นขององค์ประกอบ\n2. เพิ่มพื้นที่พักสายตา",
        suggestedHook: ""
      }
    };

    const instructions = buildQualityRegenerationInstructions(report);

    expect(instructions).toContain("Mandatory production finish:");
    expect(instructions).toContain("visual hook ที่เฉพาะกับแบรนด์");
    expect(instructions).toContain("contact shadow");
    expect(instructions).toContain("ลดผิวพลาสติก");
    expect(instructions).not.toContain("Looks AI-generated");
  });
});
