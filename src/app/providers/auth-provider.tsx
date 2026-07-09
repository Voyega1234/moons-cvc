import {
  useEffect,
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

export function AuthProvider({ children }: { children: ReactNode }) {
  if (env.dataSource !== "supabase") return children;
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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setError(error.message);
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription }
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [client]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const normalizedEmail = email.trim().toLowerCase();
    const { error } = await client.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo: window.location.origin
      }
    });

    if (error) {
      setError(error.message);
      return;
    }

    setMessage("Check your email for the Moons sign-in link.");
  }

  if (loading) {
    return (
      <main className="boot-loading" aria-live="polite">
        Checking session...
      </main>
    );
  }

  if (session) return children;

  return (
    <main className="boot-auth">
      <form className="auth-card" onSubmit={submit}>
        <p className="eyebrow">Convert Cake only</p>
        <h1>Sign in to Moons</h1>
        <p>Use your Convert Cake email to access production data.</p>
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            placeholder="name@convertcake.com"
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <button className="btn primary" type="submit">
          Send sign-in link
        </button>
        {message ? <p className="auth-message">{message}</p> : null}
        {error ? <p className="auth-error">{error}</p> : null}
      </form>
    </main>
  );
}
