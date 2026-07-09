import type { LibraryItem } from "../domain/brand";
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
}

export interface UpdateBrandRuleInput {
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

export interface BrandMemoryRepository {
  listBrandRules(clientId: string): Promise<readonly LibraryItem[]>;
  createBrandRule(input: SaveBrandRuleInput): Promise<LibraryItem>;
  updateBrandRule(input: UpdateBrandRuleInput): Promise<LibraryItem>;
  deleteBrandRule(id: string): Promise<void>;
  listProducts(clientId: string): Promise<readonly BrandProduct[]>;
  createProduct(input: SaveBrandProductInput): Promise<BrandProduct>;
  updateProduct(input: UpdateBrandProductInput): Promise<BrandProduct>;
  deleteProduct(id: string): Promise<void>;
  listAdsLibraryPastWork(
    clientId: string
  ): Promise<readonly BrandPastWorkItem[]>;
  listDocuments(clientId: string): Promise<readonly BrandDocument[]>;
  uploadDocument(input: UploadBrandDocumentInput): Promise<BrandDocument>;
}
