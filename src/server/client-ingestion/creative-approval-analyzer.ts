import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { creativeApprovalVisualFields, isCreativeApprovalVisualStyle, type CreativeApprovalContext, type CreativeApprovalExample, type CreativeApprovalVisualStyle } from "../../domain/creative-approval.js";
import { googleRead, type CreativeApprovalRow } from "../google-sheets/creative-approval-sheet.js";
import { withAiRetry } from "../shared/ai-retry.js";
import { extractStructuredJsonText } from "../shared/structured-output.js";

interface PreparedExample { row: CreativeApprovalRow; fingerprint: string; fileId: string }
interface ImageCopy {
  sourceIndex: number;
  headline: string;
  supportingCopy: string[];
  cta: string;
  styleObservations: string[];
  uncertainties: string[];
  visualStyle: CreativeApprovalVisualStyle;
}

export async function analyzeCreativeApproval({
  rows, cached, googleAccessToken, apiKey, model, fetchImpl = fetch,
  loadPrompt = () => readFile(join(process.cwd(), "agent_prompt/agent_creative_approval.md"), "utf8")
}: {
  rows: readonly CreativeApprovalRow[];
  cached?: CreativeApprovalContext;
  googleAccessToken: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  loadPrompt?: () => Promise<string>;
}): Promise<CreativeApprovalExample[]> {
  const policyPrompt = rows.length ? await loadPrompt() : "";
  const prepared: PreparedExample[] = [];
  for (const row of rows) {
    const fileId = new URL(row.imageUrl).pathname.split("/")[3]!;
    const metadata = await googleRead(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,mimeType,size,modifiedTime,version&supportsAllDrives=true`, googleAccessToken, fetchImpl) as { id?: string; mimeType?: string; size?: string; modifiedTime?: string; version?: string };
    if (metadata.id !== fileId || !/^image\/(?:jpeg|png|webp|gif)$/.test(metadata.mimeType ?? "")) {
      throw new Error(`Creative Approval row ${row.rowNumber}: the linked file is not a supported image.`);
    }
    if (!metadata.modifiedTime || !metadata.version) throw new Error(`Creative Approval row ${row.rowNumber}: image version is unavailable.`);
    if (Number(metadata.size) > MAX_IMAGE_BYTES) throw new Error(`Creative Approval row ${row.rowNumber}: image exceeds 10 MB.`);
    prepared.push({ row, fileId, fingerprint: createHash("sha256").update(JSON.stringify({ policyPrompt, model, row, modifiedTime: metadata.modifiedTime, version: metadata.version })).digest("hex") });
  }
  const previous = new Map(cached?.examples.map(example => [example.fingerprint, example]));
  const changed = prepared.filter(example => !previous.has(example.fingerprint));
  const extracted = new Map<string, ImageCopy>();
  if (changed.length) {
    if (!apiKey.trim() || !model.trim()) throw new Error("Creative Approval requires the configured OpenRouter brand analysis model.");
    const content: unknown[] = [{ type: "text", text: policyPrompt }];
    for (const [sourceIndex, example] of changed.entries()) {
      content.push({ type: "text", text: JSON.stringify({ sourceIndex, sheetTitle: example.row.sheetTitle, rowNumber: example.row.rowNumber, fileName: example.row.fileName, label: example.row.label, status: example.row.status, version: example.row.version, caption: example.row.caption, feedback: example.row.feedback }) });
      const bytes = await downloadImage(example.fileId, googleAccessToken, fetchImpl);
      const image = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
      content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${image.toString("base64")}`, detail: "high" } });
    }
    const copies = await withAiRetry(async () => {
      const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content }], max_tokens: 16000, response_format: { type: "json_schema", json_schema: { name: "creative_approval_copy", strict: true, schema: copySchema } } }),
        signal: AbortSignal.timeout(180_000)
      });
      if (!response.ok) throw new Error(`Creative Approval image analysis failed: HTTP ${response.status}`);
      return parseImageCopies(JSON.parse(extractStructuredJsonText(await response.json(), "Creative Approval image analysis")), changed.length);
    });
    for (const copy of copies) extracted.set(changed[copy.sourceIndex]!.fingerprint, copy);
  }
  return prepared.map(({ row, fingerprint }) => {
    const copy = previous.get(fingerprint) ?? extracted.get(fingerprint);
    if (!copy) throw new Error("Creative Approval image analysis omitted an image.");
    return { ...row, fingerprint, headline: copy.headline, supportingCopy: copy.supportingCopy, cta: copy.cta, styleObservations: copy.styleObservations, uncertainties: copy.uncertainties, visualStyle: copy.visualStyle };
  });
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

async function downloadImage(fileId: string, accessToken: string, fetchImpl: typeof fetch): Promise<Buffer> {
  // Only Google Drive API URLs receive the user's token; never fetch arbitrary sheet URLs.
  const response = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${accessToken}` }, redirect: "error", signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok || !response.body) throw new Error(`Could not read Creative Approval artwork: HTTP ${response.status}. Check Drive read access.`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) throw new Error("Creative Approval image exceeds 10 MB.");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

export function parseImageCopies(value: unknown, count: number): ImageCopy[] {
  if (!isRecord(value) || !Array.isArray(value.examples) || value.examples.length !== count) throw new Error("Creative Approval image analysis returned the wrong number of images.");
  const seen = new Set<number>();
  return value.examples.map((copy: unknown) => {
    if (!isRecord(copy) || typeof copy.sourceIndex !== "number" || !Number.isInteger(copy.sourceIndex) || copy.sourceIndex < 0 || copy.sourceIndex >= count || seen.has(copy.sourceIndex)) throw new Error("Creative Approval image analysis returned an invalid image index.");
    seen.add(copy.sourceIndex);
    for (const key of ["headline", "cta"] as const) if (typeof copy[key] !== "string" || copy[key].length > 4000) throw new Error("Invalid extracted image copy.");
    for (const key of ["supportingCopy", "styleObservations", "uncertainties"] as const) if (!Array.isArray(copy[key]) || copy[key].length > 20 || !copy[key].every((item: unknown) => typeof item === "string" && item.length <= 2000)) throw new Error("Invalid extracted image copy details.");
    if (!isCreativeApprovalVisualStyle(copy.visualStyle)) throw new Error("Invalid extracted visual style.");
    return copy as unknown as ImageCopy;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const copySchema = {
  type: "object", additionalProperties: false, required: ["examples"], properties: {
    examples: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["sourceIndex", "headline", "supportingCopy", "cta", "styleObservations", "uncertainties", "visualStyle"],
      properties: {
        sourceIndex: { type: "integer" }, headline: { type: "string" }, cta: { type: "string" },
        supportingCopy: { type: "array", items: { type: "string" } },
        styleObservations: { type: "array", items: { type: "string" } },
        uncertainties: { type: "array", items: { type: "string" } },
        visualStyle: { type: "object", additionalProperties: false, required: [...creativeApprovalVisualFields], properties: Object.fromEntries(creativeApprovalVisualFields.map(field => [field, { type: "array", items: { type: "string" } }])) }
      }
    } }
  }
};
