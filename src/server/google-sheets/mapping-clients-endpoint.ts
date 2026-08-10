import { resolveConvertCakeAuthorization } from "../shared/convert-cake-auth.js";
import {
  createGoogleSheetsAccessToken,
  type GoogleWorkspaceAuthEnv
} from "./google-workspace-auth.js";
import {
  isPublishedGoogleSheetUrl,
  readMappingClientsFromGoogleSheet,
  readOnboardingQuestionnaireFromGoogleSheet
} from "./mapping-client-sheet.js";
import { reviewQuestionnaireExtractionWithLuna } from "./questionnaire-extraction-qc-agent.js";

export interface MappingClientsEndpointEnv
  extends GoogleWorkspaceAuthEnv {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  MAPPING_CLIENTS_GOOGLE_SHEET_URL?: string;
  GOOGLE_WORKSPACE_LOCAL_USER?: string;
  OPENAI_API_KEY?: string;
  OPENAI_QUESTIONNAIRE_QC_MODEL?: string;
}

export interface MappingClientsEndpointOptions {
  request: Request;
  env: MappingClientsEndpointEnv;
  oidcToken?: string;
  fetchImpl?: typeof fetch;
  createSheetsAccessToken?: typeof createGoogleSheetsAccessToken;
  reviewQuestionnaireExtraction?: typeof reviewQuestionnaireExtractionWithLuna;
}

export async function handleMappingClientsRequest({
  request,
  env,
  oidcToken,
  fetchImpl = fetch,
  createSheetsAccessToken = createGoogleSheetsAccessToken,
  reviewQuestionnaireExtraction = reviewQuestionnaireExtractionWithLuna
}: MappingClientsEndpointOptions): Promise<Response> {
  if (request.method !== "GET") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  try {
    const auth = await resolveConvertCakeAuthorization(request, env, fetchImpl);
    if (!auth.authorized) {
      return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
    }
    const questionnaireSheetUrl = new URL(request.url).searchParams.get(
      "questionnaireSheetUrl"
    );
    if (questionnaireSheetUrl) {
      const googleAccessToken = request.headers
        .get("x-google-access-token")
        ?.trim();
      if (!googleAccessToken) {
        return jsonResponse(
          {
            ok: false,
            error:
              "Google access is required. Try again to renew it automatically."
          },
          403
        );
      }
      const openAiApiKey = required(
        env.OPENAI_API_KEY,
        "OPENAI_API_KEY for questionnaire QC"
      );
      const questionnaire = await readOnboardingQuestionnaireFromGoogleSheet({
        sheetUrl: questionnaireSheetUrl,
        accessToken: googleAccessToken,
        fetchImpl,
        reviewExtraction: ({ rows, extractedFields }) =>
          reviewQuestionnaireExtraction({
            rows,
            extractedFields,
            apiKey: openAiApiKey,
            model: env.OPENAI_QUESTIONNAIRE_QC_MODEL,
            fetchImpl
          })
      });
      return jsonResponse({ ok: true, questionnaire });
    }

    const sheetUrl = required(
      env.MAPPING_CLIENTS_GOOGLE_SHEET_URL,
      "MAPPING_CLIENTS_GOOGLE_SHEET_URL"
    );
    const accessToken = isPublishedGoogleSheetUrl(sheetUrl)
      ? ""
      : await createSheetsAccessToken({
          env,
          subjectEmail: resolveSubjectEmail(auth.email, env),
          oidcToken,
          fetchImpl
        });
    const result = await readMappingClientsFromGoogleSheet({
      sheetUrl,
      accessToken,
      fetchImpl
    });

    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not read the Google Sheet.";
    return jsonResponse(
      {
        ok: false,
        error: message
      },
      message.startsWith("Google access has expired.") ? 401 : 500
    );
  }
}

function resolveSubjectEmail(
  authenticatedEmail: string | null,
  env: MappingClientsEndpointEnv
): string {
  if (isVercelDeployment(env.VERCEL_ENV)) {
    if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_ANON_KEY?.trim()) {
      throw new Error("Supabase auth configuration is required.");
    }
    return required(authenticatedEmail ?? undefined, "Authenticated user email");
  }

  return required(
    authenticatedEmail ?? env.GOOGLE_WORKSPACE_LOCAL_USER,
    "GOOGLE_WORKSPACE_LOCAL_USER"
  );
}

function isVercelDeployment(value: string | undefined): boolean {
  const environment = value?.trim().toLowerCase();
  return environment === "production" || environment === "preview";
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}
