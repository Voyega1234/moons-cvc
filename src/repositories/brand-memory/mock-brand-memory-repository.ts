import type { LibraryItem } from "../../domain/brand";
import type {
  BrandDocument,
  BrandPastWorkItem,
  BrandProduct
} from "../../domain/brand-memory";
import type {
  AnalyzeGuidelineInput,
  BrandMemoryRepository,
  CreateLearningEntryInput,
  CreateReferenceImageInput,
  GuidelineAnalysisResult,
  SaveBrandRuleInput,
  SaveGuidelineInput,
  SaveBrandProductInput,
  UpdateBrandProductInput,
  UpdateBrandRuleInput,
  UpdateGuidelineInput,
  UploadBrandDocumentInput
} from "../../ports/brand-memory-repository";
import { createId, nowIso } from "../../shared/utils/id";

export class MockBrandMemoryRepository implements BrandMemoryRepository {
  private readonly brandRulesByClient = new Map<string, LibraryItem[]>();
  private readonly guidelinesByClient = new Map<string, LibraryItem[]>();
  private readonly productsByClient = new Map<string, BrandProduct[]>();
  private readonly documentsByClient = new Map<string, BrandDocument[]>();

  async listBrandRules(clientId: string): Promise<readonly LibraryItem[]> {
    return this.brandRulesByClient.get(clientId) ?? [];
  }

  async createBrandRule({
    clientId,
    title,
    description,
    assetFile
  }: SaveBrandRuleInput): Promise<LibraryItem> {
    const rule: LibraryItem = {
      id: createId("rule"),
      title,
      description,
      ...(assetFile ? { assetUrl: URL.createObjectURL(assetFile) } : {})
    };

    this.brandRulesByClient.set(clientId, [
      ...(this.brandRulesByClient.get(clientId) ?? []),
      rule
    ]);

    return rule;
  }

  async updateBrandRule({
    id,
    title,
    description,
    assetFile
  }: UpdateBrandRuleInput): Promise<LibraryItem> {
    for (const [clientId, rules] of this.brandRulesByClient) {
      const existing = rules.find((rule) => rule.id === id);
      if (!existing) continue;

      const updated = {
        ...existing,
        title,
        description,
        ...(assetFile ? { assetUrl: URL.createObjectURL(assetFile) } : {})
      };
      this.brandRulesByClient.set(
        clientId,
        rules.map((rule) => (rule.id === id ? updated : rule))
      );
      return updated;
    }

    throw new Error("Brand rule not found.");
  }

  async deleteBrandRule(id: string): Promise<void> {
    for (const [clientId, rules] of this.brandRulesByClient) {
      this.brandRulesByClient.set(
        clientId,
        rules.filter((rule) => rule.id !== id)
      );
    }
  }

  async listGuidelines(clientId: string): Promise<readonly LibraryItem[]> {
    return this.guidelinesByClient.get(clientId) ?? [];
  }

  async createGuideline({
    clientId,
    title,
    description
  }: SaveGuidelineInput): Promise<LibraryItem> {
    const guideline = { id: createId("guideline"), title, description };
    this.guidelinesByClient.set(clientId, [
      ...(this.guidelinesByClient.get(clientId) ?? []),
      guideline
    ]);
    return guideline;
  }

  async updateGuideline({
    id,
    title,
    description
  }: UpdateGuidelineInput): Promise<LibraryItem> {
    for (const [clientId, guidelines] of this.guidelinesByClient) {
      const existing = guidelines.find((guideline) => guideline.id === id);
      if (!existing) continue;
      const updated = { ...existing, title, description };
      this.guidelinesByClient.set(
        clientId,
        guidelines.map((guideline) =>
          guideline.id === id ? updated : guideline
        )
      );
      return updated;
    }
    throw new Error("Guideline not found.");
  }

  async deleteGuideline(id: string): Promise<void> {
    for (const [clientId, guidelines] of this.guidelinesByClient) {
      this.guidelinesByClient.set(
        clientId,
        guidelines.filter((guideline) => guideline.id !== id)
      );
    }
  }

