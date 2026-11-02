import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { analyzeCreativeApproval, parseImageCopies } from "./creative-approval-analyzer";
import type { CreativeApprovalContext } from "../../domain/creative-approval";

const row = { rowNumber: 12, label: "AW1", status: "Published", version: 1, imageUrl: "https://drive.google.com/file/d/artwork/view", caption: "Caption context", feedback: ["Use the corrected product size"] };
const copy = { sourceIndex: 0, headline: "ประหยัดค่าแรง", supportingCopy: ["มี 17 สี"], cta: "ทักเลย", styleObservations: ["เปิดด้วยประโยชน์ด้านต้นทุน"], uncertainties: [], visualStyle: { colors: ["พื้นสีน้ำเงินเข้ม ตัวอักษรขาวและเหลือง"], typography: ["ตัวอักษรไทยหนา หัวข้อใหญ่"], layout: ["สินค้าขวา ข้อความซ้าย"], imagery: ["ภาพตัดต่อสินค้ากับฉากหน้างาน"], moodTone: ["ตรงไปตรงมาและแข็งแรง"], brandElements: ["โลโก้มุมขวาบน"] } };
const options = { googleAccessToken: "private-google-token", apiKey: "model-key", model: "test/vision", loadPrompt: async () => "Read image copy" };

async function mockProvider() {
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).jpeg().toBuffer();
  let version = "v1";
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("alt=media")) return new Response(new Uint8Array(image), { headers: { "Content-Type": "image/jpeg" } });
    if (url.startsWith("https://www.googleapis.com/drive/")) return Response.json({ id: "artwork", mimeType: "image/jpeg", modifiedTime: "2026-11-01", version });
    if (url === "https://openrouter.ai/api/v1/chat/completions") return Response.json({ choices: [{ message: { content: JSON.stringify({ examples: [copy] }) }, finish_reason: "stop" }] });
    throw new Error(`Unexpected fetch: ${url}`);
  });
  return { fetchImpl, changeVersion: () => { version = "v2"; } };
}

describe("Creative Approval image analysis", () => {
  it("reads actual image bytes at high detail and binds model copy to the trusted row", async () => {
    const { fetchImpl } = await mockProvider();
    const result = await analyzeCreativeApproval({ ...options, rows: [row], fetchImpl });
    expect(result).toEqual([expect.objectContaining({ ...row, headline: copy.headline, supportingCopy: copy.supportingCopy, fingerprint: expect.any(String) })]);
    expect(result[0]?.visualStyle).toEqual(copy.visualStyle);
    const call = fetchImpl.mock.calls.find(args => String(args[0]).includes("openrouter"));
    const body = JSON.parse(String((call as unknown as [unknown, RequestInit])[1].body));
    expect(body.messages[0].content[2].image_url).toMatchObject({ detail: "high", url: expect.stringMatching(/^data:image\/jpeg;base64,/) });
    expect(JSON.stringify(body)).not.toContain(options.googleAccessToken);
  });

  it("reuses unchanged extraction and re-reads a changed Drive file or feedback", async () => {
    const { fetchImpl, changeVersion } = await mockProvider();
    const examples = await analyzeCreativeApproval({ ...options, rows: [row], fetchImpl });
    const cached: CreativeApprovalContext = { version: 1, sourceUrl: "sheet", sheetTitle: "Creative Approval", examples };
    fetchImpl.mockClear();
    await expect(analyzeCreativeApproval({ ...options, rows: [row], cached, fetchImpl })).resolves.toEqual(examples);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    changeVersion();
    const changed = await analyzeCreativeApproval({ ...options, rows: [row], cached, fetchImpl });
    expect(changed[0]?.fingerprint).not.toBe(examples[0]?.fingerprint);
    expect(fetchImpl.mock.calls.filter(args => String(args[0]).includes("openrouter"))).toHaveLength(1);
    fetchImpl.mockClear();
    await analyzeCreativeApproval({ ...options, rows: [{ ...row, feedback: ["New feedback"] }], cached, fetchImpl });
    expect(fetchImpl.mock.calls.some(args => String(args[0]).includes("openrouter"))).toBe(true);
  });

  it("rejects duplicate/missing/out-of-range image mappings and malformed extracted fields", () => {
    expect(() => parseImageCopies({ examples: [copy, copy] }, 2)).toThrow("invalid image index");
    expect(() => parseImageCopies({ examples: [] }, 1)).toThrow("wrong number");
    expect(() => parseImageCopies({ examples: [{ ...copy, sourceIndex: 5 }] }, 1)).toThrow("invalid image index");
    expect(() => parseImageCopies({ examples: [{ ...copy, uncertainties: "none" }] }, 1)).toThrow("Invalid extracted");
    expect(() => parseImageCopies({ examples: [{ ...copy, visualStyle: null }] }, 1)).toThrow("Invalid extracted visual style");
  });

  it("does not request a model when no images qualify", async () => {
    const fetchImpl = vi.fn();
    await expect(analyzeCreativeApproval({ ...options, rows: [], fetchImpl })).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects oversized images before downloading or calling a model", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ id: "artwork", mimeType: "image/jpeg", size: "20000000" }));
    await expect(analyzeCreativeApproval({ ...options, rows: [row], fetchImpl })).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
