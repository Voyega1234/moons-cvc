import { expect, it, vi } from "vitest";
import sharp from "sharp";
import { handleMaterialAi, sanitizeMatch } from "./material-ai-endpoint";

const env = { SUPABASE_URL: "https://supabase.example.com", SUPABASE_ANON_KEY: "anon", OPENROUTER_API_KEY: "router-key" };
const req = (body: unknown, token = "session") => new Request("https://moons.local/api/material-ai", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) });
function fetchReturning(payload: unknown, capture?: (body: any) => void) {
  return vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (String(url).endsWith("/auth/v1/user")) return Response.json({ email: "team@convertcake.com" });
    capture?.(JSON.parse(String(init?.body)));
    return Response.json({ output_text: JSON.stringify(payload) });
  });
}

it("sanitizeMatch drops unknown ids, dedupes and caps picks per hook", () => {
  const result = sanitizeMatch({ assignments: [
    { hookId: "h1", materialIds: ["a", "a", "b", "c", "d", "ghost"] },
    { hookId: "h1", materialIds: ["a"] },
    { hookId: "nope", materialIds: ["a"] }
  ] }, new Set(["h1", "h2"]), new Set(["a", "b", "c", "d"]));
  expect(result).toEqual({ assignments: [{ hookId: "h1", materialIds: ["a", "b", "c"] }] });
});

it("labels the actual material bytes with Luna through OpenRouter", async () => {
  const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: "white" } }).png().toBuffer();
  const download = vi.fn().mockResolvedValue({ data: { arrayBuffer: async () => bytes }, error: null });
  let body: any;
  const storagePath = "client-1/asset-library/material/abc-bottle.png";
  const response = await handleMaterialAi({ request: req({ action: "label", storagePath }), env,
    fetchImpl: fetchReturning({ label: "Blue serum bottle" }, (b) => (body = b)),
    createStorageClient: () => ({ storage: { from: () => ({ download }) } }) as never });
  expect(await response.json()).toMatchObject({ ok: true, label: "Blue serum bottle" });
  expect(download).toHaveBeenCalledExactlyOnceWith(storagePath);
  expect(body.model).toBe("openai/gpt-5.6-luna");
  expect(body.input[0].content[1].image_url).toMatch(/^data:image\/jpeg;base64,/);
});

it.each(["https://example.com/a.png", "client/asset-library/reference/a.png", "client/asset-library/material/../x.png"])("rejects out-of-scope storage path %s", async (storagePath) => {
  const createStorageClient = vi.fn();
  const response = await handleMaterialAi({ request: req({ action: "label", storagePath }), env, fetchImpl: fetchReturning({}), createStorageClient });
  expect(response.status).toBe(400);
  expect(createStorageClient).not.toHaveBeenCalled();
});

it("matches ideas to labeled materials and ignores ids Luna invents", async () => {
  let body: any;
  const response = await handleMaterialAi({
    request: req({ action: "match", hooks: [{ id: "h1", hook: "Glow fast", concept: "serum" }], materials: [{ id: "m1", label: "Blue serum bottle", folder: "Products / Serum" }, { id: "m2", label: "Smiling person" }] }),
    env, fetchImpl: fetchReturning({ assignments: [{ hookId: "h1", materialIds: ["m1", "ghost"] }] }, (b) => (body = b)) });
  expect(await response.json()).toMatchObject({ ok: true, assignments: [{ hookId: "h1", materialIds: ["m1"] }] });
  expect(body.input[0].content[0].text).toContain("Blue serum bottle");
  expect(body.input[0].content[0].text).toContain("Products / Serum");
});

it("skips the paid model when there is nothing to match", async () => {
  const fetchImpl = fetchReturning({});
  const response = await handleMaterialAi({ request: req({ action: "match", hooks: [{ id: "h1", hook: "x", concept: "y" }], materials: [] }), env, fetchImpl });
  expect(await response.json()).toMatchObject({ ok: true, assignments: [] });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it("requires a signed-in team member", async () => {
  const fetchImpl = vi.fn<typeof fetch>();
  const response = await handleMaterialAi({ request: req({ action: "match" }, ""), env, fetchImpl });
  expect(response.status).toBe(401);
  expect(fetchImpl).not.toHaveBeenCalled();
});
