import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode
} from "react";
import type { Session } from "@supabase/supabase-js";
import { env } from "../../config/env";
import {
  getSupabaseClient,
  isSupabaseConfigured
} from "../../lib/supabase/client";

const PRODUCTION_AUTH_REDIRECT_URL = "https://moons-cvc.vercel.app/";
const CONVERT_CAKE_EMAIL_DOMAIN = "@convertcake.com";

interface AuthContextValue {
  enabled: boolean;
  session: Session | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function emailSignInRedirectUrl(
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
  if (!normalized.endsWith(CONVERT_CAKE_EMAIL_DOMAIN)) {
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
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const {
      data: { subscription }
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setLoading(false);
    });

    void client.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) setError(sessionError.message);
      setSession(data.session);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [client]);

  function changeEmail() {
    setLinkSent(false);
    setMessage(null);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setMessage(null);
    setPending(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const emailError = validateConvertCakeEmail(normalizedEmail);
      if (emailError) throw new Error(emailError);
      const wasResend = linkSent;
      const { error: signInError } = await client.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          emailRedirectTo: emailSignInRedirectUrl(),
          shouldCreateUser: true
        }
      });
      if (signInError) throw signInError;
      setEmail(normalizedEmail);
      setLinkSent(true);
      setMessage(
        wasResend
          ? "A new login link is on its way."
          : "Open the secure link in your email to continue."
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Authentication failed.");
    } finally {
      setPending(false);
    }
  }

  const contextValue = useMemo<AuthContextValue>(
    () => ({
      enabled: true,
      session,
      signOut: async () => {
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
        <form className="auth-card" onSubmit={submit}>
          <p className="eyebrow">Convert Cake account</p>
          <h1>{linkSent ? "Check your email" : "Sign in to Compass"}</h1>
          <p>
            {linkSent
              ? "We sent a secure login link to:"
              : "Enter your Convert Cake email. No password required."}
          </p>

          {linkSent ? (
            <div className="auth-email-target">{email}</div>
          ) : (
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                required
                disabled={pending}
                value={email}
                placeholder="name@convertcake.com"
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          )}

          <button className="btn primary" type="submit" disabled={pending}>
            {pending
              ? "Sending…"
              : linkSent
                ? "Resend login link"
                : "Email me a login link"}
          </button>

          {linkSent ? (
            <button
              className="auth-text-button"
              type="button"
              disabled={pending}
              onClick={changeEmail}
            >
              Use a different email
            </button>
          ) : null}

          {message ? <p className="auth-message" role="status">{message}</p> : null}
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
        </form>
      </section>
    </main>
  );
}
