import type { CreativeApprovalSource } from "../../domain/creative-approval.js";
import { validateQuestionnaireGoogleSheetUrl } from "../../domain/client-ingestion.js";

interface SheetCell {
  formattedValue?: string;
  hyperlink?: string;
  userEnteredValue?: { stringValue?: string; formulaValue?: string };
  textFormatRuns?: { format?: { link?: { uri?: string } } }[];
}

export interface CreativeApprovalRow {
  rowNumber: number;
  label: string;
  status: string;
  version: number;
  imageUrl: string;
  caption: string;
  feedback: string[];
  sheetTitle?: string;
  sourceUrl?: string;
  artworkUrl?: string;
  fileName?: string;
}

export async function readCreativeApprovalSheet({
  sheetUrl, accessToken, fetchImpl = fetch
}: {
  sheetUrl: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<{ sourceUrl: string; sheetTitle: string; sources: CreativeApprovalSource[]; rows: CreativeApprovalRow[] }> {
  const error = validateQuestionnaireGoogleSheetUrl(sheetUrl);
  if (error || !sheetUrl.trim()) throw new Error(error || "Client Portal URL is required.");
  const spreadsheetId = new URL(sheetUrl).pathname.split("/")[3]!;
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
  const metadata = await googleRead(`${base}?fields=sheets.properties`, accessToken, fetchImpl) as {
    sheets?: { properties: { sheetId: number; title: string; gridProperties?: { rowCount: number; columnCount: number } } }[];
  };
  const sheets = (metadata.sheets ?? []).filter(({ properties }) => ["creative approval", "ads post"].includes(normalizeSheetTitle(properties.title)))
    .sort((a, b) => Number(normalizeSheetTitle(a.properties.title) === "ads post") - Number(normalizeSheetTitle(b.properties.title) === "ads post"));
  if (!sheets.length) return { sourceUrl: sheetUrl, sheetTitle: "Creative Approval / Ads Post", sources: [], rows: [] };
  const tabs = await Promise.all(sheets.map(async ({ properties: sheet }) => {
    // Keep headers and the newest rows when a portal outgrows one bounded read.
    let rowCount = sheet.gridProperties?.rowCount ?? 1000;
    const columnCount = Math.min(sheet.gridProperties?.columnCount ?? 60, 60);
    const tab = `'${sheet.title.replaceAll("'", "''")}'`;
    const lastColumn = columnName(columnCount);
    if (rowCount > 1000) {
      if (rowCount > 20_000) throw new Error(`${sheet.title} exceeds the supported 20,000-row portal size.`);
      // Template grids often have thousands of empty allocated rows. Locate the last
      // labelled/status row before choosing the bounded, detailed artwork range.
      const labels = await googleRead(`${base}/values/${encodeURIComponent(`${tab}!A1:C${rowCount}`)}?majorDimension=ROWS`, accessToken, fetchImpl) as { values?: unknown[][] };
      rowCount = Math.max(2, labels.values?.length ?? 2);
    }
    const ranges = rowCount <= 1000 ? [`${tab}!A1:${lastColumn}${rowCount}`] : [`${tab}!A1:${lastColumn}20`, `${tab}!A${rowCount - 979}:${lastColumn}${rowCount}`];
    const fields = "sheets(data(startRow,rowData(values(formattedValue,userEnteredValue,hyperlink,textFormatRuns))))";
    const query = new URLSearchParams({ fields });
    for (const range of ranges) query.append("ranges", range);
    const payload = await googleRead(`${base}?${query}`, accessToken, fetchImpl) as {
      sheets?: { data?: { startRow?: number; rowData?: { values?: SheetCell[] }[] }[] }[];
    };
    const numberedRows = payload.sheets?.[0]?.data?.flatMap(block => block.rowData?.map((row, index) => ({ number: (block.startRow ?? 0) + index + 1, cells: row.values ?? [] })) ?? []).sort((a, b) => a.number - b.number) ?? [];
    const sourceUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheet.sheetId}`;
    const cells = numberedRows.map(row => row.cells);
    const numbers = numberedRows.map(row => row.number);
    const candidates = normalizeSheetTitle(sheet.title) === "ads post" ? selectAdsPostRows(cells, numbers) : selectCreativeApprovalRows(cells, numbers);
    return { sourceUrl, sheetTitle: sheet.title, candidates };
  }));
  const folders = new Map<string, CreativeApprovalFile[]>();
  const resolved = [];
  for (const tab of tabs) {
    const rows: CreativeApprovalRow[] = [];
    for (const candidate of tab.candidates) {
      const artworkUrl = candidate.imageUrl;
      const folderId = new URL(artworkUrl).pathname.match(/\/folders\/([\w-]+)$/)?.[1];
      if (!folderId) rows.push({ ...candidate, sheetTitle: tab.sheetTitle, sourceUrl: tab.sourceUrl });
      else {
        let files = folders.get(folderId);
        if (!files) {
          const query = new URLSearchParams({
            q: `'${folderId}' in parents and trashed = false and (mimeType = 'image/jpeg' or mimeType = 'image/png' or mimeType = 'image/webp' or mimeType = 'image/gif')`,
            fields: "nextPageToken,files(id,name)", pageSize: "100", orderBy: "name", supportsAllDrives: "true", includeItemsFromAllDrives: "true"
          });
          const listing = await googleRead(`https://www.googleapis.com/drive/v3/files?${query}`, accessToken, fetchImpl) as { files?: CreativeApprovalFile[]; nextPageToken?: string };
          if (listing.nextPageToken) throw new Error(`${tab.sheetTitle} row ${candidate.rowNumber}: artwork folder exceeds 100 images. Link the final image directly.`);
          files = listing.files ?? [];
          folders.set(folderId, files);
        }
        rows.push(...files.slice(0, 6).map(file => ({ ...candidate, sheetTitle: tab.sheetTitle, sourceUrl: tab.sourceUrl, artworkUrl, fileName: file.name, imageUrl: `https://drive.google.com/file/d/${file.id}/view` })));
      }
    }
    resolved.push(rows);
  }
  // Interleave sources so one busy tab cannot crowd out the other; dedupe the same artwork across tabs.
  const rows: CreativeApprovalRow[] = [];
  const seen = new Set<string>();
  while (rows.length < 6 && resolved.some(items => items.length)) {
    for (const items of resolved) {
      let row = items.shift();
      while (row && seen.has(row.imageUrl)) row = items.shift();
      if (row && !seen.has(row.imageUrl) && rows.length < 6) { rows.push(row); seen.add(row.imageUrl); }
    }
  }
  return {
    sourceUrl: tabs[0]!.sourceUrl,
    sheetTitle: tabs.map(tab => tab.sheetTitle).join(" / "),
    sources: tabs.map(tab => ({ sourceUrl: tab.sourceUrl, sheetTitle: tab.sheetTitle, candidateCount: tab.candidates.length, imageCount: rows.filter(row => row.sourceUrl === tab.sourceUrl).length })),
    rows
  };
}

