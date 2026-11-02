import { describe, expect, it, vi } from "vitest";
import { driveArtworkUrl, driveImageUrl, readCreativeApprovalSheet, selectAdsPostRows, selectCreativeApprovalRows } from "./creative-approval-sheet";

const cell = (formattedValue: string) => ({ formattedValue });
const image = (id: string) => `https://drive.google.com/file/d/${id}/view`;
const headers = [
  ["No.", "Type", "STATUS", "", "", "AW Done", "", "", "", "", "Revise #1", "", "", "", "", "", "Revise #2"].map(cell),
  ["", "", "", "Post Link", "Product ID", "IMAGE LINK", "IMAGE", "CAPTION", "PHOTO - COMMENT", "CAPTION - COMMENT", "IMAGE LINK", "IMAGE", "CAPTION", "PHOTO - COMMENT", "", "CAPTION - COMMENT", "IMAGE LINK", "IMAGE", "CAPTION", "PHOTO - COMMENT", "CAPTION - COMMENT"].map(cell)
];
const adsHeaders = [
  ["Status", "Objective", "Post Type", "Remark", "Existing Post", "Dark Post", "Artwork Preview", "Headline (<40 Characters)", "Caption (Text)"].map(cell),
  ["", "", "", "", "Post URL", "Artwork URL", "", "", "", "AW Link"].map(cell)
];

function row(overrides: Record<number, string> = {}) {
  const values: string[] = Array(21).fill("");
  Object.assign(values, { 0: "AW1", 1: "Single", 2: "Ads Active", 5: image("original"), 7: "Original caption" }, overrides);
  return values.map(cell);
}

describe("Creative Approval row selection", () => {
  it("uses the latest populated revision and keeps prior feedback and matching caption", () => {
    const result = selectCreativeApprovalRows([...headers, row({ 8: "ระบุขนาดให้ชัด", 10: image("revision1"), 12: "Revised caption", 13: "ราคาไม่ตรงสินค้า", 16: image("revision2") })]);
    expect(result).toEqual([{ rowNumber: 3, label: "AW1", status: "Ads Active", version: 2, imageUrl: image("revision2"), caption: "Revised caption", feedback: ["ระบุขนาดให้ชัด", "ราคาไม่ตรงสินค้า"] }]);
  });

  it("excludes drafts, rejected work, videos, and unresolved feedback on the selected revision", () => {
    expect(selectCreativeApprovalRows([...headers,
      row({ 2: "Draft" }), row({ 2: "Rejected" }), row({ 1: "Video" }),
      row({ 8: "แก้ copy ก่อน" }), row({ 10: image("revision"), 15: "ยังไม่ผ่าน" }),
      row({ 2: "Published", 8: "cf" })
    ])).toEqual([expect.objectContaining({ status: "Published" })]);
  });

  it("never falls back to an earlier revision when the latest is an embedded image or unsupported link", () => {
    expect(selectCreativeApprovalRows([...headers, row({ 10: "new-image.jpg" }), row({ 10: "https://example.com/new.jpg" })])).toEqual([]);
  });

  it("prefers recent distinct images and bounds the examples to six", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row({ 0: `AW${i}`, 5: image(`file${i}`) }));
    const result = selectCreativeApprovalRows([...headers, ...rows, row({ 0: "Duplicate", 5: image("file9") })]);
    expect(result).toHaveLength(6);
    expect(result[0]?.label).toBe("Duplicate");
    expect(result.map(item => item.imageUrl)).toEqual([9, 8, 7, 6, 5, 4].map(i => image(`file${i}`)));
  });

  it("extracts Drive links from formulas and rich text but rejects arbitrary hosts", () => {
    expect(driveImageUrl({ userEnteredValue: { formulaValue: '=IMAGE("https://drive.google.com/uc?id=linked-file")' } })).toBe(image("linked-file"));
    expect(driveImageUrl({ textFormatRuns: [{ format: { link: { uri: image("rich-text") } } }] })).toBe(image("rich-text"));
    expect(driveImageUrl(cell("https://drive.google.com.attacker.test/file/d/secret/view"))).toBe("");
    expect(driveImageUrl(cell("http://drive.google.com/file/d/file/view"))).toBe("");
    expect(driveArtworkUrl(cell("https://drive.google.com/drive/u/0/folders/final?usp=sharing"))).toBe("https://drive.google.com/drive/folders/final");
    expect(driveImageUrl(cell("https://drive.google.com/drive/folders/final"))).toBe("");
    expect(driveArtworkUrl(cell("https://attacker.test/drive/folders/final"))).toBe("");
  });

  it("accepts the final revision folder without falling back to the original file", () => {
    expect(selectCreativeApprovalRows([...headers, row({ 16: "https://drive.google.com/drive/folders/final" })])[0]).toMatchObject({ version: 2, imageUrl: "https://drive.google.com/drive/folders/final" });
  });
});

