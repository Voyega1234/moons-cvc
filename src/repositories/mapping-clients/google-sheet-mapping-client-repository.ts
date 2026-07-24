import { env } from "../../config/env";
import type { OnboardingQuestionnaireSource } from "../../domain/brand";
import {
  getSupabaseClient,
  isSupabaseConfigured
} from "../../lib/supabase/client";
import {
  clearGoogleProviderToken,
  requireGoogleProviderToken
} from "../../lib/google-workspace/provider-token";
import type {
  MappingClient,
  MappingClientListOptions,
  MappingClientRepository
} from "../../ports/mapping-client-repository";

const CACHE_TTL_MS = 5 * 60 * 1000;

export class GoogleSheetMappingClientRepository
  implements MappingClientRepository
{
  private cached:
    | { expiresAt: number; clients: readonly MappingClient[] }
    | null = null;

  constructor(
    private readonly endpoint = `${env.apiBaseUrl}/mapping-clients`,
    private readonly fetchImpl: typeof fetch = (input, init) =>
      fetch(input, init),
    private readonly accessTokenProvider: () => Promise<string | null> =
      currentSupabaseAccessToken,
    private readonly googleAccessTokenProvider: () => string =
      requireGoogleProviderToken
  ) {}

  async list({
    forceRefresh = false
  }: MappingClientListOptions = {}): Promise<readonly MappingClient[]> {
    if (!forceRefresh && this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached.clients;
    }

    const clients = await this.fetchClients();
    this.cached = {
      clients,
      expiresAt: Date.now() + CACHE_TTL_MS
    };
    return clients;
  }

  async readQuestionnaire(
    sheetUrl: string
  ): Promise<OnboardingQuestionnaireSource | null> {
    const accessToken = await this.accessTokenProvider();
    const googleAccessToken = this.googleAccessTokenProvider();
    const separator = this.endpoint.includes("?") ? "&" : "?";
    const url = `${this.endpoint}${separator}questionnaireSheetUrl=${encodeURIComponent(sheetUrl)}`;
    const response = await this.fetchImpl(url, {
      cache: "no-store",
      headers: accessToken
        ? {
            Authorization: `Bearer ${accessToken}`,
            "X-Google-Access-Token": googleAccessToken
          }
        : { "X-Google-Access-Token": googleAccessToken }
    });
    const payload = (await response.json()) as unknown;
    if (!response.ok) {
      const message = mappingSheetError(payload, response.status);
      if (message.startsWith("Google access has expired.")) {
        clearGoogleProviderToken();
      }
      throw new Error(message);
    }
    if (!isRecord(payload) || payload.ok !== true) {
      throw new Error("Questionnaire sheet endpoint returned invalid data.");
    }
    return parseQuestionnaire(payload.questionnaire);
  }

  private async fetchClients(): Promise<readonly MappingClient[]> {
    const accessToken = await this.accessTokenProvider();
    const response = await this.fetchImpl(this.endpoint, {
      cache: "no-store",
      headers: accessToken
        ? { Authorization: `Bearer ${accessToken}` }
        : undefined
    });
    const payload = (await response.json()) as unknown;
    if (!response.ok) {
      throw new Error(mappingSheetError(payload, response.status));
    }
    if (
      !isRecord(payload) ||
      payload.ok !== true ||
      !Array.isArray(payload.clients)
    ) {
      throw new Error("Mapping sheet endpoint returned invalid data.");
    }

    return payload.clients.map(parseMappingClient);
  }
}

async function currentSupabaseAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw error;
  return data.session?.access_token ?? null;
}

function parseMappingClient(value: unknown): MappingClient {
  if (!isRecord(value)) {
    throw new Error("Mapping sheet endpoint returned an invalid client.");
  }
  const clientId = readString(value.clientId, "clientId");
  const status = readString(value.status, "status", true);
  const serviceStatus = readString(
    value.serviceStatus,
    "serviceStatus",
    true
  );
  const clientPortalUrl =
    value.clientPortalUrl === undefined
      ? undefined
      : readString(value.clientPortalUrl, "clientPortalUrl");

  return {
    clientId,
    status,
    serviceStatus,
    ...(clientPortalUrl ? { clientPortalUrl } : {})
  };
}

function parseQuestionnaire(
  value: unknown
): OnboardingQuestionnaireSource | null {
  if (value === null) return null;
  const extractedFields =
    isRecord(value) && value.extractedFields !== undefined
      ? parseExtractedFields(value.extractedFields)
      : undefined;
  if (
    !isRecord(value) ||
    typeof value.text !== "string" ||
    typeof value.preview !== "string" ||
    !Array.isArray(value.facebookUrls) ||
    !value.facebookUrls.every((url) => typeof url === "string") ||
    (value.sourceUrl !== undefined && typeof value.sourceUrl !== "string") ||
    (value.sheetTitle !== undefined && typeof value.sheetTitle !== "string") ||
    extractedFields === null
  ) {
    throw new Error("Questionnaire sheet endpoint returned invalid data.");
  }

  return {
    ...(value.sourceUrl ? { sourceUrl: value.sourceUrl } : {}),
    text: value.text,
    preview: value.preview,
    facebookUrls: value.facebookUrls,
    ...(value.sheetTitle ? { sheetTitle: value.sheetTitle } : {}),
    ...(extractedFields ? { extractedFields } : {})
  };
}

function parseExtractedFields(
  value: unknown
): OnboardingQuestionnaireSource["extractedFields"] | null {
  if (!Array.isArray(value)) return null;
  const fields = value.map((field) => {
    if (
      !isRecord(field) ||
      typeof field.key !== "string" ||
      typeof field.label !== "string" ||
      typeof field.value !== "string"
    ) {
      return null;
    }
    return {
      key: field.key,
      label: field.label,
      value: field.value
    };
  });
  return fields.every((field) => field !== null)
    ? (fields as NonNullable<
        OnboardingQuestionnaireSource["extractedFields"]
      >)
    : null;
}

function readString(
  value: unknown,
  field: string,
  allowEmpty = false
): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new Error(`Mapping sheet client ${field} is invalid.`);
  }
  return value.trim();
}

function mappingSheetError(payload: unknown, status: number): string {
  return isRecord(payload) && typeof payload.error === "string"
    ? payload.error
    : `Mapping sheet failed: ${status}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
