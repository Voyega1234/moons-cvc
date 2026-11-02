import type { Brand } from "../../../domain/brand";
import { creativeApprovalContextSummary } from "../../../domain/creative-approval";

export function CreativeApprovalStatus({ brand, stage = "hook", checking = false, failed = false, disabled = false, autoSync = true }: {
  brand: Brand | null | undefined;
  stage?: "hook" | "artwork";
  checking?: boolean;
  failed?: boolean;
  disabled?: boolean;
  autoSync?: boolean;
}) {
  if (!brand) return null;
  const summary = creativeApprovalContextSummary(brand);
  let message: string;
  if (disabled) message = "ไม่ได้ใช้ context จาก Creative Approval / Ads Post ในครั้งนี้ เพราะปิด Brand CI";
  else if (checking) message = "กำลังตรวจ Creative Approval / Ads Post และอัปเดต copy / CI / mood & tone จากงานเดิม…";
  else if (failed) message = "อัปเดต Creative Approval / Ads Post ไม่ได้ในรอบนี้ — ใช้ข้อมูลแบรนด์ที่มีอยู่และสร้าง Hook ต่อ";
  else if (summary.status === "missing-source") message = "ยังไม่มีลิงก์ Client Portal สำหรับอ่าน Creative Approval / Ads Post — ใช้ข้อมูลแบรนด์ที่มีอยู่";
  else if (summary.status === "pending") message = stage === "artwork"
    ? "ยังไม่มี context จาก Creative Approval / Ads Post — สร้าง Hook ใหม่เพื่ออ่าน copy และ CI จากงานเดิมก่อนนำมาใช้สร้างภาพ"
    : autoSync ? "ยังไม่ได้อ่าน Creative Approval / Ads Post — ระบบจะอ่าน copy และ CI จากงานเดิมอัตโนมัติก่อนสร้าง Hook ครั้งแรก"
    : "ยังไม่ได้อ่าน Creative Approval / Ads Post — เส้นทาง Hook ที่เลือกยังไม่รองรับการอ่านอัตโนมัติ";
  else if (summary.status === "empty") message = summary.sources?.length === 0
    ? "ไม่พบแท็บ Creative Approval หรือ Ads Post ใน Client Portal นี้ — ใช้ข้อมูลแบรนด์ที่มีอยู่"
    : summary.sources
      ? "ตรวจ Creative Approval / Ads Post แล้ว ยังไม่มีภาพที่อ่านได้จากลิงก์ Drive ของงานที่ผ่านเกณฑ์ — ใช้ข้อมูลแบรนด์ที่มีอยู่"
      : "ผลตรวจเดิมยังไม่มีภาพที่อ่านได้ — ระบบจะตรวจ Creative Approval / Ads Post ใหม่ก่อนสร้าง Hook";
  else message = `มี context ${summary.sources?.length ? `จาก ${summary.sources.map(source => `${source.sheetTitle} ${source.imageCount} ภาพ`).join(" · ")} · รวม ${summary.count} ภาพ` : `จาก Creative Approval ${summary.count} ภาพ (ยังไม่ได้ตรวจ Ads Post)`} · มีข้อมูล CI / mood & tone ${summary.visualCount} ภาพ${stage === "hook" && autoSync ? " · ตรวจอัปเดตก่อนสร้าง Hook" : ""}`;
  return <p className="repository-message" role="status" aria-live="polite">{message}</p>;
}
