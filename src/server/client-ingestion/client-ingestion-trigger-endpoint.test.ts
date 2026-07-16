import { describe, expect, it, vi } from "vitest";
import { handleClientIngestionTriggerRequest } from "./client-ingestion-trigger-endpoint";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  APIFY_TOKEN: "apify-token",
  OPENAI_API_KEY: "openai-key"
};

function authorizedFetch(): typeof fetch {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        email: "designer@convertcake.com",
        app_metadata: {}
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  ) as typeof fetch;
}

describe("handleClientIngestionTriggerRequest", () => {
  it("rejects non-POST requests", async () => {
    const response = await handleClientIngestionTriggerRequest({
      request: new Request("https://example.com/api/trigger", { method: "GET" }),
      env,
      scheduleWorker: vi.fn()
    });

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Method not allowed."
    });
  });

  it("requires Supabase auth configuration before scheduling work", async () => {
    const scheduleWorker = vi.fn();
    const response = await handleClientIngestionTriggerRequest({
      request: new Request("https://example.com/api/trigger", { method: "POST" }),
      env: { ...env, SUPABASE_ANON_KEY: undefined },
      scheduleWorker
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Supabase auth configuration is required."
    });
    expect(scheduleWorker).not.toHaveBeenCalled();
  });

  it("rejects an invalid Supabase access token", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }));
    const response = await handleClientIngestionTriggerRequest({
      request: new Request("https://example.com/api/trigger", {
        method: "POST",
        headers: { Authorization: "Bearer invalid-token" }
      }),
      env,
      fetchImpl,
      scheduleWorker: vi.fn()
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Unauthorized."
    });
  });

  it("validates worker configuration before accepting the task", async () => {
    const scheduleWorker = vi.fn();
    const response = await handleClientIngestionTriggerRequest({
      request: new Request("https://example.com/api/trigger", {
        method: "POST",
        headers: { Authorization: "Bearer valid-token" }
      }),
      env: { ...env, APIFY_TOKEN: undefined },
      fetchImpl: authorizedFetch(),
      scheduleWorker
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: "APIFY_TOKEN is required."
    });
    expect(scheduleWorker).not.toHaveBeenCalled();
  });

  it("accepts an authenticated task and schedules one worker cycle", async () => {
    const scheduled: Promise<unknown>[] = [];
    const runWorkerOnce = vi.fn(async () => ({ claimed: false as const }));
    const response = await handleClientIngestionTriggerRequest({
      request: new Request("https://example.com/api/trigger", {
        method: "POST",
        headers: { Authorization: "Bearer valid-token" }
      }),
      env,
      fetchImpl: authorizedFetch(),
      runWorkerOnce,
      scheduleWorker: (task) => scheduled.push(task)
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, status: "accepted" });
    expect(runWorkerOnce).toHaveBeenCalledWith({
      env,
      fetchImpl: expect.any(Function)
    });
    expect(scheduled).toHaveLength(1);
    await scheduled[0];
  });

  it("awaits the worker on localhost instead of releasing the background task", async () => {
    const events: string[] = [];
    const runWorkerOnce = vi.fn(async () => {
      events.push("started");
      await Promise.resolve();
      events.push("finished");
      return { claimed: false as const };
    });
    const scheduleWorker = vi.fn();

    const response = await handleClientIngestionTriggerRequest({
      request: new Request("http://localhost:3000/api/trigger", {
        method: "POST",
        headers: {
          Authorization: "Bearer valid-token",
          Host: "localhost:3000"
        }
      }),
      env,
      fetchImpl: authorizedFetch(),
      runWorkerOnce,
      scheduleWorker
    });

    expect(response.status).toBe(202);
    expect(events).toEqual(["started", "finished"]);
    expect(scheduleWorker).not.toHaveBeenCalled();
  });
});
