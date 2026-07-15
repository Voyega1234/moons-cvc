import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  authStateCallback: null as null | ((event: string, session: unknown) => void)
}));

vi.mock("../../config/env", () => ({
  env: { dataSource: "supabase" }
}));

vi.mock("../../lib/supabase/client", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({
    auth: {
      getSession: authMocks.getSession,
      signInWithPassword: authMocks.signInWithPassword,
      signUp: authMocks.signUp,
      resetPasswordForEmail: authMocks.resetPasswordForEmail,
      updateUser: authMocks.updateUser,
      signOut: authMocks.signOut,
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        authMocks.authStateCallback = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }
    }
  })
}));

import { AuthProvider, useAuth } from "./auth-provider";

describe("Supabase account flow", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.authStateCallback = null;
    authMocks.getSession.mockResolvedValue({
      data: { session: null },
      error: null
    });
    authMocks.signInWithPassword.mockResolvedValue({ error: null });
    authMocks.signUp.mockResolvedValue({ data: { session: null }, error: null });
    authMocks.resetPasswordForEmail.mockResolvedValue({ error: null });
    authMocks.updateUser.mockResolvedValue({ error: null });
    authMocks.signOut.mockResolvedValue({ error: null });
  });

  it("signs in with an email and password", async () => {
    const user = userEvent.setup();
    render(<AuthProvider><div>Private workspace</div></AuthProvider>);

    await user.type(await screen.findByLabelText("Email"), "TEAM@convertcake.com");
    await user.type(screen.getByLabelText("Password"), "secure-pass");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(authMocks.signInWithPassword).toHaveBeenCalledWith({
      email: "team@convertcake.com",
      password: "secure-pass"
    });
  });

  it("creates a confirmed-email account contract for Convert Cake", async () => {
    const user = userEvent.setup();
    render(<AuthProvider><div>Private workspace</div></AuthProvider>);

    await user.click(await screen.findByRole("button", { name: "Create account" }));
    await user.type(screen.getByLabelText("Email"), "designer@convertcake.com");
    await user.type(screen.getByLabelText("Password"), "secure-pass");
    await user.type(screen.getByLabelText("Confirm password"), "secure-pass");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(authMocks.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "designer@convertcake.com",
        password: "secure-pass"
      })
    );
    expect(await screen.findByText("Account created. Check your email to confirm it.")).toBeTruthy();
  });

  it("restores a session and exposes sign out to the account UI", async () => {
    authMocks.getSession.mockResolvedValue({
      data: {
        session: {
          access_token: "token",
          user: { email: "team@convertcake.com" }
        }
      },
      error: null
    });

    function PrivateView() {
      const { signOut } = useAuth();
      return <button onClick={() => void signOut()}>Sign out test</button>;
    }

    const user = userEvent.setup();
    render(<AuthProvider><PrivateView /></AuthProvider>);
    await user.click(await screen.findByRole("button", { name: "Sign out test" }));

    await waitFor(() => expect(authMocks.signOut).toHaveBeenCalledOnce());
  });
});
