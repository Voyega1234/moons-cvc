import type { OnboardingQuestionnaireSource } from "../domain/brand";

export interface MappingClient {
  clientId: string;
  status: string;
  serviceStatus: string;
  clientPortalUrl?: string;
}

export interface MappingClientListOptions {
  forceRefresh?: boolean;
}

export interface MappingClientRepository {
  list(
    options?: MappingClientListOptions
  ): Promise<readonly MappingClient[]>;
  readQuestionnaire?(
    sheetUrl: string
  ): Promise<OnboardingQuestionnaireSource | null>;
}