  async listProducts(clientId: string): Promise<readonly BrandProduct[]> {
    return this.productsByClient.get(clientId) ?? [];
  }

  async createProduct(input: SaveBrandProductInput): Promise<BrandProduct> {
    const product: BrandProduct = {
      id: createId("product"),
      clientId: input.clientId,
      name: input.name,
      description: input.description,
      offer: input.offer,
      keyBenefit: input.keyBenefit,
      audience: input.audience,
      claimNotes: input.claimNotes,
      price: "",
      landingUrl: "",
      isActive: true,
      sortOrder: Date.now()
    };

    this.productsByClient.set(input.clientId, [
      ...(this.productsByClient.get(input.clientId) ?? []),
      product
    ]);
    return product;
  }

  async updateProduct(
    input: UpdateBrandProductInput
  ): Promise<BrandProduct> {
    for (const [clientId, products] of this.productsByClient) {
      const existing = products.find((product) => product.id === input.id);
      if (!existing) continue;

      const updated = { ...existing, ...input };
      this.productsByClient.set(
        clientId,
        products.map((product) =>
          product.id === input.id ? updated : product
        )
      );
      return updated;
    }

    throw new Error("Product not found.");
  }

  async deleteProduct(id: string): Promise<void> {
    for (const [clientId, products] of this.productsByClient) {
      this.productsByClient.set(
        clientId,
        products.filter((product) => product.id !== id)
      );
    }
  }

  async listPastWork(
    _clientId: string
  ): Promise<readonly BrandPastWorkItem[]> {
    return [];
  }

  async listDocuments(clientId: string): Promise<readonly BrandDocument[]> {
    return this.documentsByClient.get(clientId) ?? [];
  }

  async uploadDocument({
    clientId,
    file,
    documentType
  }: UploadBrandDocumentInput): Promise<BrandDocument> {
    const document: BrandDocument = {
      id: createId("doc"),
      clientId,
      title: file.name,
      documentType,
      fileUrl: null,
      storagePath: `mock/${clientId}/${file.name}`,
      mimeType: file.type || null,
      processingStatus: "uploaded",
      usableForAi: false,
      uploadedAt: nowIso()
    };

    this.documentsByClient.set(clientId, [
      ...(this.documentsByClient.get(clientId) ?? []),
      document
    ]);

    return document;
  }

  async createLearningEntry(_input: CreateLearningEntryInput): Promise<void> {
    // Mock mode has no persistent brand memory store to append to.
  }

  async createReferenceImage({
    file,
    label
  }: CreateReferenceImageInput): Promise<LibraryItem> {
    return {
      id: createId("ref"),
      title: label?.trim() || file.name,
      description: "",
      assetUrl: URL.createObjectURL(file)
    };
  }

  async analyzeGuideline(
    input: AnalyzeGuidelineInput
  ): Promise<GuidelineAnalysisResult> {
    if (input.text === undefined) {
      const { clientId, file } = input;
      const document: BrandDocument = {
        id: createId("doc"),
        clientId,
        title: file.name,
        documentType: "brand_guideline",
        fileUrl: null,
        storagePath: `mock/${clientId}/${file.name}`,
        mimeType: file.type || null,
        processingStatus: "ready_for_ai",
        usableForAi: true,
        uploadedAt: nowIso()
      };

      this.documentsByClient.set(clientId, [
        ...(this.documentsByClient.get(clientId) ?? []),
        document
      ]);
    }

    return {
      summary: "โทนสงบ หรูหรา ใช้ตัวอักษร sans-serif เรียบง่ายและเว้นพื้นที่ว่างมาก",
      generationContext:
        "Typography: ใช้ sans-serif ที่เรียบและอ่านง่าย\nLayout: เว้นพื้นที่ว่างมาก รักษาความรู้สึกสงบและพรีเมียม\nColor: ใช้สีหลักและสีรองตาม Brand CI เท่านั้น",
      primaryColors: ["#1D1D1F", "#6E6E73"],
      secondaryColors: ["#0A84FF"]
    };
  }
}
