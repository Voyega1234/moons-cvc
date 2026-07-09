import { describe, expect, it, vi } from "vitest";
import { handleClientIngestionWorkerRequest } from "./client-ingestion-worker-endpoint";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  APIFY_TOKEN: "apify-token",
  OPENAI_API_KEY: "openai-key",
  CLIENT_INGESTION_WORKER_TOKEN: "worker-token"
};

describe("handleClientIngestionWorkerRequest", () => {
  it("rejects non-POST requests", async () => {
    const response = await handleClientIngestionWorkerRequest({
      request: new Request("https://worker.example.com", {
        method: "GET"
      }),
      env,
      runWorkerOnce: vi.fn()
    });

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Method not allowed."
    });
  });

  it("requires the configured bearer token", async () => {
    const response = await handleClientIngestionWorkerRequest({
      request: new Request("https://worker.example.com", {
        method: "POST",
        headers: {
          Authorization: "Bearer wrong-token"
        }
      }),
      env,
      runWorkerOnce: vi.fn()
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Unauthorized."
    });
  });

  it("runs one worker cycle and returns the result", async () => {
    const runWorkerOnce = vi.fn(async () => ({
      claimed: true as const,
      jobId: "job-1",
      clientId: "client-1",
      result: {
        postsSaved: 1,
        adsSaved: 1,
        visualAssetsMirrored: 2,
        usedFallbackSearch: false,
        completed: true
      }
    }));

    const response = await handleClientIngestionWorkerRequest({
      request: new Request("https://worker.example.com", {
        method: "POST",
        headers: {
          Authorization: "Bearer worker-token"
        }
      }),
      env,
      runWorkerOnce
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      result: {
        claimed: true,
        jobId: "job-1",
        clientId: "client-1",
        result: {
          postsSaved: 1,
          adsSaved: 1,
          visualAssetsMirrored: 2,
          usedFallbackSearch: false,
          completed: true
        }
      }
    });
    expect(runWorkerOnce).toHaveBeenCalledWith({
      env,
      fetchImpl: expect.any(Function)
    });
  });

  it("returns a safe JSON error when the worker fails", async () => {
    const response = await handleClientIngestionWorkerRequest({
      request: new Request("https://worker.example.com", {
        method: "POST",
        headers: {
          Authorization: "Bearer worker-token"
        }
      }),
      env,
      runWorkerOnce: vi.fn(async () => {
        throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");
      })
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: "SUPABASE_SERVICE_ROLE_KEY is required."
    });
  });
});
