import { GoogleAuth } from "google-auth-library";

const CLOUD_PLATFORM_SCOPE =
  "https://www.googleapis.com/auth/cloud-platform";
export const GOOGLE_SHEETS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/spreadsheets.readonly";
export const GOOGLE_DRIVE_FILE_SCOPE =
  "https://www.googleapis.com/auth/drive.file";
export const GOOGLE_DRIVE_READONLY_SCOPE =
  "https://www.googleapis.com/auth/drive.readonly";
const GOOGLE_STS_ENDPOINT = "https://sts.googleapis.com/v1/token";
const GOOGLE_OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export interface GoogleWorkspaceAuthEnv {
  VERCEL_ENV?: string;
  GOOGLE_CLOUD_PROJECT_NUMBER?: string;
  GOOGLE_WORKLOAD_IDENTITY_POOL?: string;
  GOOGLE_WORKLOAD_IDENTITY_PROVIDER?: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_APPLICATION_CREDENTIALS?: string;
}

export interface GoogleSheetsAccessTokenOptions {
  env: GoogleWorkspaceAuthEnv;
  subjectEmail: string;
  oidcToken?: string;
  fetchImpl?: typeof fetch;
  adcAccessTokenProvider?: () => Promise<string>;
  now?: () => number;
}

export async function createGoogleSheetsAccessToken({
  ...options
}: GoogleSheetsAccessTokenOptions): Promise<string> {
  return createGoogleWorkspaceAccessToken({
    ...options,
    scopes: [GOOGLE_SHEETS_READONLY_SCOPE]
  });
}

export interface GoogleWorkspaceAccessTokenOptions
  extends GoogleSheetsAccessTokenOptions {
  scopes: readonly string[];
}

export async function createGoogleWorkspaceAccessToken({
  env,
  subjectEmail,
  scopes,
  oidcToken,
  fetchImpl = fetch,
  adcAccessTokenProvider = defaultAdcAccessToken,
  now = Date.now
}: GoogleWorkspaceAccessTokenOptions): Promise<string> {
  const delegatedSubject = normalizeConvertCakeEmail(subjectEmail);
  const normalizedScopes = normalizeScopes(scopes);
  if (!isVercelDeployment(env.VERCEL_ENV)) {
    return localAdcAccessToken(env, normalizedScopes, adcAccessTokenProvider);
  }

  const serviceAccountEmail = required(
    env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    "GOOGLE_SERVICE_ACCOUNT_EMAIL"
  );
  const cloudAccessToken = await exchangeVercelOidcToken({
    env,
    oidcToken: required(oidcToken, "Vercel OIDC token"),
    fetchImpl
  });
  const issuedAt = Math.floor(now() / 1000);
  const signedJwt = await signDomainWideDelegationJwt({
    serviceAccountEmail,
    subjectEmail: delegatedSubject,
    scopes: normalizedScopes,
    cloudAccessToken,
    issuedAt,
    fetchImpl
  });

  return exchangeSignedJwt(signedJwt, fetchImpl);
}

async function exchangeVercelOidcToken({
  env,
  oidcToken,
  fetchImpl
}: {
  env: GoogleWorkspaceAuthEnv;
  oidcToken: string;
  fetchImpl: typeof fetch;
}): Promise<string> {
  const projectNumber = required(
    env.GOOGLE_CLOUD_PROJECT_NUMBER,
    "GOOGLE_CLOUD_PROJECT_NUMBER"
  );
  const pool = required(
    env.GOOGLE_WORKLOAD_IDENTITY_POOL,
    "GOOGLE_WORKLOAD_IDENTITY_POOL"
  );
  const provider = required(
    env.GOOGLE_WORKLOAD_IDENTITY_PROVIDER,
    "GOOGLE_WORKLOAD_IDENTITY_PROVIDER"
  );
  const audience =
    `//iam.googleapis.com/projects/${projectNumber}` +
    `/locations/global/workloadIdentityPools/${pool}/providers/${provider}`;
  const response = await fetchImpl(GOOGLE_STS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience,
      scope: CLOUD_PLATFORM_SCOPE,
      requested_token_type:
        "urn:ietf:params:oauth:token-type:access_token",
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      subject_token: oidcToken
    })
  });

  return accessTokenFromResponse(response, "Google workload identity exchange");
}

