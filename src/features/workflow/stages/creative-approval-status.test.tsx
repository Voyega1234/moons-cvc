import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Brand } from "../../../domain/brand";
import { CREATIVE_APPROVAL_DOCUMENT_TITLE } from "../../../domain/creative-approval";
import { CreativeApprovalStatus } from "./creative-approval-status";

afterEach(cleanup);
const sourceUrl = "https://docs.google.com/spreadsheets/d/portal/edit#gid=1";
const brand: Brand = { id: "brand", name: "Brand", category: "", initials: "B", mappingClientPortalUrl: sourceUrl, library: { brand: [], products: [], docs: [], refs: [] }, memory: { working: [], avoid: [] } };
function withExamples(examples: unknown[], source = sourceUrl): Brand {
  return { ...brand, library: { ...brand.library, docs: [{ id: "style", title: CREATIVE_APPROVAL_DOCUMENT_TITLE, description: JSON.stringify({ version: 1, sourceUrl: source, examples }) }] } };
}
const example = { headline: "Test", visualStyle: { colors: [], typography: [], layout: [], imagery: [], moodTone: ["confident"], brandElements: [] } };

describe("Creative Approval user status", () => {
  it("explains when the first import will happen", () => {
    render(<CreativeApprovalStatus brand={brand} />);
    expect(screen.getByRole("status").textContent).toContain("อัตโนมัติก่อนสร้าง Hook ครั้งแรก");
  });
  it("shows an explicit warning before building images from old Hooks", () => {
    const view = render(<CreativeApprovalStatus brand={brand} stage="artwork" />);
    expect(screen.getByRole("status").textContent).toContain("สร้าง Hook ใหม่");
    view.rerender(<CreativeApprovalStatus brand={brand} stage="artwork" disabled />);
    expect(screen.getByRole("status").textContent).toContain("ปิด Brand CI");
  });
  it("reports actual saved sample counts and separates copy from visual coverage", () => {
    render(<CreativeApprovalStatus brand={withExamples([example, { headline: "Copy-only example" }])} />);
    expect(screen.getByRole("status").textContent).toContain("Creative Approval 2 ภาพ");
    expect(screen.getByRole("status").textContent).toContain("CI / mood & tone 1 ภาพ");
  });
  it("distinguishes checking, failed and empty results", () => {
    const view = render(<CreativeApprovalStatus brand={brand} checking />);
    expect(screen.getByRole("status").textContent).toContain("กำลังตรวจ Creative Approval");
    view.rerender(<CreativeApprovalStatus brand={brand} failed />);
    expect(screen.getByRole("status").textContent).toContain("ใช้ข้อมูลแบรนด์ที่มีอยู่และสร้าง Hook ต่อ");
    expect(screen.getByRole("status").textContent).not.toContain("ยังสร้าง Hook ต่อไม่ได้");
    expect(screen.getByRole("status").classList.contains("error")).toBe(false);
    view.rerender(<CreativeApprovalStatus brand={withExamples([])} />);
    expect(screen.getByRole("status").textContent).toContain("ผลตรวจเดิมยังไม่มีภาพที่อ่านได้");
  });
  it("does not claim that stale or invalid-source examples are ready", () => {
    const view = render(<CreativeApprovalStatus brand={withExamples([example], "https://docs.google.com/spreadsheets/d/other/edit")} />);
    expect(screen.getByRole("status").textContent).toContain("ยังไม่ได้อ่าน");
    view.rerender(<CreativeApprovalStatus brand={{ ...brand, mappingClientPortalUrl: undefined }} />);
    expect(screen.getByRole("status").textContent).toContain("ยังไม่มีลิงก์ Client Portal");
    view.rerender(<CreativeApprovalStatus brand={brand} autoSync={false} />);
    expect(screen.getByRole("status").textContent).toContain("ยังไม่รองรับการอ่านอัตโนมัติ");
  });
  it("shows both source counts and distinguishes missing tabs from no readable artwork", () => {
    const withSources = (examples: unknown[], sources: unknown[]): Brand => ({ ...brand, library: { ...brand.library, docs: [{ id: "style", title: CREATIVE_APPROVAL_DOCUMENT_TITLE, description: JSON.stringify({ version: 1, sourceUrl, examples, sources }) }] } });
    const sources = [{ sheetTitle: "🟢 Creative Approval", sourceUrl, imageCount: 1, candidateCount: 1 }, { sheetTitle: "🔵 Ads Post", sourceUrl, imageCount: 1, candidateCount: 1 }];
    const view = render(<CreativeApprovalStatus brand={withSources([example, example], sources)} />);
    expect(screen.getByRole("status").textContent).toContain("🟢 Creative Approval 1 ภาพ · 🔵 Ads Post 1 ภาพ · รวม 2 ภาพ");
    view.rerender(<CreativeApprovalStatus brand={withSources([], [])} />);
    expect(screen.getByRole("status").textContent).toContain("ไม่พบแท็บ Creative Approval หรือ Ads Post");
    view.rerender(<CreativeApprovalStatus brand={withSources([], [{ ...sources[0], imageCount: 0 }])} />);
    expect(screen.getByRole("status").textContent).toContain("ยังไม่มีภาพที่อ่านได้จากลิงก์ Drive");
  });
});
