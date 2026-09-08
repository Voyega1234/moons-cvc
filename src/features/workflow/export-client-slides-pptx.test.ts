import PptxGenJS from "pptxgenjs";
import { describe, expect, it, vi } from "vitest";
import type { CreativeDirection, UgcScriptDocument } from "../../domain/creative-run";
import {
  addUgcScriptRows,
  buildUgcScriptRows,
  resolvedUgcBrief
} from "./export-client-slides-pptx";

function ugcScript(overrides: Partial<UgcScriptDocument> = {}): UgcScriptDocument {
  return {
    directionId: "ugc-1",
    format: { duration: "30-35 วินาที", aspectRatio: "9:16", style: "Comedic myth-busting" },
    castDirection: "พนักงาน: energy สูง",
    beats: [],
    shotList: [],
    editingNotes: [],
    ...overrides
  };
}

describe("resolvedUgcBrief", () => {
  it("synthesizes the fixed 6-beat fallback with generic guidelines when no ugcBrief was generated", () => {
    const brief = resolvedUgcBrief(undefined, "Test Brand");

    expect(brief.product).toBe("Test Brand");
    expect(brief.scenes.map((scene) => scene.title)).toEqual([
      "Hook",
      "Relatable Problem",
      "Product Discovery",
      "Offer & Proof",
      "Conversion CTA",
      "End Card & Disclaimer"
    ]);
    expect(brief.doGuidelines?.length).toBeGreaterThan(0);
    expect(brief.dontGuidelines?.length).toBeGreaterThan(0);
  });

  it("backfills persona/dresscode/guideline fields a stored ugcBrief predates, without dropping its real scenes", () => {
    const direction: CreativeDirection = {
      id: "direction-1",
      hook: "Hook copy",
      concept: "Concept copy",
      why: "Why copy",
      visual: "Visual copy",
      cta: "CTA copy",
      caption: "Caption copy",
      selected: true,
      ugcBrief: {
        product: "Old Brand",
        duration: "0–30 วินาที",
        objective: "Old objective",
        moodAndTone: "Old mood",
        productionStyle: "Old production style",
        referenceDirection: "Old reference direction",
        scenes: [
          {
            title: "HOOK",
            duration: "0–5 วินาที",
            scriptLines: ["Old hook line"],
            visual: "Old hook visual",
            textOverlay: "Old hook overlay"
          }
        ]
      }
    };

    const brief = resolvedUgcBrief(direction, "Test Brand");

    expect(brief.product).toBe("Old Brand");
    expect(brief.scenes).toEqual(direction.ugcBrief!.scenes);
    expect(brief.persona).toBeTruthy();
    expect(brief.persona).not.toBe("—");
    expect(brief.dresscode).toBeTruthy();
    expect(brief.doGuidelines?.length).toBeGreaterThan(0);
    expect(brief.dontGuidelines?.length).toBeGreaterThan(0);
  });
});

describe("buildUgcScriptRows", () => {
  it("flattens a beat into a heading row plus one row per dialogue line", () => {
    const rows = buildUgcScriptRows(
      ugcScript({
        beats: [
          {
            id: "beat-1",
            role: "misconception",
            title: "Misconception #1",
            timecode: "0:05-0:09",
            lines: [
              { speaker: "customer", speakerLabel: "ลูกค้า", line: "ยื่นขอไม่ได้หรอกมั้ง!" },
              {
                speaker: "staff",
                speakerLabel: "พนักงาน",
                line: "ยื่นขอได้!",
                direction: "โผล่เข้ามาสวนทันที",
                sfx: "pop_sound"
              }
            ]
          }
        ]
      })
    );

    expect(rows[0]).toMatchObject({ text: "Misconception #1 (0:05-0:09)", bold: true });
    expect(rows[1]).toMatchObject({ text: "ลูกค้า: ยื่นขอไม่ได้หรอกมั้ง!" });
    expect(rows[2]).toMatchObject({ text: "พนักงาน: ยื่นขอได้!" });
    expect(rows[3]).toMatchObject({ text: "โผล่เข้ามาสวนทันที · SFX: pop_sound", italic: true });
  });

  it("omits the direction/SFX note row when a line has neither", () => {
    const rows = buildUgcScriptRows(
      ugcScript({
        beats: [
          {
            id: "beat-1",
            role: "cta",
            title: "CTA",
            timecode: "0:25-0:30",
            lines: [{ speaker: "narrator", line: "คลิกเลย!" }]
          }
        ]
      })
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]?.text).toBe("เสียงบรรยาย: คลิกเลย!");
  });

  it("appends Camera/Editing/Legal review lines only when the beat has them", () => {
    const rows = buildUgcScriptRows(
      ugcScript({
        beats: [
          {
            id: "beat-1",
            role: "misconception",
            title: "Misconception #1",
            timecode: "0:05-0:09",
            lines: [{ speaker: "staff", line: "ยื่นขอได้!" }],
            cameraNotes: "Medium shot ลูกค้าข้างรถ",
            editingNotes: "Cut ไว",
            legalFlag: "ต้องยืนยันเงื่อนไขอาชีพอิสระ"
          }
        ]
      })
    );
    expect(rows.map((row) => row.text)).toEqual([
      "Misconception #1 (0:05-0:09)",
      "พนักงาน: ยื่นขอได้!",
      "Camera: Medium shot ลูกค้าข้างรถ",
      "Editing: Cut ไว",
      "Legal review: ต้องยืนยันเงื่อนไขอาชีพอิสระ"
    ]);
  });

  it("appends shot list, editing notes, and a distinctly-flagged legal footer, all omitted when empty", () => {
    const withExtras = buildUgcScriptRows(
      ugcScript({
        shotList: ["Close-up กระทะ"],
        editingNotes: ["Cut เร็ว"],
        legalFooter: "กู้เท่าที่จำเป็นและชำระคืนไหว"
      })
    );
    expect(withExtras.map((row) => row.text)).toEqual([
      "Shot list",
      "• Close-up กระทะ",
      "Editing notes",
      "• Cut เร็ว",
      "กู้เท่าที่จำเป็นและชำระคืนไหว"
    ]);
    expect(withExtras.at(-1)?.isLegalFooter).toBe(true);

    expect(buildUgcScriptRows(ugcScript())).toEqual([]);
  });
});

