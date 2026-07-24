import { beforeEach, describe, expect, it } from "vitest";
import {
  captureGoogleProviderToken,
  clearGoogleProviderToken,
  currentGoogleProviderToken,
  requireGoogleProviderToken
} from "./provider-token";

describe("Google Workspace provider token", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps a freshly returned Supabase provider token for Google API calls", () => {
    captureGoogleProviderToken({ provider_token: "google-token" }, 1_000);

    expect(currentGoogleProviderToken(2_000)).toBe("google-token");
  });

  it("clears an expired provider token", () => {
    captureGoogleProviderToken({ provider_token: "google-token" }, 1_000);

    expect(currentGoogleProviderToken(60 * 60 * 1000)).toBeNull();
  });

  it("removes Google access on sign out and returns an actionable error", () => {
    captureGoogleProviderToken({ provider_token: "google-token" });
    clearGoogleProviderToken();

    expect(() => requireGoogleProviderToken()).toThrow(
      "Sign out, then sign in with Google again."
    );
  });
});
