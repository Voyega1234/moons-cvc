import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentGoogleProviderToken } from "../../lib/google-workspace/provider-token";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInWithOAuth: vi.fn(),
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
      signInWithOAuth: authMocks.signInWithOAuth,
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
    authMocks.signInWithOAuth.mockResolvedValue({ data: {}, error: null });
    authMocks.signOut.mockResolvedValue({ error: null });
    window.localStorage.clear();
  });

  it("starts Google OAuth with Drive, Sheets, and Convert Cake domain settings", async () => {
    const user = userEvent.setup();
    render(<AuthProvider><div>Private workspace</div></AuthProvider>);

    const googleButton = await screen.findByRole("button", {
      name: "Continue with Google"
    });
    expect(googleButton.querySelector("img")?.getAttribute("src")).toBe(
      "/google-g.svg"
    );
    await user.click(googleButton);

    expect(authMocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "http://localhost:3000",
        scopes:
          "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets.readonly",
        queryParams: {
          hd: "convertcake.com",
          include_granted_scopes: "true",
          prompt: "consent"
        }
      }
    });
    expect(screen.getByText("Only @convertcake.com accounts")).toBeTruthy();
  });

  it("rejects a restored session outside the Convert Cake domain", async () => {
    authMocks.getSession.mockResolvedValue({
      data: {
        session: {
          access_token: "token",
          user: { email: "outsider@example.com" }
        }
      },
      error: null
    });

    render(<AuthProvider><div>Private workspace</div></AuthProvider>);

    expect(
      await screen.findByText(
        "Creative Compass is available only to @convertcake.com accounts."
      )
    ).toBeTruthy();
    expect(screen.queryByText("Private workspace")).toBeNull();
    await waitFor(() => expect(authMocks.signOut).toHaveBeenCalled());
  });

  it("captures the Google provider token returned after OAuth", async () => {
    render(<AuthProvider><div>Private workspace</div></AuthProvider>);
    await screen.findByRole("button", { name: "Continue with Google" });

    act(() => {
      authMocks.authStateCallback?.("SIGNED_IN", {
        access_token: "supabase-token",
        provider_token: "google-provider-token",
        user: { email: "designer@convertcake.com" }
      });
    });

    expect(await screen.findByText("Private workspace")).toBeTruthy();
    expect(currentGoogleProviderToken()).toBe("google-provider-token");
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
