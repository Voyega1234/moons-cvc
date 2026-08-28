import type {
  LibraryItem,
  OnboardingQuestionnaireSource,
  QuestionnaireExtractedField
} from "../domain/brand";
import type {
  BrandDocument,
  BrandDocumentType,
  BrandAssetFolder,
  BrandAssetImage,
  BrandAssetKind,
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

export interface CreateBrandAssetFolderInput {
  clientId: string;
  kind: BrandAssetKind;
  name: string;
  parentId?: string;
  sourceProvider?: "google-drive";
  sourceId?: string;
  sourceUrl?: string;
}

export interface CreateBrandAssetImageInput {
  clientId: string;
  kind: BrandAssetKind;
  folderId?: string;
  file: File;
  sourceProvider?: "google-drive";
  sourceId?: string;
}

export interface UpdateBrandAssetFolderInput {
  id: string;
  name: string;
}

export interface MoveBrandAssetFolderInput {
  id: string;
  parentId: string | null;
}

export interface MoveBrandAssetImageInput {
  id: string;
  folderId: string | null;
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
  deleteReferenceImage(id: string): Promise<void>;
  listAssetFolders(clientId: string): Promise<readonly BrandAssetFolder[]>;
  listAssetImages(clientId: string): Promise<readonly BrandAssetImage[]>;
  createAssetFolder(
    input: CreateBrandAssetFolderInput
  ): Promise<BrandAssetFolder>;
  updateAssetFolder(
    input: UpdateBrandAssetFolderInput
  ): Promise<BrandAssetFolder>;
  moveAssetFolder(input: MoveBrandAssetFolderInput): Promise<BrandAssetFolder>;
  deleteAssetFolder(id: string): Promise<void>;
  createAssetImage(input: CreateBrandAssetImageInput): Promise<BrandAssetImage>;
  moveAssetImage(input: MoveBrandAssetImageInput): Promise<BrandAssetImage>;
  deleteAssetImage(id: string): Promise<void>;
  saveOnboardingQuestionnaire(
    input: SaveOnboardingQuestionnaireInput
  ): Promise<OnboardingQuestionnaireSource>;
  analyzeGuideline(
    input: AnalyzeGuidelineInput
  ): Promise<GuidelineAnalysisResult>;
}
