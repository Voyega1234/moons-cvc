import { describe, expect, it } from "vitest";
import {
  shouldRequireAuth,
  validateConvertCakeEmail
} from "./auth-provider";

describe("Supabase Google authentication", () => {
  it("limits authenticated accounts to Convert Cake email addresses", () => {
    expect(validateConvertCakeEmail("designer@convertcake.com")).toBeNull();
    expect(validateConvertCakeEmail("designer@example.com")).toBe(
      "Use your @convertcake.com email."
    );
  });

  it("always requires authentication in production builds", () => {
    expect(
      shouldRequireAuth({ production: true, dataSource: "mock" })
    ).toBe(true);
    expect(
      shouldRequireAuth({ production: false, dataSource: "mock" })
    ).toBe(false);
    expect(
      shouldRequireAuth({ production: false, dataSource: "supabase" })
    ).toBe(true);
  });
});
