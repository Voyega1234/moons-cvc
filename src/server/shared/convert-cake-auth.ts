export interface ConvertCakeAuthEnv {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

export interface ConvertCakeAuthorization {
  authorized: boolean;
  accessToken: string | null;
  email: string | null;
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

  if (!supabaseUrl || !supabaseAnonKey) {
    return { authorized: true, accessToken, email: null };
  }
  if (!accessToken) {
    return { authorized: false, accessToken: null, email: null };
  }

  const response = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: authorization
    }
  });

  if (!response.ok) {
    return { authorized: false, accessToken: null, email: null };
  }

  const user = (await response.json()) as unknown;
  if (!isRecord(user)) {
    return { authorized: false, accessToken: null, email: null };
  }

  const email =
    typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
  const authorized = /^[^@\s]+@convertcake\.com$/.test(email);

  return {
    authorized,
    accessToken: authorized ? accessToken : null,
    email: authorized ? email : null
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
