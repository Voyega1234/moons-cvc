import type {
  LibraryItem,
  OnboardingQuestionnaireSource
} from "../../domain/brand";
import { validateOnboardingQuestionnaire } from "../../domain/client-ingestion";
import type {
  BrandDocument,
  BrandAssetFolder,
  BrandAssetImage,
  BrandPastWorkItem,
  BrandProduct
} from "../../domain/brand-memory";
import type {
  AnalyzeGuidelineInput,
  BrandMemoryRepository,
  CreateBrandAssetFolderInput,
  CreateBrandAssetImageInput,
  CreateLearningEntryInput,
  CreateReferenceImageInput,
  GuidelineAnalysisResult,
  MoveBrandAssetFolderInput,
  MoveBrandAssetImageInput,
  SaveBrandRuleInput,
  SaveGuidelineInput,
  SaveBrandProductInput,
  SaveOnboardingQuestionnaireInput,
  UpdateBrandAssetFolderInput,
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
  private readonly questionnairesByClient = new Map<
    string,
    OnboardingQuestionnaireSource
  >();
  private readonly assetFoldersByClient = new Map<string, BrandAssetFolder[]>();
  private readonly assetImagesByClient = new Map<string, BrandAssetImage[]>();

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

  async deleteReferenceImage(_id: string): Promise<void> {
    // The workflow state owns mock reference items; there is no backing store.
  }

  async listAssetFolders(
    clientId: string
  ): Promise<readonly BrandAssetFolder[]> {
    return this.assetFoldersByClient.get(clientId) ?? [];
  }

  async listAssetImages(clientId: string): Promise<readonly BrandAssetImage[]> {
    return [...(this.assetImagesByClient.get(clientId) ?? [])].reverse();
  }

  async createAssetFolder(
    input: CreateBrandAssetFolderInput
  ): Promise<BrandAssetFolder> {
    const folders = this.assetFoldersByClient.get(input.clientId) ?? [];
    const existing = folders.find(
      (folder) =>
        folder.kind === input.kind &&
        (input.sourceId
          ? folder.sourceId === input.sourceId
          : folder.parentId === (input.parentId ?? null) &&
            folder.name === input.name.trim())
    );
    if (existing) return existing;
    const folder: BrandAssetFolder = {
      id: createId("asset-folder"),
      clientId: input.clientId,
      parentId: input.parentId ?? null,
      kind: input.kind,
      name: input.name.trim(),
      ...(input.sourceProvider ? { sourceProvider: input.sourceProvider } : {}),
      ...(input.sourceId ? { sourceId: input.sourceId } : {}),
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {})
    };
    this.assetFoldersByClient.set(input.clientId, [...folders, folder]);
    return folder;
  }

  async updateAssetFolder(
    input: UpdateBrandAssetFolderInput
  ): Promise<BrandAssetFolder> {
    for (const [clientId, folders] of this.assetFoldersByClient) {
      const existing = folders.find((folder) => folder.id === input.id);
      if (!existing) continue;
      const updated = { ...existing, name: input.name.trim() };
      this.assetFoldersByClient.set(
        clientId,
        folders.map((folder) => (folder.id === input.id ? updated : folder))
      );
      return updated;
    }
    throw new Error("Asset folder not found.");
  }

  async moveAssetFolder(
    input: MoveBrandAssetFolderInput
  ): Promise<BrandAssetFolder> {
    for (const [clientId, folders] of this.assetFoldersByClient) {
      const existing = folders.find((folder) => folder.id === input.id);
      if (!existing) continue;
      if (input.parentId === input.id) {
        throw new Error("Can't move a folder into itself.");
      }
      if (input.parentId) {
        const descendantIds = new Set([existing.id]);
        let changed = true;
        while (changed) {
          changed = false;
          folders.forEach((folder) => {
            if (
              folder.parentId &&
              descendantIds.has(folder.parentId) &&
              !descendantIds.has(folder.id)
            ) {
              descendantIds.add(folder.id);
              changed = true;
            }
          });
        }
        if (descendantIds.has(input.parentId)) {
          throw new Error("Can't move a folder into its own subfolder.");
        }
      }
      const updated = { ...existing, parentId: input.parentId };
      this.assetFoldersByClient.set(
        clientId,
        folders.map((folder) => (folder.id === input.id ? updated : folder))
      );
      return updated;
    }
    throw new Error("Asset folder not found.");
  }

  async deleteAssetFolder(id: string): Promise<void> {
    for (const [clientId, folders] of this.assetFoldersByClient) {
      if (!folders.some((folder) => folder.id === id)) continue;
      const deletedIds = new Set([id]);
      let changed = true;
      while (changed) {
        changed = false;
        folders.forEach((folder) => {
          if (folder.parentId && deletedIds.has(folder.parentId)) {
            if (!deletedIds.has(folder.id)) changed = true;
            deletedIds.add(folder.id);
          }
        });
      }
      this.assetFoldersByClient.set(
        clientId,
        folders.filter((folder) => !deletedIds.has(folder.id))
      );
      this.assetImagesByClient.set(
        clientId,
        (this.assetImagesByClient.get(clientId) ?? []).filter(
          (image) => !image.folderId || !deletedIds.has(image.folderId)
        )
      );
      return;
    }
  }

  async createAssetImage(
    input: CreateBrandAssetImageInput
  ): Promise<BrandAssetImage> {
    const images = this.assetImagesByClient.get(input.clientId) ?? [];
    const existing = input.sourceId
      ? images.find(
          (image) =>
            image.kind === input.kind && image.sourceId === input.sourceId
        )
      : undefined;
    if (existing) return existing;
    const image: BrandAssetImage = {
      id: createId("asset"),
      clientId: input.clientId,
      folderId: input.folderId ?? null,
      kind: input.kind,
      name: input.file.name,
      mimeType: input.file.type,
      url:
        typeof URL.createObjectURL === "function"
          ? URL.createObjectURL(input.file)
          : `data:${input.file.type};base64,bW9jaw==`,
      storagePath: `mock/${input.clientId}/asset-library/${input.file.name}`,
      ...(input.sourceProvider ? { sourceProvider: input.sourceProvider } : {}),
      ...(input.sourceId ? { sourceId: input.sourceId } : {})
    };
    this.assetImagesByClient.set(input.clientId, [...images, image]);
    return image;
  }

  async moveAssetImage(
    input: MoveBrandAssetImageInput
  ): Promise<BrandAssetImage> {
    for (const [clientId, images] of this.assetImagesByClient) {
      const existing = images.find((image) => image.id === input.id);
      if (!existing) continue;
      const updated = { ...existing, folderId: input.folderId };
      this.assetImagesByClient.set(
        clientId,
        images.map((image) => (image.id === input.id ? updated : image))
      );
      return updated;
    }
    throw new Error("Asset image not found.");
  }

  async deleteAssetImage(id: string): Promise<void> {
    for (const [clientId, images] of this.assetImagesByClient) {
      if (!images.some((image) => image.id === id)) continue;
      this.assetImagesByClient.set(
        clientId,
        images.filter((image) => image.id !== id)
      );
      return;
    }
  }

  async saveOnboardingQuestionnaire({
    clientId,
    text,
    sourceUrl,
    sheetTitle,
    extractedFields
  }: SaveOnboardingQuestionnaireInput): Promise<OnboardingQuestionnaireSource> {
    const validationError = validateOnboardingQuestionnaire(text);
    if (validationError) throw new Error(validationError);

    const normalizedText = text.trim();
    const questionnaire: OnboardingQuestionnaireSource = {
      ...(sourceUrl?.trim() ? { sourceUrl: sourceUrl.trim() } : {}),
      text: normalizedText,
      preview: normalizedText.slice(0, 280),
      facebookUrls: [],
      ...(sheetTitle?.trim() ? { sheetTitle: sheetTitle.trim() } : {}),
      ...(extractedFields?.length ? { extractedFields } : {})
    };
    this.questionnairesByClient.set(clientId, questionnaire);
    return questionnaire;
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
