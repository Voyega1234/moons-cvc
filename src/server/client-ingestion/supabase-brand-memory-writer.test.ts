import { describe, expect, it } from "vitest";
import {
  buildBrandProductRows,
  buildBrandLearningRows,
  buildBrandLibraryRows
} from "./supabase-brand-memory-writer";
import type { BrandSignalAnalysis } from "./client-ingestion-harness";

const analysis: BrandSignalAnalysis = {
  brandKitEntries: [
    {
      title: "Visual mood",
      description: "Fresh, soft, feminine"
    }
  ],
  learning: [
    {
      polarity: "working",
      note: "Use soft natural light with product close-ups."
    },
    {
      polarity: "avoid",
      note: "Avoid harsh contrast and overly busy layouts."
    }
  ],
  products: [
    {
      name: "บริการออกแบบครีเอทีฟ",
      description: "บริการผลิตครีเอทีฟสำหรับโฆษณาดิจิทัล",
      offer: "ออกแบบภาพและข้อความให้เหมาะกับแพลตฟอร์ม",
      keyBenefit: "ช่วยให้แบรนด์มีครีเอทีฟพร้อมใช้งาน",
      audience: "ทีมการตลาด",
      claimNotes: "ยังไม่มีหลักฐานด้านผลลัพธ์"
    }
  ],
  visualGuidance: {
    mood: ["fresh", "soft"],
    colorPalette: ["cream", "green"],
    layoutPatterns: ["centered product"],
    textOverlay: ["minimal"],
    typographyFeel: ["clean sans"],
    productPersonEnvironment: ["product with natural props"],
    dos: ["keep the frame calm"],
    donts: ["avoid harsh contrast"],
    sourceAssetPaths: ["client-1/job-1/facebook_post/post-1-0.jpg"]
  },
  needsReview: false
};

describe("SupabaseBrandMemoryWriter row builders", () => {
  it("builds Brand kit rows with visual guidance and source reference", () => {
    const rows = buildBrandLibraryRows("client-1", "job-1", analysis);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      client_id: "client-1",
      section: "brand",
      title: "Visual mood",
      sort_order: 0
    });
    expect(rows[0]?.description).toContain(
      "Source: brand_analysis_jobs/job-1 · 1 images"
    );
    expect(rows[1]).toMatchObject({
      client_id: "client-1",
      section: "brand",
      title: "Visual guidance",
      sort_order: 1
    });
    expect(rows[1]?.description).toContain("Mood: fresh, soft");
    expect(rows[1]?.description).not.toContain("Source assets:");
  });

  it("builds Brand learning rows with source reference", () => {
    const rows = buildBrandLearningRows("client-1", "job-1", analysis);

    expect(rows).toEqual([
      {
        client_id: "client-1",
        polarity: "working",
        note: "Use soft natural light with product close-ups.\nSource: brand_analysis_jobs/job-1 · 1 images",
        source_run_id: null
      },
      {
        client_id: "client-1",
        polarity: "avoid",
        note: "Avoid harsh contrast and overly busy layouts.\nSource: brand_analysis_jobs/job-1 · 1 images",
        source_run_id: null
      }
    ]);
  });

  it("builds editable product defaults and skips existing names", () => {
    expect(
      buildBrandProductRows("client-1", analysis, [
        "บริการออกแบบครีเอทีฟ"
      ])
    ).toEqual([]);

    expect(buildBrandProductRows("client-1", analysis, [])).toEqual([
      {
        client_id: "client-1",
        name: "บริการออกแบบครีเอทีฟ",
        description: "บริการผลิตครีเอทีฟสำหรับโฆษณาดิจิทัล",
        offer: "ออกแบบภาพและข้อความให้เหมาะกับแพลตฟอร์ม",
        key_benefit: "ช่วยให้แบรนด์มีครีเอทีฟพร้อมใช้งาน",
        audience: "ทีมการตลาด",
        claim_notes: "ยังไม่มีหลักฐานด้านผลลัพธ์",
        sort_order: 0
      }
    ]);
  });
});