describe("addUgcScriptRows pagination", () => {
  it("keeps a short script on the given slide without adding a continuation slide", () => {
    const pptx = new PptxGenJS();
    const firstSlide = pptx.addSlide();
    const addSlideSpy = vi.spyOn(pptx, "addSlide");

    addUgcScriptRows(
      pptx,
      firstSlide,
      buildUgcScriptRows(
        ugcScript({
          beats: [
            {
              id: "beat-1",
              role: "misconception",
              title: "Misconception #1",
              timecode: "0:05-0:09",
              lines: [
                { speaker: "customer", line: "ยื่นขอไม่ได้หรอกมั้ง!" },
                { speaker: "staff", line: "ยื่นขอได้!" }
              ]
            }
          ]
        })
      ),
      "อาชีพอิสระยื่นรีไฟแนนซ์ Isuzu ได้ไหม?"
    );

    expect(addSlideSpy).not.toHaveBeenCalled();
  });

  function longBeats(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      id: `beat-${index + 1}`,
      role: "misconception" as const,
      title: `Misconception #${index + 1}`,
      timecode: `0:${String(index * 5).padStart(2, "0")}-0:${String(index * 5 + 4).padStart(2, "0")}`,
      lines: [
        {
          speaker: "customer" as const,
          line: "ลูกค้าพูดยาวมากเพื่อให้เนื้อหารวมกันเกินพื้นที่คอลัมน์สคริปต์บนสไลด์แรกจนต้องล้นไปสไลด์ถัดไปแน่นอน"
        },
        {
          speaker: "staff" as const,
          line: "พนักงานตอบกลับด้วยประโยคที่ยาวไม่แพ้กันเพื่อบังคับให้ความสูงของแต่ละ beat เกินพอที่จะดันให้ล้นสไลด์"
        }
      ]
    }));
  }

  it("fills both halves of one continuation slide before starting a second", () => {
    const pptx = new PptxGenJS();
    const firstSlide = pptx.addSlide();
    const addSlideSpy = vi.spyOn(pptx, "addSlide");

    addUgcScriptRows(
      pptx,
      firstSlide,
      buildUgcScriptRows(ugcScript({ beats: longBeats(6) })),
      "อาชีพอิสระยื่นรีไฟแนนซ์ Isuzu ได้ไหม?"
    );

    expect(addSlideSpy).toHaveBeenCalledTimes(1);
  });

  it("starts a second continuation slide once both halves of the first are full", () => {
    const pptx = new PptxGenJS();
    const firstSlide = pptx.addSlide();
    const addSlideSpy = vi.spyOn(pptx, "addSlide");

    addUgcScriptRows(
      pptx,
      firstSlide,
      buildUgcScriptRows(ugcScript({ beats: longBeats(18) })),
      "อาชีพอิสระยื่นรีไฟแนนซ์ Isuzu ได้ไหม?"
    );

    expect(addSlideSpy).toHaveBeenCalledTimes(2);
  });
});
