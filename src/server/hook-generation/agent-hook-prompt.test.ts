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
    const prompt = await readFile(
      join(process.cwd(), "agent_prompt", "agent_hook.md"),
      "utf8"
    );

    expect(prompt).toContain("ต้องใช้ Web Search ก่อนสร้างคำตอบทุกครั้ง");
    expect(prompt).toContain(
      "ทุก External Fact หรือ Claim ที่นำมาใช้ต้องมี Citation"
    );
    expect(prompt).toContain(
      "ห้ามใช้หน้าแรกของเว็บไซต์แทนหน้าหลักฐานเฉพาะเรื่อง"
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
      "ชุดคำตอบต้องมาจากอย่างน้อย 3 ทางเข้าที่เกี่ยวข้องจริง"
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
    expect(prompt).toContain(
      "Hook ที่เป็นคำถามต้องไม่เกินหนึ่งในสามของชุดโดยปัดขึ้น"
    );
    expect(prompt).toContain(
      "Opening mechanism หรือ causal logic เดิมใช้ได้ไม่เกิน 2 Directions"
    );
    expect(prompt).toContain("ทำ Headline-only test ก่อนส่งทุก Direction");
    expect(prompt).toContain(
      "ห้ามใช้ Subheadline เป็นคำเฉลย"
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
