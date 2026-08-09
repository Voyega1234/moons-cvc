import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("agent_hook creative quality contract", () => {
  it("separates art-direction constraints from creative execution", async () => {
    const prompt = await readFile(
      join(process.cwd(), "agent_prompt", "agent_hook.md"),
      "utf8"
    );

    expect(prompt).toContain(
      "ข้อกำหนดด้าน Art Direction เช่น พื้นหลังขาว"
    );
    expect(prompt).toContain(
      "ห้ามอนุมานต่อเองว่าทุก Direction ต้องใช้ Composition"
    );
    expect(prompt).toContain(
      "ความสดใหม่ของ Idea และสไตล์การเขียน Headline เป็นคนละเรื่องกัน"
    );
    expect(prompt).toContain(
      "เป็นเพียงคำขอให้สำรวจแนวคิดใหม่ ไม่ใช่หลักฐานของ Brand Voice"
    );
    expect(prompt).toContain(
      "ก่อนคิด Idea ให้อ่าน Brand Memory, Brand Context และ Past Content"
    );
    expect(prompt).toContain(
      "ห้ามทำ Headline ให้แปลก เล่นคำ ฝืนภาษา"
    );
    expect(prompt).toContain(
      "หากยังเป็นโครงงานเดียวกันที่เปลี่ยนเพียง SKU หรือ Copy"
    );
  });

  it("requires direct evidence for researched claims", async () => {
    const hookPrompt = await readFile(
      join(process.cwd(), "agent_prompt", "agent_hook.md"),
      "utf8"
    );
    const researchPrompt = await readFile(
      join(process.cwd(), "agent_prompt", "agent_hook_research.md"),
      "utf8"
    );

    expect(researchPrompt).toContain("ใช้ Web Search หลาย Query");
    expect(researchPrompt).toContain("ทุก Reference ต้องมาจากหน้าหลักฐานจริง");
    expect(researchPrompt).toContain("ต้องมี `sourceUrl`");
    expect(hookPrompt).toContain(
      "ทุก External Fact หรือ Claim ที่นำจาก Dossier มาใช้ต้องมี Citation"
    );
  });

  it("requires captions to preserve the recurring past-post style", async () => {
    const prompt = await readFile(
      join(process.cwd(), "agent_prompt", "agent_hook.md"),
      "utf8"
    );

    expect(prompt).toContain("## Caption");
    expect(prompt).toContain("เรียนรู้ Style Fingerprint จากหลายโพสต์ร่วมกัน");
    expect(prompt).toContain(
      "วิธีเปิดเรื่อง ความยาวย่อหน้า การเว้นบรรทัด รูปแบบ Bullet"
    );
    expect(prompt).toContain(
      "ห้ามเฉลี่ยเอกลักษณ์เหล่านี้จนกลายเป็นแคปชั่นโฆษณากลาง ๆ"
    );
    expect(prompt).toContain(
      "Paid Ad เรียนรู้จากแคปชั่นโฆษณา"
    );
  });

  it("requires commercially direct paid-social hooks", async () => {
    const prompt = await readFile(
      join(process.cwd(), "agent_prompt", "agent_hook.md"),
      "utf8"
    );

    expect(prompt).toContain(
      "ทำให้คนเข้าใจในหนึ่งจังหวะว่า “กำลังพูดเรื่องอะไร”"
    );
    expect(prompt).toContain(
      "ไม่มีรูปประโยค โทน หรือระดับการขายแบบ Default ที่ต้องใช้กับทุกงาน"
    );
    expect(prompt).toContain(
      "อนุญาตให้ Hook เปิดตรงด้วยชื่อหรือประเภทสินค้า"
    );
    expect(prompt).toContain(
      "Product Truth, Citation, ข้อกำหนดของ Brief และความถูกต้องของภาษาเป็น pass/fail gate"
    );
    expect(prompt).toContain(
      "ห้ามลดความชัดเพื่อพยายามทำให้ประโยคดูฉลาด"
    );
    expect(prompt).toContain("Headline ต้องยืนได้ด้วยตัวเองเสมอ");
    expect(prompt).toContain(
      "หาก Headline สมบูรณ์แล้วให้คืน `subheadline` เป็น string ว่าง"
    );
    expect(prompt).toContain("อย่ากำหนดจำนวนคำถาม");
    expect(prompt).toContain(
      "คำลงท้าย และจังหวะประโยคไม่ได้วนซ้ำเพียงเพราะเป็นทางเขียนที่ง่าย"
    );
    expect(prompt).toContain(
      "การซ้ำทำได้เมื่อเป็น Brand Device หรือ Campaign Device ที่ตั้งใจ"
    );
    expect(prompt).toContain(
      "หากตัดส่วนเปิดของแต่ละ Hook แล้วเหลือคำตอบหรือคำปิดแบบเดียวกัน"
    );
    expect(prompt).toContain("ทำ Headline-only test ก่อนส่งทุก Direction");
    expect(prompt).toContain(
      "ห้ามใช้ Subheadline เป็นคำเฉลย"
    );
    expect(prompt).toContain(
      "ไม่ได้แปลว่าต้องใส่ชื่อแบรนด์ ชื่อหมวดบริการ"
    );
    expect(prompt).toContain(
      "อย่าใช้คำเรียกหมวดสินค้า/บริการเป็นคำปิดสำเร็จรูป"
    );
    expect(prompt).toContain(
      "หากเปลี่ยนชื่อแบรนด์แล้วคู่แข่งใช้ได้ทันที ให้คะแนนไม่เกิน 79"
    );
    expect(prompt).toContain(
      "ไม่ใช่เพียงมี Purchase Intent สูง"
    );
    expect(prompt).toContain("### Hook taste corpus");
    expect(prompt).toContain("1. “One Price high floor.”");
    expect(prompt).toContain(
      "14. “50 ฟังก์ชันอัจฉริยะ เปลี่ยนบ้านธรรมดา สู่สวรรค์แห่งการพักผ่อน”"
    );
    expect(prompt).toContain(
      "27. “เพราะความสุขของสมาชิกสี่ขา ไม่ใช่เรื่องเล็ก...”"
    );
    expect(prompt).toContain(
      "ไม่ใช่จัดหมวด สร้างเมนู Pattern หรือเลือกประโยคหนึ่งมาเป็น Template"
    );
    expect(prompt).toContain(
      "กฎ Copy และ Product truth ของงานปัจจุบันมี Priority เหนือ Corpus นี้เสมอ"
    );
  });

  it("uses research to fill real creative and product gaps", async () => {
    const researchPrompt = await readFile(
      join(process.cwd(), "agent_prompt", "agent_hook_research.md"),
      "utf8"
    );
    const hookPrompt = await readFile(
      join(process.cwd(), "agent_prompt", "agent_hook.md"),
      "utf8"
    );

    expect(researchPrompt).toContain(
      "ระบุว่าข้อมูลส่วนใดขาดหรือควรมีหลักฐานเพิ่ม"
    );
    expect(researchPrompt).toContain("Consumer language");
    expect(hookPrompt).toContain(
      "อนุญาตให้ตีความและเชื่อมโยงอย่างสร้างสรรค์จากข้อเท็จจริงที่มี"
    );
  });

  it("keeps subheadline highlighting in its own prompt file", async () => {
    const prompt = await readFile(
      join(process.cwd(), "agent_prompt", "agent_hook_highlight.md"),
      "utf8"
    );

    expect(prompt).toContain("# SUBHEADLINE HIGHLIGHT SELECTOR");
    expect(prompt).toContain("exact continuous span");
    expect(prompt).toContain("ห้ามเขียนใหม่");
  });
});
