export const CREATIVE_STRATEGIST_AGENT_NAME = "Creative Strategist";

export const GD_QUALITY_CHECKLIST = [
  "ความสวยงาม องค์ประกอบ และจุดนำสายตา",
  "งาน Final ต้องพัฒนาจาก Mockup ไม่แบนหรือดูเหมือน Template เกินไป",
  "ภาพ Gen AI ต้องเก็บให้สมูธ ไม่ลอยหรือดูตัดแปะ",
  "ตรวจ Logo, Brand CI, ชื่อแบรนด์/สินค้า และข้อความใน Artwork ให้ถูกต้อง"
] as const;

export const GD_CREATIVE_STRATEGIST_CHECKLIST = [
  "ความสวยงาม (Visual Quality)",
  "องค์ประกอบ (Composition)",
  "จุดนำสายตา (Visual Hierarchy)",
  "งาน Final ต้องพัฒนาจาก Mockup",
  "งานไม่แบนหรือดูเป็น Template",
  "ภาพ Gen AI ต้องเก็บให้สมูธ (AI Retouch)",
  "วัตถุต้องไม่ลอยหรือดูตัดแปะ",
  "Logo / Brand CI",
  "ชื่อแบรนด์ / สินค้า",
  "ข้อความใน Artwork"
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
    return ["Creative review direction:", priorityDirection].join("\n");
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
