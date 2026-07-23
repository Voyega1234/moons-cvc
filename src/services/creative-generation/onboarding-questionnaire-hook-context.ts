import type { OnboardingQuestionnaireSource } from "../../domain/brand";

const HOOK_CONTEXT_FIELD_KEYS = new Set([
  "brand_name_th",
  "brand_name_en",
  "brand_name_pronunciation",
  "brand_description",
  "marketing_challenge",
  "marketing_obstacle",
  "marketing_past_efforts",
  "marketing_additional_context",
  "products_services_and_pricing",
  "products_growth_priority",
  "products_customer_pain_points",
  "products_target_customer",
  "products_unique_selling_points",
  "products_main_competitors",
  "creative_references",
  "creative_restrictions"
]);

export function buildOnboardingQuestionnaireHookContext(
  questionnaire: OnboardingQuestionnaireSource | null | undefined
): string {
  const fields = questionnaire?.extractedFields;
  const context = fields?.length
    ? fields
        .filter((field) => HOOK_CONTEXT_FIELD_KEYS.has(field.key))
        .map(
          (field) =>
            `${field.label} [${field.key}]\n${field.value.trim()}`
        )
        .filter((field) => field.trim())
        .join("\n\n")
    : (questionnaire?.text.trim() ?? "");
  if (!context) return "";

  return [
    "Onboarding questionnaire — historical onboarding context only; not the current campaign brief.",
    context
  ].join("\n\n");
}
