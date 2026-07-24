import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { Session } from "@supabase/supabase-js";
import { env } from "../../config/env";
import {
  captureGoogleProviderToken,
  clearGoogleProviderToken
} from "../../lib/google-workspace/provider-token";
import {
  getSupabaseClient,
  isSupabaseConfigured
} from "../../lib/supabase/client";

const PRODUCTION_AUTH_REDIRECT_URL = "https://moons-cvc.vercel.app/";
export const GOOGLE_WORKSPACE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets.readonly"
].join(" ");

interface AuthContextValue {
  enabled: boolean;
  session: Session | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function googleSignInRedirectUrl(
  location: Pick<Location, "hostname" | "origin"> = window.location
): string {
  const hostname = location.hostname.toLowerCase();
  return ["localhost", "127.0.0.1", "::1"].includes(hostname)
    ? location.origin
    : PRODUCTION_AUTH_REDIRECT_URL;
}

export function validateConvertCakeEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return "Enter your email address.";
  if (!/^[^@\s]+@convertcake\.com$/.test(normalized)) {
    return "Use your @convertcake.com email.";
  }
  return null;
}

export function shouldRequireAuth({
  production = import.meta.env.PROD,
  dataSource = env.dataSource
}: {
  production?: boolean;
  dataSource?: typeof env.dataSource;
} = {}): boolean {
  return production || dataSource === "supabase";
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!shouldRequireAuth()) {
    return (
      <AuthContext.Provider
        value={{ enabled: false, session: null, signOut: async () => undefined }}
      >
        {children}
      </AuthContext.Provider>
    );
  }
  if (!isSupabaseConfigured()) {
    return (
      <main className="boot-error">
        <h1>Supabase is not configured.</h1>
        <p>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</p>
      </main>
    );
  }

  return <SupabaseAuthGate>{children}</SupabaseAuthGate>;
}

function SupabaseAuthGate({ children }: { children: ReactNode }) {
  const client = getSupabaseClient();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    function applySession(nextSession: Session | null) {
      if (!active) return;
      const email = nextSession?.user.email ?? "";
      const emailError = nextSession ? validateConvertCakeEmail(email) : null;
      if (emailError) {
        clearGoogleProviderToken();
        setSession(null);
        setError("Creative Compass is available only to @convertcake.com accounts.");
        setLoading(false);
        void client.auth.signOut();
        return;
      }
      captureGoogleProviderToken(nextSession);
      setSession(nextSession);
      setLoading(false);
    }

    const {
      data: { subscription }
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      applySession(nextSession);
    });

    void client.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) setError(sessionError.message);
      applySession(data.session);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [client]);

  async function signInWithGoogle() {
    if (pending) return;
    setError(null);
    setPending(true);

    try {
      const { error: signInError } = await client.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: googleSignInRedirectUrl(),
          scopes: GOOGLE_WORKSPACE_OAUTH_SCOPES,
          queryParams: {
            hd: "convertcake.com",
            include_granted_scopes: "true",
            prompt: "consent"
          }
        }
      });
      if (signInError) throw signInError;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Authentication failed.");
      setPending(false);
    }
  }

  const contextValue = useMemo<AuthContextValue>(
    () => ({
      enabled: true,
      session,
      signOut: async () => {
        clearGoogleProviderToken();
        const { error: signOutError } = await client.auth.signOut();
        if (signOutError) throw signOutError;
      }
    }),
    [client, session]
  );

  if (loading) {
    return (
      <main className="boot-loading" aria-live="polite">
        Checking session...
      </main>
    );
  }

  if (session) {
    return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
  }

  return (
    <main className="boot-auth">
      <section className="auth-shell">
        <div className="auth-brand-panel" aria-hidden="true">
          <span className="compass-kicker"><span /> Creative intelligence studio</span>
          <b>Find the idea<br />worth <em>scaling.</em></b>
          <p>One secure account for brand signals, creative decisions, and production memory.</p>
        </div>
        <section className="auth-card">
          <p className="eyebrow">Convert Cake account</p>
          <h1>Sign in to Creative Compass</h1>
          <p>
            Continue with your Convert Cake Google Workspace account.
          </p>

          <button
            className="btn primary auth-google-button"
            type="button"
            disabled={pending}
            onClick={() => void signInWithGoogle()}
          >
            <img src="/google-g.svg" alt="" aria-hidden="true" />
            {pending ? "Connecting to Google..." : "Continue with Google"}
          </button>

          <div className="auth-google-access">
            <b>Only @convertcake.com accounts</b>
            <span>
              Used to create Google Slides in your Drive and read onboarding
              questionnaire Sheets.
            </span>
          </div>

          {error ? <p className="auth-error" role="alert">{error}</p> : null}
        </section>
      </section>
    </main>
  );
}
