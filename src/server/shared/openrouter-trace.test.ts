import { describe, expect, it } from "vitest";
import { openRouterTraceEnvironment } from "./openrouter-trace";

describe("openRouterTraceEnvironment", () => {
  it("reports production only when VERCEL_ENV is production", () => {
    const original = process.env.VERCEL_ENV;
    try {
      process.env.VERCEL_ENV = "production";
      expect(openRouterTraceEnvironment()).toBe("production");

      process.env.VERCEL_ENV = "preview";
      expect(openRouterTraceEnvironment()).toBe("develop");

      delete process.env.VERCEL_ENV;
      expect(openRouterTraceEnvironment()).toBe("develop");
    } finally {
      if (original === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = original;
    }
  });
});
