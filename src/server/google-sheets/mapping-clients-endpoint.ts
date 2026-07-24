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

export interface MappingClientsEndpointEnv
  extends GoogleWorkspaceAuthEnv {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  MAPPING_CLIENTS_GOOGLE_SHEET_URL?: string;
  GOOGLE_WORKSPACE_LOCAL_USER?: string;
}

export interface MappingClientsEndpointOptions {
  request: Request;
  env: MappingClientsEndpointEnv;
  oidcToken?: string;
  fetchImpl?: typeof fetch;
  createSheetsAccessToken?: typeof createGoogleSheetsAccessToken;
}

export async function handleMappingClientsRequest({
  request,
  env,
  oidcToken,
  fetchImpl = fetch,
  createSheetsAccessToken = createGoogleSheetsAccessToken
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
      const questionnaire = await readOnboardingQuestionnaireFromGoogleSheet({
        sheetUrl: questionnaireSheetUrl,
        fetchImpl
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
    return jsonResponse(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not read the Google Sheet."
      },
      500
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
