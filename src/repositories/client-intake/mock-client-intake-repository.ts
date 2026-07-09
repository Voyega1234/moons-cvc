import type { Brand } from "../../domain/brand";
import {
  initialsFromClientName,
  validateFacebookUrl,
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
    category
  }: CreateClientDraftInput): Promise<CreateClientDraftResult> {
    const error = validateFacebookUrl(facebookUrl);
    if (error) throw new Error(error);

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
      source: "system"
    };

    this.brandRepository.addClient(brand);

    return {
      brand,
      jobId: `job-${brand.id}`
    };
  }

  async queueExistingClient({
    clientId,
    facebookUrl
  }: QueueClientIngestionInput): Promise<QueueClientIngestionResult> {
    const error = validateFacebookUrl(facebookUrl);
    if (error) throw new Error(error);

    const brand = await this.brandRepository.getById(clientId);
    if (!brand) throw new Error("Client not found.");

    this.brandRepository.updateClient({
      ...brand,
      facebookUrl: facebookUrl.trim(),
      ingestionStatus: "queued",
      ingestionError: undefined
    });

    return { jobId: `job-${brand.id}` };
  }
}

function createClientId(name: string): string {
  const base = slugify(name) || "client";
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}
