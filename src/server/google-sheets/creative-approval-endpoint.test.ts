import { describe, expect, it, vi } from "vitest";
import { handleCreativeApprovalRequest } from "./creative-approval-endpoint";
import { CREATIVE_APPROVAL_DOCUMENT_TITLE } from "../../domain/creative-approval";

const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_ANON_KEY: "anon", OPENROUTER_API_KEY: "model-key", OPENROUTER_BRAND_ANALYSIS_MODEL: "test/vision" };
const sourceUrl = "https://docs.google.com/spreadsheets/d/portal/edit#gid=99";
const context = { version: 1, sourceUrl, sheetTitle: "Creative Approval / Ads Post", sources: [], examples: [] };
const document = { id: "existing-document", title: CREATIVE_APPROVAL_DOCUMENT_TITLE, description: JSON.stringify(context, null, 2) };

function request(body: unknown = { clientId: "brand-1", runId: "run-1", sourceUrl }, headers: Record<string, string> = { Authorization: "Bearer user-token", "X-Google-Access-Token": "google-token" }) {
  return new Request("https://moons.local/api/creative-approval", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}

function dependencies({ accessible = true, existing = [] as typeof document[], writeStatus = 201 } = {}) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: "user-1", email: "creative@convertcake.com" });
    if (url.includes("/rest/v1/clients?")) return Response.json(accessible ? [{ id: "brand-1" }] : []);
    if (url.includes("/rest/v1/brand_library?") && init?.method === "POST") return new Response(null, { status: writeStatus });
    if (url.includes("/rest/v1/brand_library?")) return Response.json(existing);
    if (url.startsWith("https://sheets.googleapis.com/")) return Response.json({ sheets: [] });
    throw new Error(`Unexpected fetch ${url}`);
  });
  return { fetchImpl, analyze: vi.fn().mockResolvedValue([]) };
}

describe("Creative Approval endpoint", () => {
  it("requires authentication and client visibility before reading Google or invoking AI", async () => {
    const deps = dependencies({ accessible: false });
    const result = await handleCreativeApprovalRequest({ request: request(), env, ...deps });
    expect(result.status).toBe(403);
    expect(deps.analyze).not.toHaveBeenCalled();
    expect(deps.fetchImpl.mock.calls).toHaveLength(2);
    const unauthenticated = await handleCreativeApprovalRequest({ request: request(undefined, {}), env, ...dependencies() });
    expect(unauthenticated.status).toBe(401);
  });

  it("preserves RLS on persisted docs and returns the new context for the same run", async () => {
    const deps = dependencies();
    const result = await handleCreativeApprovalRequest({ request: request(), env, ...deps });
    expect(result.status).toBe(200);
    const payload = await result.json();
    expect(payload.document.title).toBe(CREATIVE_APPROVAL_DOCUMENT_TITLE);
    const saved = deps.fetchImpl.mock.calls.find(([, init]) => init?.method === "POST");
    expect(saved?.[1]?.headers).toMatchObject({ Authorization: "Bearer user-token", "Content-Profile": "moons" });
    expect(JSON.parse(String(saved?.[1]?.body))).toMatchObject({ client_id: "brand-1", section: "docs", title: CREATIVE_APPROVAL_DOCUMENT_TITLE });
    expect(JSON.stringify(payload)).not.toContain("google-token");
  });

  it("does not rewrite an unchanged document", async () => {
    const deps = dependencies({ existing: [document] });
    const result = await handleCreativeApprovalRequest({ request: request(), env, ...deps });
    expect(result.status).toBe(200);
    expect(deps.fetchImpl.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("preserves the previous document after an analysis failure and rejects missing Google access", async () => {
    const deps = dependencies({ existing: [document] });
    deps.analyze.mockRejectedValue(new Error("Cannot read artwork"));
    const result = await handleCreativeApprovalRequest({ request: request(), env, ...deps });
    expect(result.status).toBe(502);
    expect(deps.fetchImpl.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    const missingGoogle = await handleCreativeApprovalRequest({ request: request(undefined, { Authorization: "Bearer user-token" }), env, ...dependencies() });
    expect(missingGoogle.status).toBe(403);
  });

  it("rejects invalid sources and never returns success for a failed save", async () => {
    expect((await handleCreativeApprovalRequest({ request: request({ clientId: "brand-1", runId: "run-1", sourceUrl: "https://attacker.test" }), env, ...dependencies() })).status).toBe(400);
    expect((await handleCreativeApprovalRequest({ request: request(), env, ...dependencies({ writeStatus: 403 }) })).status).toBe(502);
  });
});
