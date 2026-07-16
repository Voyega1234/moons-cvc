import { describe, expect, it } from "vitest";
import {
  emailSignInRedirectUrl,
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

  it("limits passwordless accounts to Convert Cake email addresses", () => {
    expect(validateConvertCakeEmail("designer@convertcake.com")).toBeNull();
    expect(validateConvertCakeEmail("designer@example.com")).toBe(
      "Use your @convertcake.com email."
    );
  });

});