describe("Ads Post row selection", () => {
  it("uses named artwork columns for Active and End rows, retaining matching captions", () => {
    const rows = [
      ["End", "", "Dark Post", "", "", image("ended"), "", "AD HEADLINE", "Ended caption"],
      ["Active", "", "Dark Post", "", "", image("active"), "", "", "Active caption", "SEP'26"],
      ["New", "", "", "", "", image("draft")],
      ["Active", "", "Video", "", "", image("video")],
      ["Active", "", "Existing Post", "", "https://www.facebook.com/example/posts/123"],
      ["Paused", "", "", "", "", image("paused")]
    ].map(row => row.map(cell));
    expect(selectAdsPostRows([...adsHeaders, ...rows])).toEqual([
      expect.objectContaining({ rowNumber: 4, status: "Active", imageUrl: image("active"), caption: "Active caption" }),
      expect.objectContaining({ rowNumber: 3, status: "End", imageUrl: image("ended"), caption: "Ended caption" })
    ]);
  });
});

describe("Creative Approval Google reader", () => {
  it("reads only the metadata-derived tab and bounded range, regardless of the URL gid", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json({ sheets: [{ properties: { title: "Creative Approval", sheetId: 42, gridProperties: { rowCount: 366, columnCount: 21 } } }] }))
      .mockResolvedValueOnce(Response.json({ sheets: [{ data: [{ rowData: [...headers, row()].map(values => ({ values })) }] }] }));
    const result = await readCreativeApprovalSheet({ sheetUrl: "https://docs.google.com/spreadsheets/d/portal/edit#gid=99", accessToken: "google-token", fetchImpl });
    expect(result.sourceUrl).toBe("https://docs.google.com/spreadsheets/d/portal/edit#gid=42");
    const readUrl = new URL(String(fetchImpl.mock.calls[1]?.[0]));
    expect(readUrl.searchParams.get("ranges")).toBe("'Creative Approval'!A1:U366");
    expect(result.rows).toHaveLength(1);
    expect(fetchImpl.mock.calls[1]?.[1].headers.Authorization).toBe("Bearer google-token");
  });

  it("keeps missing tabs optional but surfaces Google access failures", async () => {
    const input = { sheetUrl: "https://docs.google.com/spreadsheets/d/portal/edit", accessToken: "google-token" };
    await expect(readCreativeApprovalSheet({ ...input, fetchImpl: vi.fn().mockResolvedValue(Response.json({ sheets: [] })) })).resolves.toMatchObject({ rows: [] });
    await expect(readCreativeApprovalSheet({ ...input, fetchImpl: vi.fn().mockResolvedValue(new Response("", { status: 403 })) })).rejects.toThrow("Reconnect Google");
  });

  it("reads recent rows rather than old rows in large portals and preserves their actual row numbers", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json({ sheets: [{ properties: { title: "Creative Approval", sheetId: 42, gridProperties: { rowCount: 1500, columnCount: 21 } } }] }))
      .mockResolvedValueOnce(Response.json({ values: Array(1500).fill(["AW"]) }))
      .mockResolvedValueOnce(Response.json({ sheets: [{ data: [
        { rowData: headers.map(values => ({ values })) },
        { startRow: 1498, rowData: [{ values: row() }] }
      ] }] }));
    const result = await readCreativeApprovalSheet({ sheetUrl: "https://docs.google.com/spreadsheets/d/portal/edit", accessToken: "google-token", fetchImpl });
    const readUrl = new URL(String(fetchImpl.mock.calls[2]?.[0]));
    expect(readUrl.searchParams.getAll("ranges")).toEqual(["'Creative Approval'!A1:U20", "'Creative Approval'!A521:U1500"]);
    expect(result.rows[0]?.rowNumber).toBe(1499);
  });

  it("ignores empty template rows when locating the most recent artwork", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json({ sheets: [{ properties: { title: "Creative Approval", sheetId: 42, gridProperties: { rowCount: 5000, columnCount: 21 } } }] }))
      .mockResolvedValueOnce(Response.json({ values: Array(100).fill(["AW"]) }))
      .mockResolvedValueOnce(Response.json({ sheets: [{ data: [{ rowData: [...headers, row()].map(values => ({ values })) }] }] }));
    const result = await readCreativeApprovalSheet({ sheetUrl: "https://docs.google.com/spreadsheets/d/portal/edit", accessToken: "google-token", fetchImpl });
    expect(new URL(String(fetchImpl.mock.calls[2]?.[0])).searchParams.getAll("ranges")).toEqual(["'Creative Approval'!A1:U100"]);
    expect(result.rows).toHaveLength(1);
  });

  it("reads emoji-prefixed tabs, resolves final folders once, and balances distinct images across sources", async () => {
    const folder = "https://drive.google.com/drive/folders/final";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "www.googleapis.com") return Response.json({ files: [{ id: "shared", name: "Final.jpg" }, { id: "variant", name: "Variant.png" }] });
      if (!url.searchParams.has("ranges")) return Response.json({ sheets: [
        { properties: { title: "🔵 Ads Post", sheetId: 2 } },
        { properties: { title: "🟢 Creative Approval", sheetId: 1 } },
        { properties: { title: "Ads Post (Tiktok)", sheetId: 3 } }
      ] });
      const values = url.searchParams.get("ranges")!.includes("Creative Approval")
        ? [...headers, ...Array.from({ length: 6 }, (_, i) => row({ 5: image(`creative${i}`) })), row({ 16: folder })]
        : [...adsHeaders, ...Array.from({ length: 6 }, (_, i) => ["Active", "", "Dark Post", "", "", image(`ad${i}`)].map(cell)), ["Active", "", "Dark Post", "", "", folder].map(cell)];
      return Response.json({ sheets: [{ data: [{ rowData: values.map(values => ({ values })) }] }] });
    });
    const result = await readCreativeApprovalSheet({ sheetUrl: "https://docs.google.com/spreadsheets/d/portal/edit", accessToken: "token", fetchImpl });
    expect(result.rows).toHaveLength(6);
    expect(new Set(result.rows.map(row => row.imageUrl)).size).toBe(6);
    expect(result.rows.filter(row => row.sheetTitle === "🔵 Ads Post").length).toBeGreaterThan(0);
    expect(result.rows[0]).toMatchObject({ version: 2, imageUrl: image("shared"), artworkUrl: folder, fileName: "Final.jpg", sourceUrl: "https://docs.google.com/spreadsheets/d/portal/edit#gid=1" });
    expect(result.sources).toHaveLength(2);
    expect(fetchImpl.mock.calls.filter(([input]) => String(input).startsWith("https://www.googleapis.com/drive/"))).toHaveLength(1);
    expect(fetchImpl.mock.calls.some(([input]) => String(input).includes("Tiktok"))).toBe(false);
  });

  it("reads Ads Post when Creative Approval is absent and reports empty or inaccessible folders accurately", async () => {
    const input = { sheetUrl: "https://docs.google.com/spreadsheets/d/portal/edit", accessToken: "token" };
    const setup = (folderResponse: Response) => vi.fn()
      .mockResolvedValueOnce(Response.json({ sheets: [{ properties: { title: "🔵 Ads Post", sheetId: 2 } }] }))
      .mockResolvedValueOnce(Response.json({ sheets: [{ data: [{ rowData: [...adsHeaders, ["Active", "", "", "", "", "https://drive.google.com/drive/folders/final"].map(cell)].map(values => ({ values })) }] }] }))
      .mockResolvedValueOnce(folderResponse);
    await expect(readCreativeApprovalSheet({ ...input, fetchImpl: setup(Response.json({ files: [] })) })).resolves.toMatchObject({ rows: [], sources: [{ sheetTitle: "🔵 Ads Post", candidateCount: 1, imageCount: 0 }] });
    await expect(readCreativeApprovalSheet({ ...input, fetchImpl: setup(new Response(null, { status: 403 })) })).rejects.toThrow("Reconnect Google");
    await expect(readCreativeApprovalSheet({ ...input, fetchImpl: setup(Response.json({ files: [], nextPageToken: "more" })) })).rejects.toThrow("exceeds 100 images");
  });
});
