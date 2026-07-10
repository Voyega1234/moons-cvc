export interface ConvertCakeAuthEnv {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

export interface ConvertCakeAuthorization {
  authorized: boolean;
  accessToken: string | null;
}

export async function resolveConvertCakeAuthorization(
  request: Request,
  env: ConvertCakeAuthEnv,
  fetchImpl: typeof fetch
): Promise<ConvertCakeAuthorization> {
  const supabaseUrl = env.SUPABASE_URL?.trim();
  const supabaseAnonKey = env.SUPABASE_ANON_KEY?.trim();
  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;

  if (!supabaseUrl || !supabaseAnonKey) return { authorized: true, accessToken };
  if (!accessToken) return { authorized: false, accessToken: null };

  const response = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: authorization
    }
  });

  if (!response.ok) return { authorized: false, accessToken: null };

  const user = (await response.json()) as unknown;
  if (!isRecord(user)) return { authorized: false, accessToken: null };

  const email = typeof user.email === "string" ? user.email : "";
  const metadata = isRecord(user.app_metadata) ? user.app_metadata : {};
  const organization =
    typeof metadata.organization === "string" ? metadata.organization : "";
  const authorized =
    organization === "convert_cake" || email.endsWith("@convertcake.com");

  return { authorized, accessToken: authorized ? accessToken : null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
