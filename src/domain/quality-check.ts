export const CREATIVE_STRATEGIST_AGENT_NAME = "Creative Strategist";

export const GD_QUALITY_CHECKLIST = [
  "Visual Quality และ Design Principles ครบถ้วนบนหน้าจอมือถือ",
  "หยุดสายตาลูกค้าและส่งผลบวกต่อภาพลักษณ์แบรนด์ ไม่ดูเป็นงาน AI คุณภาพต่ำ",
  "แสง เงา วัสดุ perspective และ contact shadow สมจริงเป็นระบบเดียวกัน",
  "งาน Final ผ่านการ art direct และ retouch ไม่แบนหรือดูเป็น Template",
  "ไม่พบร่องรอย AI-generated ที่พิสูจน์ได้ วัตถุไม่ลอยหรือตัดแปะ",
  "Logo, Brand CI, ชื่อแบรนด์/สินค้า และข้อความใน Artwork ถูกต้อง"
] as const;

export const GD_CREATIVE_STRATEGIST_CHECKLIST = [
  "ความสวยงามและความพร้อมใช้งานจริง (Visual Quality)",
  "ภาพหยุดสายตาและส่งผลต่อแบรนด์อย่างไร? (Stop-scroll & Brand Impact Audit)",
  "องค์ประกอบและสมดุล (Composition & Balance)",
  "จุดนำสายตา การเน้น ความเด่น และการเคลื่อนไหว (Hierarchy, Emphasis, Dominance & Movement)",
  "ความต่าง การจัดแนว และความใกล้ชิด (Contrast, Alignment & Proximity)",
  "สัดส่วน ขนาด และพื้นที่ว่าง (Proportion, Scale & Space)",
  "เอกภาพ ความหลากหลาย รูปแบบ และจังหวะ (Unity, Variety, Pattern & Rhythm)",
  "แสง เงา วัสดุ และความสมจริง (Lighting, Shadow & Material Realism)",
  "งาน Final และความไม่เป็น Template (Production Finish)",
  "งานนี้ดูออกว่าทำจาก AI หรือไม่? (AI-origin Audit)",
  "วัตถุต้องไม่ลอยหรือดูตัดแปะ",
  "Logo / Brand CI และชื่อแบรนด์ / สินค้า",
  "ข้อความใน Artwork และการอ่านบนมือถือ"
] as const;

export const CS_QUALITY_CHECKLIST = [
  "Key Message ชัด และตรง Brief / Objective",
  "Visual กับ Caption สื่อสารไปในทิศทางเดียวกัน",
  "ข้อมูล ราคา โปรโมชัน คำสะกด และรายละเอียดต่าง ๆ ถูกต้อง"
] as const;

export interface QualityCriterionResult {
  criterion: string;
  passed: boolean;
  score: number;
  detail: string;
  suggestion: string;
}

export interface QualityAreaResult {
  passed: boolean;
  score: number;
  summary: string;
  criteria: readonly QualityCriterionResult[];
}

export interface QualitySuggestion {
  title: string;
  detail: string;
  suggestedHook: string;
}

export interface CreativeQualityReport {
  agentName?: string;
  score: number;
  summary: string;
  gd: QualityAreaResult;
  cs: QualityAreaResult;
  suggestion: QualitySuggestion;
}

export function buildQualityRegenerationInstructions(
  report: CreativeQualityReport
): string {
  const priorityDirection = report.suggestion.detail.trim();
  if (priorityDirection) {
    const productionRequirements = report.gd.criteria
      .filter(
        (criterion) =>
          !criterion.passed &&
          (criterion.criterion.includes("Stop-scroll & Brand Impact Audit") ||
            criterion.criterion.includes("AI-origin Audit") ||
            criterion.criterion.includes("Lighting, Shadow & Material Realism"))
      )
      .map((criterion) => criterion.suggestion.trim() || criterion.detail.trim())
      .filter(
        (instruction) =>
          Boolean(instruction) && !priorityDirection.includes(instruction)
      );

    return [
      "Creative review direction:",
      priorityDirection,
      ...(productionRequirements.length
        ? [
            "Mandatory production finish:",
            ...productionRequirements.map(
              (instruction, index) => `${index + 1}. ${instruction}`
            )
          ]
        : [])
    ].join("\n");
  }

  const requiredFixes = [...report.gd.criteria, ...report.cs.criteria].filter(
    (criterion) => !criterion.passed && Boolean(criterion.suggestion.trim())
  );
  if (!requiredFixes.length) return "";

  return [
    "Required improvements:",
    ...requiredFixes.map(
      (criterion, index) =>
        `${index + 1}. ${criterion.criterion}: ${criterion.suggestion.trim()}`
    )
  ].join("\n");
}
