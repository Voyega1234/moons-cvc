import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInWithOtp: vi.fn(),
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
      signInWithOtp: authMocks.signInWithOtp,
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
    authMocks.signInWithOtp.mockResolvedValue({ data: {}, error: null });
    authMocks.signOut.mockResolvedValue({ error: null });
  });

  it("emails a passwordless login link to a Convert Cake account", async () => {
    const user = userEvent.setup();
    render(<AuthProvider><div>Private workspace</div></AuthProvider>);

    await user.type(await screen.findByLabelText("Email"), "TEAM@convertcake.com");
    expect(screen.queryByLabelText("Password")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Email me a login link" }));

    expect(authMocks.signInWithOtp).toHaveBeenCalledWith({
      email: "team@convertcake.com",
      options: {
        emailRedirectTo: "http://localhost:3000",
        shouldCreateUser: true
      }
    });
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy();
    expect(screen.getByText("team@convertcake.com")).toBeTruthy();
  });

  it("can resend the link or return to edit the email", async () => {
    const user = userEvent.setup();
    render(<AuthProvider><div>Private workspace</div></AuthProvider>);

    await user.type(await screen.findByLabelText("Email"), "designer@convertcake.com");
    await user.click(screen.getByRole("button", { name: "Email me a login link" }));
    await user.click(await screen.findByRole("button", { name: "Resend login link" }));

    expect(authMocks.signInWithOtp).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("A new login link is on its way.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(await screen.findByLabelText("Email")).toBeTruthy();
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
