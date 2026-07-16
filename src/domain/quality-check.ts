export const GD_QUALITY_CHECKLIST = [
  "ความสวยงาม องค์ประกอบ และจุดนำสายตา",
  "งาน Final ต้องพัฒนาจาก Mockup ไม่แบนหรือดูเหมือน Template เกินไป",
  "ภาพ Gen AI ต้องเก็บให้สมูธ ไม่ลอยหรือดูตัดแปะ",
  "ตรวจ Logo, Brand CI, ชื่อแบรนด์/สินค้า และข้อความใน Artwork ให้ถูกต้อง"
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
  score: number;
  summary: string;
  gd: QualityAreaResult;
  cs: QualityAreaResult;
  suggestion: QualitySuggestion;
}