export function selectCreativeApprovalRows(rows: readonly (readonly SheetCell[])[], rowNumbers?: readonly number[]): CreativeApprovalRow[] {
  const headerIndex = rows.findIndex(row => row.some(cell => /^status$/i.test(cellText(cell))));
  if (headerIndex < 0) throw new Error("Creative Approval has no STATUS header.");
  const header = rows[headerIndex]!;
  const detailHeader = rows[headerIndex + 1] ?? [];
  const statusIndex = header.findIndex(cell => /^status$/i.test(cellText(cell)));
  const typeIndex = header.findIndex(cell => /^type$/i.test(cellText(cell)));
  const imageColumns = detailHeader.flatMap((cell, index) => /^image\s*link$/i.test(cellText(cell)) ? [index] : []);
  if (!imageColumns.length) throw new Error("Creative Approval has no IMAGE LINK columns.");
  const selected: CreativeApprovalRow[] = [];
  for (let index = headerIndex + 2; index < rows.length; index += 1) {
    const row = rows[index]!;
    const status = cellText(row[statusIndex]);
    if (!/^(?:approved|published|ads\s+active|อนุมัติ(?:แล้ว)?|เผยแพร่แล้ว)$/i.test(status)) continue;
    if (typeIndex >= 0 && /video|motion|วิดีโอ/i.test(cellText(row[typeIndex]))) continue;
    let chosen: { column: number; imageUrl: string; version: number } | undefined;
    // A populated later revision always supersedes the earlier image, even if its URL is unsupported.
    for (const [version, column] of imageColumns.entries()) {
      const imageCell = row[column];
      if (cellText(imageCell) || imageCell?.hyperlink || imageCell?.userEnteredValue?.formulaValue) {
        chosen = { column, imageUrl: driveArtworkUrl(imageCell), version };
      }
    }
    if (!chosen?.imageUrl) continue;
    const groupEnd = imageColumns[chosen.version + 1] ?? detailHeader.length;
    const latestComments = row.slice(chosen.column + 1, groupEnd).filter((_, offset) => /comment/i.test(cellText(detailHeader[chosen!.column + offset + 1]))).map(cellText).filter(Boolean);
    // Unresolved feedback on the chosen revision is not a positive style example.
    if (latestComments.some(comment => !/^(?:cf|confirmed|approved|ok|okay|อนุมัติ|ผ่าน)[.!\s]*$/i.test(comment))) continue;
    const captionColumns = detailHeader.flatMap((cell, column) => column >= imageColumns[0]! && column <= groupEnd && /^caption$/i.test(cellText(cell)) ? [column] : []);
    const caption = captionColumns.map(column => cellText(row[column])).filter(Boolean).at(-1) ?? "";
    const feedback = row.flatMap((cell, column) => column < chosen!.column && /comment/i.test(cellText(detailHeader[column])) && cellText(cell) ? [cellText(cell)] : []);
    selected.push({ rowNumber: rowNumbers?.[index] ?? index + 1, label: cellText(row[0]), status, version: chosen.version, imageUrl: chosen.imageUrl, caption, feedback });
  }
  return recentDistinctRows(selected);
}

