import type { Brand } from "../../domain/brand";
import {
  initialsFromClientName,
  validateClientCategory,
  validateFacebookUrl,
  validateOnboardingQuestionnaire,
  type CreateClientDraftInput,
  type CreateClientDraftResult,
  type QueueClientIngestionInput,
  type QueueClientIngestionResult
} from "../../domain/client-ingestion";
import type { ClientIntakeRepository } from "../../ports/client-intake-repository";
import { slugify } from "../../shared/utils/text";
import type { MockBrandRepository } from "../brands/mock-brand-repository";

export class MockClientIntakeRepository implements ClientIntakeRepository {
  constructor(private readonly brandRepository: MockBrandRepository) {}

  async createDraftClient({
    name,
    facebookUrl,
    category,
    questionnaire
  }: CreateClientDraftInput): Promise<CreateClientDraftResult> {
    const error = validateFacebookUrl(facebookUrl);
    if (error) throw new Error(error);
    const categoryError = validateClientCategory(category ?? "");
    if (categoryError) throw new Error(categoryError);
    const questionnaireError = validateOnboardingQuestionnaire(
      questionnaire.text
    );
    if (questionnaireError) throw new Error(questionnaireError);
    const questionnaireText = questionnaire.text.trim();

    const brand: Brand = {
      id: createClientId(name),
      name: name.trim(),
      category: category?.trim() || "Awaiting brand ingestion",
      initials: initialsFromClientName(name),
      facebookUrl: facebookUrl.trim(),
      ingestionStatus: "queued",
      library: { brand: [], products: [], docs: [], refs: [] },
      memory: { working: [], avoid: [] },
      existsInSystem: true,
      source: "system",
      onboardingQuestionnaire: {
        ...(questionnaire.sourceUrl?.trim()
          ? { sourceUrl: questionnaire.sourceUrl.trim() }
          : {}),
        text: questionnaireText,
        preview: questionnaireText.slice(0, 280),
        facebookUrls: [],
        ...(questionnaire.sheetTitle?.trim()
          ? { sheetTitle: questionnaire.sheetTitle.trim() }
          : {}),
        ...(questionnaire.extractedFields?.length
          ? { extractedFields: questionnaire.extractedFields }
          : {})
      }
    };

    this.brandRepository.addClient(brand);

    return {
      brand,
      jobId: `job-${brand.id}`
    };
  }

  async queueExistingClient({
    clientId,
    facebookUrl,
    questionnaire
  }: QueueClientIngestionInput): Promise<QueueClientIngestionResult> {
    const error = validateFacebookUrl(facebookUrl);
    if (error) throw new Error(error);
    const questionnaireError = validateOnboardingQuestionnaire(
      questionnaire.text
    );
    if (questionnaireError) throw new Error(questionnaireError);
    const questionnaireText = questionnaire.text.trim();

    const brand = await this.brandRepository.getById(clientId);
    if (!brand) throw new Error("Client not found.");

    this.brandRepository.updateClient({
      ...brand,
      facebookUrl: facebookUrl.trim(),
      ingestionStatus: "queued",
      ingestionError: undefined,
      onboardingQuestionnaire: {
        ...(questionnaire.sourceUrl?.trim()
          ? { sourceUrl: questionnaire.sourceUrl.trim() }
          : {}),
        text: questionnaireText,
        preview: questionnaireText.slice(0, 280),
        facebookUrls: [],
        ...(questionnaire.sheetTitle?.trim()
          ? { sheetTitle: questionnaire.sheetTitle.trim() }
          : {}),
        ...(questionnaire.extractedFields?.length
          ? { extractedFields: questionnaire.extractedFields }
          : {})
      }
    });

    return { jobId: `job-${brand.id}` };
  }
}

function createClientId(name: string): string {
  const base = slugify(name) || "client";
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}
