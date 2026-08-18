import { describe, expect, it } from "vitest";
import { normalizeGeneratedCaptionFormatting } from "./caption-formatting";

describe("normalizeGeneratedCaptionFormatting", () => {
  it("turns model dot separators and inline blocks into ready-to-paste spacing", () => {
    const caption =
      "เมื่อพนักงานเก่งเรื่องงานไม่ได้แปลว่าจะบริหารคนได้ทันที . เตรียมความพร้อมให้ผู้นำมือใหม่ด้วยหลักสูตร People Manager in Action . สิ่งที่จะได้รับจากหลักสูตร ✅ ฝึกวางแผนจ่ายงาน ✅ วิธีสร้างความไว้วางใจ . ติดต่อขอรายละเอียดหลักสูตร Email : connect@baseplayhouse.co Inbox : https://m.me/BASEForCorporate Phone : 094-191-4626 . #BASEPlayhouse #PeopleManagement";

    expect(normalizeGeneratedCaptionFormatting(caption)).toBe(
      [
        "เมื่อพนักงานเก่งเรื่องงานไม่ได้แปลว่าจะบริหารคนได้ทันที",
        "",
        "เตรียมความพร้อมให้ผู้นำมือใหม่ด้วยหลักสูตร People Manager in Action",
        "",
        "สิ่งที่จะได้รับจากหลักสูตร",
        "✅ ฝึกวางแผนจ่ายงาน",
        "✅ วิธีสร้างความไว้วางใจ",
        "",
        "ติดต่อขอรายละเอียดหลักสูตร",
        "Email : connect@baseplayhouse.co",
        "Inbox : https://m.me/BASEForCorporate",
        "Phone : 094-191-4626",
        "",
        "#BASEPlayhouse #PeopleManagement"
      ].join("\n")
    );
  });

  it("preserves ordinary punctuation, URLs, and intentional line breaks", () => {
    const caption =
      "อ่านรายละเอียดได้ที่ https://baseplayhouse.co/programs.\n\nสมัครได้ตั้งแต่วันนี้";

    expect(normalizeGeneratedCaptionFormatting(caption)).toBe(caption);
  });
});
