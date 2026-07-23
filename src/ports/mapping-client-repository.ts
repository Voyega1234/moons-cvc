import type { OnboardingQuestionnaireSource } from "../domain/brand";

export interface MappingClient {
  clientId: string;
  status: string;
  serviceStatus: string;
  clientPortalUrl?: string;
}

export interface MappingClientRepository {
  list(): Promise<readonly MappingClient[]>;
  readQuestionnaire?(
    sheetUrl: string
  ): Promise<OnboardingQuestionnaireSource | null>;
}