interface CreativeApprovalFile { id: string; name: string }

function normalizeSheetTitle(title: string): string {
  return title.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function selectAdsPostRows(rows: readonly (readonly SheetCell[])[], rowNumbers?: readonly number[]): CreativeApprovalRow[] {
  const headerIndex = rows.findIndex(row => row.some(cell => /^status$/i.test(cellText(cell))));
  if (headerIndex < 0) throw new Error("Ads Post has no STATUS header.");
  const header = rows[headerIndex]!;
  const detail = rows[headerIndex + 1] ?? [];
  const statusIndex = header.findIndex(cell => /^status$/i.test(cellText(cell)));
  const typeIndex = header.findIndex(cell => /^(?:post )?type$/i.test(cellText(cell)));
  const captionIndex = header.findIndex(cell => /^caption(?:\s|$)/i.test(cellText(cell)));
  const labelIndex = header.findIndex(cell => /ad name/i.test(cellText(cell)));
  const imageColumns = header.flatMap((cell, index) => /^(?:artwork url|aw link|image link)$/i.test(cellText(cell)) || /^(?:artwork url|aw link|image link)$/i.test(cellText(detail[index])) ? [index] : []);
  if (!imageColumns.length) throw new Error("Ads Post has no Artwork URL / AW Link columns.");
  const selected: CreativeApprovalRow[] = [];
  for (let index = headerIndex + 2; index < rows.length; index += 1) {
    const row = rows[index]!;
    const status = cellText(row[statusIndex]);
    if (!/^(?:active|end|ended|completed|approved|published|ads\s+active|อนุมัติ(?:แล้ว)?|เผยแพร่แล้ว)$/i.test(status)) continue;
    if (typeIndex >= 0 && /video|motion|วิดีโอ/i.test(cellText(row[typeIndex]))) continue;
    // AW Link can contain a month label, so consider only actual supported artwork links.
    const imageUrl = imageColumns.map(column => driveArtworkUrl(row[column])).find(Boolean);
    if (!imageUrl) continue;
    selected.push({ rowNumber: rowNumbers?.[index] ?? index + 1, label: cellText(row[labelIndex]) || `Ads Post row ${rowNumbers?.[index] ?? index + 1}`, status, version: 0, imageUrl, caption: cellText(row[captionIndex]), feedback: [] });
  }
  return recentDistinctRows(selected);
}

function recentDistinctRows(selected: CreativeApprovalRow[]): CreativeApprovalRow[] {
  const seen = new Set<string>();
  return selected.reverse().filter(row => {
    if (seen.has(row.imageUrl)) return false;
    seen.add(row.imageUrl);
    return true;
  }).slice(0, 6);
}

function cellText(cell: SheetCell | undefined): string {
  return (cell?.formattedValue ?? cell?.userEnteredValue?.stringValue ?? "").trim();
}

export function driveImageUrl(cell: SheetCell | undefined): string {
  const url = driveArtworkUrl(cell);
  return url.includes("/file/d/") ? url : "";
}

export function driveArtworkUrl(cell: SheetCell | undefined): string {
  const candidates = [cell?.hyperlink, cell?.userEnteredValue?.formulaValue?.match(/(?:IMAGE|HYPERLINK)\s*\(\s*"([^"]+)"/i)?.[1], ...cell?.textFormatRuns?.map(run => run.format?.link?.uri) ?? [], cellText(cell)];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate ?? "");
      if (url.protocol !== "https:" || !["drive.google.com", "docs.google.com"].includes(url.hostname)) continue;
      const folder = url.hostname === "drive.google.com" && url.pathname.match(/^\/drive(?:\/u\/\d+)?\/folders\/([\w-]+)(?:\/|$)/)?.[1];
      if (folder) return `https://drive.google.com/drive/folders/${folder}`;
      const id = url.pathname.match(/^\/file\/d\/([\w-]+)(?:\/|$)/)?.[1] ?? url.searchParams.get("id");
      if (id && /^[\w-]+$/.test(id)) return `https://drive.google.com/file/d/${id}/view`;
    } catch { /* A filename or an embedded image is not a downloadable Drive link. */ }
  }
  return "";
}

export async function googleRead(url: string, accessToken: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` }, redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403
    ? "Google access could not read Creative Approval or its artwork. Reconnect Google with read access to Sheets and Drive."
    : `Creative Approval Google read failed: HTTP ${response.status}`);
  return response.json();
}

function columnName(column: number): string {
  let name = "";
  while (column > 0) { column -= 1; name = String.fromCharCode(65 + column % 26) + name; column = Math.floor(column / 26); }
  return name;
}
