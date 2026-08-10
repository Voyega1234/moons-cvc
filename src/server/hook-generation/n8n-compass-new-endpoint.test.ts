import { describe, expect, it, vi } from "vitest";
import { handleN8nCompassNewRequest } from "./n8n-compass-new-endpoint";

describe("n8n Compass New proxy", () => {
  it("posts the original JSON payload to the configured webhook", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ directions: [{ id: "direct-01" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const payload = {
      brand: { id: "sendo", name: "Sendo" },
      brief: { text: "Create a fresh idea" }
    };

    const response = await handleN8nCompassNewRequest({
      request: new Request("https://moons.local/api/n8n-compass-new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }),
      env: {
        N8N_COMPASS_NEW_WEBHOOK_URL: "https://n8n.example/webhook/new"
      },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://n8n.example/webhook/new",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
    );
    expect(await response.json()).toEqual({
      directions: [{ id: "direct-01" }]
    });
  });

  it("does not call n8n when Supabase authentication rejects the request", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/auth/v1/user")) {
        return new Response("Unauthorized", { status: 401 });
      }
      return new Response("[]", { status: 200 });
    });

    const response = await handleN8nCompassNewRequest({
      request: new Request("https://moons.local/api/n8n-compass-new", {
        method: "POST",
        headers: { Authorization: "Bearer invalid", "Content-Type": "application/json" },
        body: "{}"
      }),
      env: {
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