async function localAdcAccessToken(
  env: GoogleWorkspaceAuthEnv,
  scopes: readonly string[],
  provider: () => Promise<string>
): Promise<string> {
  if (env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
    throw new Error(
      "Local Google auth must use user ADC. Unset GOOGLE_APPLICATION_CREDENTIALS."
    );
  }
  return required(
    provider === defaultAdcAccessToken
      ? await defaultAdcAccessToken(scopes)
      : await provider(),
    "Application Default Credentials token"
  );
}

async function defaultAdcAccessToken(
  scopes: readonly string[] = [GOOGLE_SHEETS_READONLY_SCOPE]
): Promise<string> {
  const auth = new GoogleAuth({ scopes: [...scopes] });
  const client = await auth.getClient();
  const result = await client.getAccessToken();
  const token = typeof result === "string" ? result : result.token;
  return required(token ?? undefined, "Application Default Credentials token");
}

async function signDomainWideDelegationJwt({
  serviceAccountEmail,
  subjectEmail,
  scopes,
  cloudAccessToken,
  issuedAt,
  fetchImpl
}: {
  serviceAccountEmail: string;
  subjectEmail: string;
  scopes: readonly string[];
  cloudAccessToken: string;
  issuedAt: number;
  fetchImpl: typeof fetch;
}): Promise<string> {
  const response = await fetchImpl(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(serviceAccountEmail)}:signJwt`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cloudAccessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        payload: JSON.stringify({
          iss: serviceAccountEmail,
          sub: subjectEmail,
          scope: scopes.join(" "),
          aud: GOOGLE_OAUTH_TOKEN_ENDPOINT,
          iat: issuedAt,
          exp: issuedAt + 3600
        })
      })
    }
  );
  const body = await jsonRecord(response, "Google IAM signJwt");
  const signedJwt = body.signedJwt;
  if (typeof signedJwt !== "string" || !signedJwt.trim()) {
    throw new Error("Google IAM signJwt did not return a signed JWT.");
  }
  return signedJwt;
}

async function exchangeSignedJwt(
  signedJwt: string,
  fetchImpl: typeof fetch
): Promise<string> {
  const response = await fetchImpl(GOOGLE_OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signedJwt
    })
  });
  return accessTokenFromResponse(response, "Google Workspace token exchange");
}

async function accessTokenFromResponse(
  response: Response,
  label: string
): Promise<string> {
  const body = await jsonRecord(response, label);
  const token = body.access_token;
  if (typeof token !== "string" || !token.trim()) {
    throw new Error(`${label} did not return an access token.`);
  }
  return token;
}

async function jsonRecord(
  response: Response,
  label: string
): Promise<Record<string, unknown>> {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${label} returned ${response.status} with invalid JSON.`);
  }
  if (!response.ok) {
    const message =
      isRecord(body) && typeof body.error_description === "string"
        ? body.error_description
        : isRecord(body) && typeof body.error === "string"
          ? body.error
          : isRecord(body) &&
              isRecord(body.error) &&
              typeof body.error.message === "string"
            ? body.error.message
            : `HTTP ${response.status}`;
    throw new Error(`${label} failed: ${message}`);
  }
  if (!isRecord(body)) throw new Error(`${label} returned invalid JSON.`);
  return body;
}

function normalizeConvertCakeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^@\s]+@convertcake\.com$/.test(email)) {
    throw new Error("Google Sheets access requires a @convertcake.com user.");
  }
  return email;
}

function normalizeScopes(scopes: readonly string[]): string[] {
  const normalized = [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))];
  if (!normalized.length) throw new Error("At least one Google Workspace scope is required.");
  return normalized;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
