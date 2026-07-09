import type {
  CreateClientDraftInput,
  CreateClientDraftResult,
  QueueClientIngestionInput,
  QueueClientIngestionResult
} from "../domain/client-ingestion";

export interface ClientIntakeRepository {
  createDraftClient(
    input: CreateClientDraftInput
  ): Promise<CreateClientDraftResult>;
  queueExistingClient(
    input: QueueClientIngestionInput
  ): Promise<QueueClientIngestionResult>;
}
