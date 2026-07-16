export type LibrarySection = "brand" | "products" | "docs" | "refs";

export interface LibraryItem {
  id: string;
  title: string;
  description: string;
  assetUrl?: string;
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

export interface QuestionnaireBrandSource {
  sourceUrl?: string;
  text: string;
  preview: string;
  facebookUrls: readonly string[];
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
  mappingQuestionnaire?: QuestionnaireBrandSource;
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
