import type { Brand } from "./brand";
import { validateQuestionnaireGoogleSheetUrl } from "./client-ingestion";

export const CREATIVE_APPROVAL_DOCUMENT_TITLE = "Copy style from Creative Approval";

export const creativeApprovalVisualFields = ["colors", "typography", "layout", "imagery", "moodTone", "brandElements"] as const;
export type CreativeApprovalVisualStyle = Record<typeof creativeApprovalVisualFields[number], readonly string[]>;

export function isCreativeApprovalVisualStyle(value: unknown): value is CreativeApprovalVisualStyle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return creativeApprovalVisualFields.every(field => Array.isArray(record[field]) && record[field].length <= 12 && record[field].every((item: unknown) => typeof item === "string" && item.length <= 1000));
}

export interface CreativeApprovalExample {
  sheetTitle?: string;
  sourceUrl?: string;
  artworkUrl?: string;
  fileName?: string;
  rowNumber: number;
  label: string;
  status: string;
  version: number;
  imageUrl: string;
  caption: string;
  feedback: readonly string[];
  fingerprint: string;
  headline: string;
  supportingCopy: readonly string[];
  cta: string;
  styleObservations: readonly string[];
  uncertainties: readonly string[];
  visualStyle: CreativeApprovalVisualStyle;
}

export interface CreativeApprovalSource {
  sheetTitle: string;
  sourceUrl: string;
  candidateCount: number;
  imageCount: number;
}

export interface CreativeApprovalContext {
  version: 1;
  sourceUrl: string;
  sheetTitle: string;
  examples: readonly CreativeApprovalExample[];
  sources?: readonly CreativeApprovalSource[];
}
export function creativeApprovalSourceUrl(brand: Brand | null | undefined): string | null {
  const url = brand?.onboardingQuestionnaire?.sourceUrl || brand?.mappingClientPortalUrl;
  return url && !validateQuestionnaireGoogleSheetUrl(url) ? url : null;
}

export function creativeApprovalContextSummary(brand: Brand | null | undefined): { status: "missing-source" | "pending" | "empty" | "ready"; count: number; visualCount: number; sources?: readonly CreativeApprovalSource[] } {
  const source = creativeApprovalSourceUrl(brand);
  if (!source) return { status: "missing-source", count: 0, visualCount: 0 };
  const pending = { status: "pending" as const, count: 0, visualCount: 0 };
  const document = brand?.library.docs.find(item => item.title === CREATIVE_APPROVAL_DOCUMENT_TITLE);
  if (!document) return pending;
  try {
    const context = JSON.parse(document.description) as CreativeApprovalContext;
    if (context.version !== 1 || !Array.isArray(context.examples) || new URL(context.sourceUrl).pathname.split("/")[3] !== new URL(source).pathname.split("/")[3]) return pending;
    const examples = context.examples.filter(example => example && typeof example.headline === "string");
    const sources = Array.isArray(context.sources) && context.sources.every(source => source && typeof source.sheetTitle === "string" && typeof source.sourceUrl === "string" && Number.isInteger(source.imageCount) && source.imageCount >= 0 && Number.isInteger(source.candidateCount) && source.candidateCount >= 0) ? context.sources : undefined;
    return { sources, status: examples.length ? "ready" : "empty", count: examples.length, visualCount: examples.filter(example => isCreativeApprovalVisualStyle(example.visualStyle) && creativeApprovalVisualFields.some(field => example.visualStyle[field].length > 0)).length };
  } catch { return pending; }
}
