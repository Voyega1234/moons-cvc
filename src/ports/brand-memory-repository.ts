import type {
  LibraryItem,
  OnboardingQuestionnaireSource,
  QuestionnaireExtractedField
} from "../domain/brand";
import type {
  BrandDocument,
  BrandDocumentType,
  BrandPastWorkItem,
  BrandProduct
} from "../domain/brand-memory";

export interface UploadBrandDocumentInput {
  clientId: string;
  file: File;
  documentType: BrandDocumentType;
}

export interface SaveBrandRuleInput {
  clientId: string;
  title: string;
  description: string;
  assetFile?: File;
}

export interface UpdateBrandRuleInput {
  id: string;
  title: string;
  description: string;
  assetFile?: File;
}

export interface SaveGuidelineInput {
  clientId: string;
  title: string;
  description: string;
}

export interface UpdateGuidelineInput {
  id: string;
  title: string;
  description: string;
}

export interface SaveBrandProductInput {
  clientId: string;
  name: string;
  description: string;
  offer: string;
  keyBenefit: string;
  audience: string;
  claimNotes: string;
}

export interface UpdateBrandProductInput
  extends Omit<SaveBrandProductInput, "clientId"> {
  id: string;
}

export interface CreateLearningEntryInput {
  clientId: string;
  polarity: "working" | "avoid";
  note: string;
  sourceRunId?: string;
}

export interface CreateReferenceImageInput {
  clientId: string;
  file: File;
  label?: string;
}

export interface SaveOnboardingQuestionnaireInput {
  clientId: string;
  text: string;
  sourceUrl?: string;
  sheetTitle?: string;
  extractedFields?: readonly QuestionnaireExtractedField[];
}

export type AnalyzeGuidelineInput =
  | { clientId: string; file: File; text?: undefined }
  | { clientId: string; text: string; file?: undefined };

export interface GuidelineAnalysisResult {
  summary: string;
  generationContext: string;
  primaryColors: readonly string[];
  secondaryColors: readonly string[];
}

export interface BrandMemoryRepository {
  listBrandRules(clientId: string): Promise<readonly LibraryItem[]>;
  createBrandRule(input: SaveBrandRuleInput): Promise<LibraryItem>;
  updateBrandRule(input: UpdateBrandRuleInput): Promise<LibraryItem>;
  deleteBrandRule(id: string): Promise<void>;
  listGuidelines(clientId: string): Promise<readonly LibraryItem[]>;
  createGuideline(input: SaveGuidelineInput): Promise<LibraryItem>;
  updateGuideline(input: UpdateGuidelineInput): Promise<LibraryItem>;
  deleteGuideline(id: string): Promise<void>;
  listProducts(clientId: string): Promise<readonly BrandProduct[]>;
  createProduct(input: SaveBrandProductInput): Promise<BrandProduct>;
  updateProduct(input: UpdateBrandProductInput): Promise<BrandProduct>;
  deleteProduct(id: string): Promise<void>;
  listPastWork(clientId: string): Promise<readonly BrandPastWorkItem[]>;
  listDocuments(clientId: string): Promise<readonly BrandDocument[]>;
  uploadDocument(input: UploadBrandDocumentInput): Promise<BrandDocument>;
  createLearningEntry(input: CreateLearningEntryInput): Promise<void>;
  createReferenceImage(input: CreateReferenceImageInput): Promise<LibraryItem>;
  saveOnboardingQuestionnaire(
    input: SaveOnboardingQuestionnaireInput
  ): Promise<OnboardingQuestionnaireSource>;
  analyzeGuideline(
    input: AnalyzeGuidelineInput
  ): Promise<GuidelineAnalysisResult>;
}
