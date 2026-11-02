import { describe, expect, it } from "vitest";
import { CREATIVE_APPROVAL_DOCUMENT_TITLE } from "../../domain/creative-approval";
import { buildCreativeApprovalVisualContext, buildCreativeApprovalVisualInstruction } from "./creative-approval-visual-context";
import { buildStandardImagePrompt } from "./image-prompt-agent";
import { buildCreativeStrategyEvidence } from "./creative-strategy-enrichment-agent";
import { composeImagePrompt } from "./prompt-runtime";

const visualStyle = { colors: ["พื้นน้ำเงินเข้ม ตัวอักษรขาว สีเหลืองใช้เน้น"], typography: ["ไทยหนาและใหญ่"], layout: ["ภาพสินค้าขวา ข้อความซ้าย"], imagery: ["ภาพตัดต่อสินค้ากับฉากหน้างาน"], moodTone: ["มั่นใจ ตรงไปตรงมา"], brandElements: ["โลโก้มุมบนขวา"] };
const document = { title: CREATIVE_APPROVAL_DOCUMENT_TITLE, description: JSON.stringify({ sourceUrl: "https://docs.google.com/spreadsheets/d/source/edit", examples: [{ rowNumber: 12, status: "Published", version: 1, headline: "OLD HEADLINE", caption: "OLD OFFER 1999", visualStyle, uncertainties: ["ชื่อฟอนต์ไม่ทราบ"] }] }) };
const input = {
  brand: { name: "Brand", category: "Tools", personality: [], colors: ["#123456"] },
  brandMemory: { working: [], avoid: [] },
  brandLibrary: { brand: [{ title: "Brand CI Guideline", description: "Official CI" }], docs: [document, { title: "Brand guideline", description: "Current editable official CI" }], products: [], refs: [] },
  service: "single-static", brief: "New campaign", textInputs: [], referenceImages: [], referenceImageLabels: [], canvasRatio: "1:1",
  hook: { hook: "New headline", concept: "New idea", why: "New objective", visual: "", cta: "Contact", caption: "New caption" }
};

describe("Creative Approval visual identity context", () => {
  it("carries visual evidence with provenance, official colors and the current editable CI", () => {
    const context = buildCreativeApprovalVisualContext(input)!;
    expect(context.officialColors).toEqual(["#123456"]);
    expect(context.officialGuidelines).toEqual([{ title: "Brand guideline", description: "Current editable official CI" }]);
    expect(context.observedStyle.samples[0]).toMatchObject({ rowNumber: 12, revision: 1, visualStyle, uncertainties: ["ชื่อฟอนต์ไม่ทราบ"] });
    expect(context.authority).toContain("never override official CI");
    expect(JSON.stringify(context)).not.toContain("OLD HEADLINE");
    expect(JSON.stringify(context)).not.toContain("OLD OFFER");
  });

  it("adds CI observations to Standard art direction, rather than only the final renderer", async () => {
    const prompt = await buildStandardImagePrompt(input, async () => "Art direction");
    expect(prompt).toContain("มั่นใจ ตรงไปตรงมา");
    expect(prompt).toContain("Current editable official CI");
  });

  it("never promotes the style document into commercial proof or offer evidence", () => {
    const evidence = buildCreativeStrategyEvidence(input);
    expect(JSON.stringify(evidence)).not.toContain("OLD OFFER");
    expect(JSON.stringify(evidence)).not.toContain(CREATIVE_APPROVAL_DOCUMENT_TITLE);
  });

  it("preserves the complete CI instruction when a large final prompt is shortened", () => {
    const instruction = buildCreativeApprovalVisualInstruction(input);
    const prompt = composeImagePrompt(["x".repeat(40_000)], instruction);
    expect(prompt.endsWith(instruction)).toBe(true);
    expect(prompt.length).toBeLessThanOrEqual(30_000);
  });

  it("leaves brands without valid visual observations unchanged", () => {
    expect(buildCreativeApprovalVisualContext({ ...input, brandLibrary: { ...input.brandLibrary, docs: [] } })).toBeNull();
    expect(buildCreativeApprovalVisualInstruction({ ...input, brandLibrary: { ...input.brandLibrary, docs: [{ ...document, description: "invalid JSON" }] } })).toBe("");
  });

  it("keeps the Ads Post tab and row as the visual source instead of attributing them to Creative Approval", () => {
    const sourceUrl = "https://docs.google.com/spreadsheets/d/source/edit#gid=2";
    const description = JSON.stringify({ sourceUrl: "https://docs.google.com/spreadsheets/d/source/edit#gid=1", examples: [{ sheetTitle: "🔵 Ads Post", sourceUrl, rowNumber: 17, status: "Active", version: 0, visualStyle, caption: "OLD OFFER" }] });
    const context = buildCreativeApprovalVisualContext({ ...input, brandLibrary: { ...input.brandLibrary, docs: [{ ...document, description }] } });
    expect(context?.observedStyle.samples[0]).toMatchObject({ sheetTitle: "🔵 Ads Post", sourceUrl, rowNumber: 17 });
    expect(JSON.stringify(context)).not.toContain("OLD OFFER");
  });
});
