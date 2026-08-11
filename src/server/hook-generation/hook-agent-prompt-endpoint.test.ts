import { describe, expect, it, vi } from "vitest";
import { handleHookAgentPromptRequest } from "./hook-agent-prompt-endpoint";

describe("hook agent prompt endpoint", () => {
  it("returns the source prompt for an authorized local request", async () => {
    const response = await handleHookAgentPromptRequest({
      request: new Request("https://moons.local/api/hook-agent-prompt"),
      env: {}
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { prompt?: string };
    expect(payload.prompt).toContain("Senior Creative Strategist");
  });

  it("rejects requests that are not authorized", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ email: "outside@example.com" }), {
        status: 200
      })
    );
    const response = await handleHookAgentPromptRequest({
      request: new Request("https://moons.local/api/hook-agent-prompt", {
        headers: { Authorization: "Bearer token" }
      }),
      env: {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl
    });

    expect(response.status).toBe(401);
  });
});
