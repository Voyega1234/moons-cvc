import { describe, expect, it } from "vitest";
import { emailSignInRedirectUrl } from "./auth-provider";

describe("emailSignInRedirectUrl", () => {
  it("keeps local sign-ins on the active development origin", () => {
    expect(
      emailSignInRedirectUrl({
        hostname: "localhost",
        origin: "http://localhost:4173"
      })
    ).toBe("http://localhost:4173");
  });

  it("sends non-local sign-ins to the Moons production URL", () => {
    expect(
      emailSignInRedirectUrl({
        hostname: "moons-cvc-git-feature.vercel.app",
        origin: "https://moons-cvc-git-feature.vercel.app"
      })
    ).toBe("https://moons-cvc.vercel.app/");
  });
});
