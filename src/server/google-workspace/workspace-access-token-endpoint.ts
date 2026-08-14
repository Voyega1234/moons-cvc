import { resolveConvertCakeAuthorization } from "../shared/convert-cake-auth.js";
import {
  createGoogleWorkspaceAccessToken,
  GOOGLE_DRIVE_READONLY_SCOPE,
  type GoogleWorkspaceAuthEnv
} from "../google-sheets/google-workspace-auth.js";

export interface GoogleWorkspaceAccessTokenEnv extends GoogleWorkspaceAuthEnv {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  GOOGLE_WORKSPACE_LOCAL_USER?: string;
}

export async function handleGoogleWorkspaceAccessTokenRequest({
  request,
  env,
  oidcToken,
  fetchImpl = fetch
}: {
  request: Request;
  env: GoogleWorkspaceAccessTokenEnv;
  oidcToken?: string;
  fetchImpl?: typeof fetch;
}): Promise<Response> {
  if (request.method !== "GET") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }
  try {
    const auth = await resolveConvertCakeAuthorization(request, env, fetchImpl);
    if (!auth.authorized) {
      return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
    }
    const subjectEmail = auth.email ?? env.GOOGLE_WORKSPACE_LOCAL_USER;
    if (!subjectEmail?.trim()) {
      throw new Error("Authenticated user email is required.");
    }
    const accessToken = await createGoogleWorkspaceAccessToken({
      env,
      subjectEmail,
      scopes: [GOOGLE_DRIVE_READONLY_SCOPE],
      oidcToken,
      fetchImpl
    });
    return jsonResponse({ ok: true, accessToken, expiresIn: 3600 });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : "Could not authorize Google Workspace."
    }, 500);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
