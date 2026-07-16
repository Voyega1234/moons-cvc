import type { QuestionnaireBrandSource } from "../domain/brand";

export interface MappingClient {
  clientId: string;
  status: string;
  serviceStatus: string;
  questionnaire?: QuestionnaireBrandSource;
}

export interface MappingClientRepository {
  list(): Promise<readonly MappingClient[]>;
}
