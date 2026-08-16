import { describe, expect, it } from "vitest";
import { toWebRequest } from "./google-slides";

describe("google-slides Vercel adapter", () => {
  it("preserves the JSON body and authorization header", async () => {
    const request = toWebRequest({
      method: "POST",
      headers: { authorization: "Bearer supabase-token" },
      body: { action: "initialize", name: "Client deck", size: 42 }
    });

    expect(request.headers.get("authorization")).toBe("Bearer supabase-token");
    expect(await request.json()).toEqual({
      action: "initialize",
      name: "Client deck",
      size: 42
    });
  });
});
