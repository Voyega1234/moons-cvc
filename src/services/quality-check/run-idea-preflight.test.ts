import { afterEach, describe, expect, it, vi } from "vitest";
import { runIdeaPreflight, type IdeaPreflightRequest } from "./run-idea-preflight";

vi.mock("../../config/env", () => ({ env: { ideaPreflightEndpoint: "/api/idea-preflight" } }));
vi.mock("../../lib/supabase/client", () => ({
  getSupabaseClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "user-token" } } }) } })
}));

afterEach(() => vi.unstubAllGlobals());

function request(count = 1): IdeaPreflightRequest {
  return { runId: "run", brief: "Campaign", brandContext: null, checks: ["quality", "spelling"],
    directions: Array.from({ length: count }, (_, index) => ({
      id: `idea-${index}`, service: "single-static", hook: "Headline", subheadline: "", concept: "Concept",
      visual: "", cta: "Contact", caption: "Caption", formatBeats: [], revisionFeedback: ""
    })) };
}

function success(input: IdeaPreflightRequest): Response {
  return new Response(JSON.stringify({ results: input.directions.map(direction => ({ directionId: direction.id, findings: [] })) }));
}

describe("runIdeaPreflight", () => {
  it("checks small batches with at most two requests in flight, preserving every idea and its context", async () => {
    const input = request(8);
    let active = 0;
    let peak = 0;
    const fetchImpl = vi.fn(async (_url, init: RequestInit) => {
      active += 1;
      peak = Math.max(peak, active);
      const batch = JSON.parse(String(init.body)) as IdeaPreflightRequest;
      expect(batch.directions.length).toBeLessThanOrEqual(3);
      expect(batch.checks).toEqual(input.checks);
      expect(batch.brief).toBe(input.brief);
      expect(init.headers).toMatchObject({ Authorization: "Bearer user-token" });
      await Promise.resolve();
      active -= 1;
      return success(batch);
    });
    vi.stubGlobal("fetch", fetchImpl);
    const results = await runIdeaPreflight(input);
    expect(peak).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(results.map(result => result.directionId)).toEqual(input.directions.map(direction => direction.id));
  });

  it.each([500, 502, 503, 504])("recovers automatically from a non-JSON gateway response (HTTP %s)", async status => {
    const input = request();
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("<html>Gateway error</html>", { status }))
      .mockResolvedValueOnce(success(input));
    vi.stubGlobal("fetch", fetchImpl);
    expect(await runIdeaPreflight(input)).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries only the failed batch, without replaying a completed batch", async () => {
    const attempts = new Map<string, number>();
    vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
      const batch = JSON.parse(String(init.body)) as IdeaPreflightRequest;
      const id = batch.directions[0]!.id;
      const attempt = (attempts.get(id) ?? 0) + 1;
      attempts.set(id, attempt);
      if (id === "idea-3" && attempt === 1) return new Response("Bad gateway", { status: 502 });
      return success(batch);
    }));
    expect(await runIdeaPreflight(request(6))).toHaveLength(6);
    expect([...attempts.entries()]).toEqual([["idea-0", 1], ["idea-3", 2]]);
  });

  it("stops after one gateway retry and keeps a failed check distinct from a clean result", async () => {
    const fetchImpl = vi.fn(async () => new Response("Runtime timeout", { status: 504 }));
    vi.stubGlobal("fetch", fetchImpl);
    await expect(runIdeaPreflight(request())).rejects.toThrow("กรุณาลองตรวจอีกครั้ง");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("recovers from a temporary network failure", async () => {
    const input = request();
    const fetchImpl = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(success(input));
    vi.stubGlobal("fetch", fetchImpl);
    expect(await runIdeaPreflight(input)).toHaveLength(1);
  });

  it.each([401, 403, 400])("does not replay a JSON rejection (HTTP %s)", async status => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "Unauthorized or invalid request" }), { status }));
    vi.stubGlobal("fetch", fetchImpl);
    await expect(runIdeaPreflight(request())).rejects.toThrow("Unauthorized or invalid request");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(["<html>Missing API</html>", "", "null", '{"results":[]}', '{"results":[null]}'])("does not treat an incomplete response as a successful check: %s", async body => {
    const fetchImpl = vi.fn(async () => new Response(body));
    vi.stubGlobal("fetch", fetchImpl);
    await expect(runIdeaPreflight(request())).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});


it("shows an actionable message when provider recovery is exhausted, preserving server diagnostics as the cause", async () => {
  const diagnostic = "GPT Luna idea preflight returned a non-JSON response.";
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: diagnostic }), { status: 500 }));
  vi.stubGlobal("fetch", fetchImpl);
  const error = await runIdeaPreflight(request()).catch(error => error);
  expect(error.message).toContain("กรุณาลองตรวจอีกครั้ง");
  expect(error.message).not.toContain("non-JSON");
  expect(error.cause).toBe(diagnostic);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
