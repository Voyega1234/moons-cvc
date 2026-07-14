export type BrandDocumentProcessingStatus =
  | "uploaded"
  | "processing"
  | "ready_for_ai"
  | "failed";

export const brandDocumentTypes = [
  "brand_guideline",
  "product_factsheet",
  "campaign_brief",
  "claim_support",
  "reference",
  "report",
  "other"
] as const;

export type BrandDocumentType = (typeof brandDocumentTypes)[number];

export const brandDocumentTypeLabels: Record<BrandDocumentType, string> = {
  brand_guideline: "Brand guideline",
  product_factsheet: "Product factsheet",
  campaign_brief: "Campaign brief",
  claim_support: "Claim support",
  reference: "Reference",
  report: "Report",
  other: "Other"
};

export function isBrandDocumentType(value: string): value is BrandDocumentType {
  return brandDocumentTypes.includes(value as BrandDocumentType);
}

export interface BrandDocument {
  id: string;
  clientId: string;
  title: string;
  documentType: BrandDocumentType;
  fileUrl: string | null;
  storagePath: string | null;
  mimeType: string | null;
  processingStatus: BrandDocumentProcessingStatus;
  usableForAi: boolean;
  uploadedAt: string;
}

export interface BrandProduct {
  id: string;
  clientId: string;
  name: string;
  description: string;
  offer: string;
  keyBenefit: string;
  audience: string;
  claimNotes: string;
  price: string;
  landingUrl: string;
  isActive: boolean;
  sortOrder: number;
}

export interface BrandPastWorkItem {
  id: string;
  title: string;
  description: string;
  imageUrl: string | null;
  sourceUrl: string | null;
  sourceType: "facebook_post" | "ads_library";
}
