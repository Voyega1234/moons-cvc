import type { Brand, QuestionnaireExtractedField } from "./brand";

export const CLIENT_CATEGORY_MAX_LENGTH = 80;
export const ONBOARDING_QUESTIONNAIRE_MAX_LENGTH = 12_000;

export interface CreateClientDraftInput {
  name: string;
  facebookUrl: string;
  category?: string;
  questionnaire: QuestionnaireIntakeSource;
}

export interface QuestionnaireIntakeSource {
  sourceUrl?: string;
  text: string;
  sheetTitle?: string;
  extractedFields?: readonly QuestionnaireExtractedField[];
}

export interface CreateClientDraftResult {
  brand: Brand;
  jobId: string;
}

export interface QueueClientIngestionInput {
  clientId: string;
  facebookUrl: string;
  questionnaire: QuestionnaireIntakeSource;
}

export interface QueueClientIngestionResult {
  jobId: string;
}

export function validateFacebookUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Facebook URL is required.";

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "Enter a valid Facebook URL.";
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  return hostname === "facebook.com" || hostname === "fb.com"
    ? null
    : "Enter a Facebook page URL.";
}

export function validateClientCategory(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= CLIENT_CATEGORY_MAX_LENGTH && !/[\r\n]/.test(trimmed)
    ? null
    : `Use a short category label (${CLIENT_CATEGORY_MAX_LENGTH} characters or fewer).`;
}

export function validateOnboardingQuestionnaire(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Onboarding questionnaire is required.";
  return trimmed.length <= ONBOARDING_QUESTIONNAIRE_MAX_LENGTH
    ? null
    : `Keep the onboarding questionnaire within ${ONBOARDING_QUESTIONNAIRE_MAX_LENGTH.toLocaleString()} characters.`;
}

export function validateQuestionnaireGoogleSheetUrl(
  value: string
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Questionnaire Google Sheet URL is required.";

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "Enter a valid Google Sheet URL.";
  }

  const match = parsed.pathname.match(/^\/spreadsheets\/d\/([^/]+)/);
  return parsed.hostname === "docs.google.com" &&
    match?.[1] &&
    match[1] !== "e"
    ? null
    : "Use a normal docs.google.com spreadsheet URL.";
}

export function initialsFromClientName(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  return initials || "CL";
}
