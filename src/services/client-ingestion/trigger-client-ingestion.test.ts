import { describe, expect, it, vi } from "vitest";
import { triggerClientIngestion } from "./trigger-client-ingestion";

describe("triggerClientIngestion", () => {
  it("starts ingestion with the signed-in user's access token", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, status: "accepted" }), {
        status: 202,
        headers: { "Content-Type": "application/json" }
      })
    );

    await triggerClientIngestion({
      accessToken: "access-token",
      endpoint: "/api/trigger-client-ingestion",
      fetchImpl: fetchImpl as typeof fetch
    });

    expect(fetchImpl).toHaveBeenCalledWith("/api/trigger-client-ingestion", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer access-token"
      }
    });
  });

  it("surfaces the API error when the task cannot start", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: "APIFY_TOKEN is required." }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(
      triggerClientIngestion({
        accessToken: "access-token",
        endpoint: "/api/trigger-client-ingestion",
        fetchImpl: fetchImpl as typeof fetch
      })
    ).rejects.toThrow("APIFY_TOKEN is required.");
  });

  it("returns a safe error for an invalid response", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("upstream gateway error", { status: 502 })
    );

    await expect(
      triggerClientIngestion({
        endpoint: "/api/trigger-client-ingestion",
        fetchImpl: fetchImpl as typeof fetch
      })
    ).rejects.toThrow("Client ingestion trigger returned a non-JSON response.");
  });

  it("explains how to start the local API when the request cannot connect", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(
      triggerClientIngestion({
        endpoint: "/api/trigger-client-ingestion",
        fetchImpl: fetchImpl as typeof fetch
      })
    ).rejects.toThrow(
      "Could not reach the client ingestion API (Failed to fetch). For local development, start Compass with npm run dev:full."
    );
  });
});
