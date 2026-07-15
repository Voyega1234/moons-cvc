import { describe, expect, it } from "vitest";
import {
  emailSignInRedirectUrl,
  passwordResetRedirectUrl,
  validateAccountPassword,
  validateConvertCakeEmail
} from "./auth-provider";

describe("emailSignInRedirectUrl", () => {
  it("keeps local sign-ins on the active development origin", () => {
    expect(
      emailSignInRedirectUrl({
        hostname: "localhost",
        origin: "http://localhost:4173"
      })
    ).toBe("http://localhost:4173");
  });

  it("keeps non-local sign-ins on the existing production URL", () => {
    expect(
      emailSignInRedirectUrl({
        hostname: "moons-cvc-git-feature.vercel.app",
        origin: "https://moons-cvc-git-feature.vercel.app"
      })
    ).toBe("https://moons-cvc.vercel.app/");
  });

  it("builds a dedicated password recovery return URL", () => {
    expect(
      passwordResetRedirectUrl({
        hostname: "localhost",
        origin: "http://localhost:4173"
      })
    ).toBe("http://localhost:4173/?reset-password=1");
  });

  it("limits new accounts to Convert Cake email addresses", () => {
    expect(validateConvertCakeEmail("designer@convertcake.com")).toBeNull();
    expect(validateConvertCakeEmail("designer@example.com")).toBe(
      "Create accounts with a @convertcake.com email."
    );
  });

  it("requires an eight-character account password", () => {
    expect(validateAccountPassword("short")).toBe(
      "Password must be at least 8 characters."
    );
    expect(validateAccountPassword("long-enough")).toBeNull();
  });

});
