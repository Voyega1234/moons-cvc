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

type AuthMode = "sign-in" | "sign-up" | "forgot-password" | "reset-password";

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

export function passwordResetRedirectUrl(
  location: Pick<Location, "hostname" | "origin"> = window.location
): string {
  const redirect = new URL(emailSignInRedirectUrl(location));
  redirect.searchParams.set("reset-password", "1");
  return redirect.toString();
}

export function validateConvertCakeEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return "Enter your email address.";
  if (!normalized.endsWith(CONVERT_CAKE_EMAIL_DOMAIN)) {
    return "Create accounts with a @convertcake.com email.";
  }
  return null;
}

export function validateAccountPassword(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  return null;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (env.dataSource !== "supabase") {
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
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    let active = true;

    const {
      data: { subscription }
    } = client.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY") {
        setPasswordRecovery(true);
        setMode("reset-password");
      }
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

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setPassword("");
    setConfirmPassword("");
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
      if (mode === "forgot-password") {
        const normalizedEmail = email.trim().toLowerCase();
        const emailError = validateConvertCakeEmail(normalizedEmail);
        if (emailError) throw new Error(emailError);
        const { error: resetError } = await client.auth.resetPasswordForEmail(
          normalizedEmail,
          { redirectTo: passwordResetRedirectUrl() }
        );
        if (resetError) throw resetError;
        setMessage("Check your email for the password reset link.");
        return;
      }

      if (mode === "reset-password") {
        const passwordError = validateAccountPassword(password);
        if (passwordError) throw new Error(passwordError);
        if (password !== confirmPassword) {
          throw new Error("Passwords do not match.");
        }
        const { error: updateError } = await client.auth.updateUser({ password });
        if (updateError) throw updateError;
        setPasswordRecovery(false);
        setMode("sign-in");
        setPassword("");
        setConfirmPassword("");
        return;
      }

      const normalizedEmail = email.trim().toLowerCase();
      const emailError = validateConvertCakeEmail(normalizedEmail);
      if (emailError) throw new Error(emailError);
      const passwordError = validateAccountPassword(password);
      if (passwordError) throw new Error(passwordError);

      if (mode === "sign-up") {
        if (password !== confirmPassword) {
          throw new Error("Passwords do not match.");
        }
        const { data, error: signUpError } = await client.auth.signUp({
          email: normalizedEmail,
          password,
          options: { emailRedirectTo: emailSignInRedirectUrl() }
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setMessage("Account created. Check your email to confirm it.");
        }
        return;
      }

      const { error: signInError } = await client.auth.signInWithPassword({
        email: normalizedEmail,
        password
      });
      if (signInError) throw signInError;
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

  if (session && !passwordRecovery) {
    return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
  }

  const title =
    mode === "sign-up"
      ? "Create your Neo account"
      : mode === "forgot-password"
        ? "Reset your password"
        : mode === "reset-password"
          ? "Choose a new password"
          : "Sign in to Neo";
  const description =
    mode === "sign-up"
      ? "Use your Convert Cake email to create an account."
      : mode === "forgot-password"
        ? "We’ll email you a secure password reset link."
        : mode === "reset-password"
          ? "Use at least 8 characters for your new password."
          : "Enter your email and password to access production data.";

  return (
    <main className="boot-auth">
      <section className="auth-shell">
        <div className="auth-brand-panel" aria-hidden="true">
          <span className="neo-kicker"><span /> Creative intelligence studio</span>
          <b>Find the idea<br />worth <em>scaling.</em></b>
          <p>One secure account for brand signals, creative decisions, and production memory.</p>
        </div>
        <form className="auth-card" onSubmit={submit}>
          <p className="eyebrow">Convert Cake account</p>
          <h1>{title}</h1>
          <p>{description}</p>

          {mode !== "reset-password" ? (
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
          ) : null}

          {mode === "sign-in" || mode === "sign-up" || mode === "reset-password" ? (
            <label>
              Password
              <input
                type="password"
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                required
                minLength={8}
                disabled={pending}
                value={password}
                placeholder="At least 8 characters"
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          ) : null}

          {mode === "sign-up" || mode === "reset-password" ? (
            <label>
              Confirm password
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                disabled={pending}
                value={confirmPassword}
                placeholder="Enter it again"
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
          ) : null}

          <button className="btn primary" type="submit" disabled={pending}>
            {pending
              ? "Please wait…"
              : mode === "sign-up"
                ? "Create account"
                : mode === "forgot-password"
                  ? "Send reset link"
                  : mode === "reset-password"
                    ? "Save new password"
                    : "Sign in"}
          </button>

          {mode === "sign-in" ? (
            <button
              className="auth-text-button"
              type="button"
              disabled={pending}
              onClick={() => changeMode("forgot-password")}
            >
              Forgot password?
            </button>
          ) : null}

          {message ? <p className="auth-message" role="status">{message}</p> : null}
          {error ? <p className="auth-error" role="alert">{error}</p> : null}

          {mode !== "reset-password" ? (
            <div className="auth-mode-switch">
              <span>{mode === "sign-up" ? "Already have an account?" : "New to Neo?"}</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => changeMode(mode === "sign-up" ? "sign-in" : "sign-up")}
              >
                {mode === "sign-up" ? "Sign in" : "Create account"}
              </button>
            </div>
          ) : null}
        </form>
      </section>
    </main>
  );
}
