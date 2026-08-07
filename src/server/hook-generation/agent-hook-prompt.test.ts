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
