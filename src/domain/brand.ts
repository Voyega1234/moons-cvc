export type LibrarySection = "brand" | "products" | "docs" | "refs";

export interface LibraryItem {
  id: string;
  title: string;
  description: string;
  assetUrl?: string;
}

/**
 * Retained in persistence for possible future use, but intentionally hidden
 * from the product and excluded from every agent input.
 */
export function isActiveBrandKitItem(
  item: Pick<LibraryItem, "title">
): boolean {
  const normalizedTitle = item.title
    .trim()
    .toLowerCase()
    .replace(/[:：]\s*$/u, "");
  return normalizedTitle !== "visual guidance";
}

export function activeBrandKitItems<T extends Pick<LibraryItem, "title">>(
  items: readonly T[]
): readonly T[] {
  return items.filter(isActiveBrandKitItem);
}

export function isBrandPolicyItem(
  item: Pick<LibraryItem, "title">
): boolean {
  return /(^|[^a-z])policy([^a-z]|$)/i.test(item.title.trim());
}

export interface BrandLibrary {
  brand: readonly LibraryItem[];
  products: readonly LibraryItem[];
  docs: readonly LibraryItem[];
  refs: readonly LibraryItem[];
}

export interface BrandMemory {
  working: readonly string[];
  avoid: readonly string[];
}

export interface QuestionnaireExtractedField {
  key: string;
  label: string;
  value: string;
}

export interface OnboardingQuestionnaireSource {
  sourceUrl?: string;
  text: string;
  preview: string;
  facebookUrls: readonly string[];
  sheetTitle?: string;
  extractedFields?: readonly QuestionnaireExtractedField[];
}

export interface Brand {
  id: string;
  name: string;
  category: string;
  initials: string;
  facebookUrl?: string;
  ingestionStatus?: ClientIngestionStatus;
  ingestionError?: string;
  ingestionUpdatedAt?: string;
  library: BrandLibrary;
  memory: BrandMemory;
  existsInSystem?: boolean;
  mappingStatus?: string;
  serviceStatus?: string;
  mappingClientPortalUrl?: string;
  onboardingQuestionnaire?: OnboardingQuestionnaireSource;
  source?: "system" | "mapping";
}

export type ClientIngestionStatus =
  | "not_started"
  | "draft"
  | "queued"
  | "validating_source"
  | "scraping_facebook_posts"
  | "scraping_facebook_ads"
  | "searching_fallback"
  | "mirroring_images"
  | "analyzing_visuals"
  | "analyzing_brand"
  | "writing_memory"
  | "ready"
  | "needs_review"
  | "failed";

export function canSelectBrand(brand: Brand): boolean {
  if (brand.existsInSystem === false) return false;

  if (!brand.ingestionStatus) return true;

  return ["ready", "needs_review"].includes(brand.ingestionStatus);
}

export function canStartBrandIngestion(brand: Brand): boolean {
  if (brand.existsInSystem === false) return false;

  return ["not_started", "draft", "failed"].includes(
    brand.ingestionStatus ?? ""
  );
}

export function brandLogoUrl(
  brand: Brand | null | undefined
): string | undefined {
  return brand?.library.brand.find(
    (item) => item.title.trim().toLowerCase() === "logo" && item.assetUrl
  )?.assetUrl;
}
