import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withCreativeApprovalContext } from "./creative-approval-context";
import { env } from "../../config/env";
import { requireGoogleProviderToken } from "../../lib/google-workspace/provider-token";
import { CREATIVE_APPROVAL_DOCUMENT_TITLE } from "../../domain/creative-approval";
import type { Brand } from "../../domain/brand";

vi.mock("../../config/env", () => ({ env: { dataSource: "supabase", apiBaseUrl: "/api" } }));
vi.mock("../../lib/supabase/client", () => ({ getSupabaseClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "user-token" } }, error: null }) } }) }));
vi.mock("../../lib/google-workspace/provider-token", () => ({ requireGoogleProviderToken: vi.fn().mockResolvedValue("google-token"), clearGoogleProviderToken: vi.fn() }));
const sourceUrl = "https://docs.google.com/spreadsheets/d/portal/edit";
const brand: Brand = { id: "brand-1", name: "Brand", category: "", initials: "B", mappingClientPortalUrl: sourceUrl, memory: { working: [], avoid: [] }, library: { brand: [], products: [], refs: [], docs: [{ id: "brief", title: "Brief", description: "Keep this" }] } };
const document = { id: "style", title: CREATIVE_APPROVAL_DOCUMENT_TITLE, description: "Extracted image copy" };

beforeEach(() => { vi.clearAllMocks(); env.dataSource = "supabase"; });
afterEach(() => vi.unstubAllGlobals());

describe("Hook Creative Approval context", () => {
  it("injects the persisted style doc while preserving other docs and the original brand", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ ok: true, document }));
    vi.stubGlobal("fetch", fetchImpl);
    const result = await withCreativeApprovalContext(brand, "run-1");
    expect(result?.library.docs).toEqual([...brand.library.docs, document]);
    expect(brand.library.docs).toHaveLength(1);
    expect(JSON.parse(fetchImpl.mock.calls[0]?.[1].body)).toEqual({ clientId: "brand-1", runId: "run-1", sourceUrl });
  });

  it("shares an in-flight image import across model comparisons", async () => {
    let release: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { release = resolve; })));
    const first = withCreativeApprovalContext(brand, "run-1");
    const second = withCreativeApprovalContext(brand, "run-1");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    release(Response.json({ ok: true, document }));
    await Promise.all([first, second]);
    expect(requireGoogleProviderToken).toHaveBeenCalledTimes(1);
  });

  it("leaves mock workspaces and brands without a valid portal unchanged", async () => {
    env.dataSource = "mock";
    expect(await withCreativeApprovalContext(brand, "run-1")).toBe(brand);
    env.dataSource = "supabase";
    expect((await withCreativeApprovalContext({ ...brand, mappingClientPortalUrl: undefined }, "run-1"))?.library).toEqual(brand.library);
    expect(requireGoogleProviderToken).not.toHaveBeenCalled();
  });

  it("reports optional sync failures to the caller without modifying existing brand context", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: false, error: "Reconnect Google" }, { status: 403 })));
    await expect(withCreativeApprovalContext(brand, "run-1")).rejects.toThrow("Reconnect Google");
    expect(brand.library.docs).toEqual([{ id: "brief", title: "Brief", description: "Keep this" }]);
  });
});
