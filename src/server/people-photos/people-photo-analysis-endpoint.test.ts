import { expect, it, vi } from "vitest";
import sharp from "sharp";
import { handlePeoplePhotoAnalysis } from "./people-photo-analysis-endpoint";
import { peoplePhotoPath } from "../../domain/people-photos";
import type { ArtworkStorageClient } from "../artwork-generation/artwork-generation-types";

const env = { SUPABASE_URL: "https://supabase.example.com", SUPABASE_ANON_KEY: "anon", OPENROUTER_API_KEY: "router-key", GEMINI_API_KEY: "native-key" };
const labels = { description: "Person seated at desk", tags: ["desk", "seated"], apparentAgeBand: "25-34" };
function request(path: string, token = "session") { return new Request("https://moons.local/api/people-photo-analysis", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify({ path }) }); }

it.each(["openrouter", "gemini"] as const)("labels actual image bytes through %s without guessing gender or changing the photo", async (provider) => {
  const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: "white" } }).png().toBuffer();
  const download = vi.fn().mockResolvedValue({ data: { arrayBuffer: async () => bytes }, error: null });
  const storage = { storage: { from: () => ({ download }) } } as unknown as ArtworkStorageClient;
  let providerBody: any;
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (String(url).endsWith("/auth/v1/user")) return Response.json({ email: "team@convertcake.com" });
    providerBody = JSON.parse(String(init?.body));
    return Response.json(provider === "gemini"
      ? { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(labels) }] } }] }
      : { output_text: JSON.stringify(labels) });
  });
  const path = peoplePhotoPath("Portrait", "image/png");
  const response = await handlePeoplePhotoAnalysis({ request: request(path), env: { ...env, GEMINI_API_PROVIDER: provider, ...(provider === "gemini" ? { PEOPLE_PHOTO_LABEL_MODEL: "gemini-3.8-flash" } : {}) }, fetchImpl, createStorageClient: () => storage });
  expect(await response.json()).toMatchObject({ ok: true, analysis: labels });
  expect(download).toHaveBeenCalledExactlyOnceWith(path);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  const text = provider === "gemini" ? providerBody.contents[0].parts[0].text : providerBody.input[0].content[0].text;
  expect(text).toContain("must not be guessed");
  expect(text).toContain("visual estimate, never actual age");
  if (provider === "gemini") {
    expect(providerBody.contents[0].parts[1].inlineData.mimeType).toBe("image/jpeg");
    expect(providerBody.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
  } else {
    expect(providerBody.model).toBe("openai/gpt-5.6-luna");
    expect(providerBody.reasoning).toEqual({ effort: "none" });
    expect(providerBody.input[0].content[1].image_url).toMatch(/^data:image\/jpeg;base64,/);
    expect(providerBody.text.format.schema.properties).not.toHaveProperty("gender");
    expect(providerBody.text.format.schema.properties.tags).not.toHaveProperty("maxItems");
  }
});

it.each(["https://example.com/photo.jpg", "other-folder/photo.jpg", "shared-people-photos/../secret.jpg"])("rejects out-of-scope image paths %s before reading storage", async (path) => {
  const createStorageClient = vi.fn();
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ email: "team@convertcake.com" }));
  const response = await handlePeoplePhotoAnalysis({ request: request(path), env, fetchImpl, createStorageClient });
  expect(response.status).toBe(400);
  expect(createStorageClient).not.toHaveBeenCalled();
});

it("requires a signed-in team member before accessing photos or the paid model", async () => {
  const fetchImpl = vi.fn<typeof fetch>();
  const createStorageClient = vi.fn();
  const response = await handlePeoplePhotoAnalysis({ request: request("shared-people-photos/photo.jpg", ""), env, fetchImpl, createStorageClient });
  expect(response.status).toBe(401);
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(createStorageClient).not.toHaveBeenCalled();
});

it("does not retry a spend-cap rejection", async () => {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url).endsWith("/auth/v1/user") ? Response.json({ email: "team@convertcake.com" }) : Response.json({ error: "Spend cap" }, { status: 403 }));
  const response = await handlePeoplePhotoAnalysis({ request: request(peoplePhotoPath("Test", "image/png")), env, fetchImpl,
    createStorageClient: () => ({ storage: { from: () => ({ download: async () => ({ data: { arrayBuffer: async () => bytes }, error: null }) }) } }) as unknown as ArtworkStorageClient });
  expect(response.status).toBe(500);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("keeps Luna on OpenRouter when the Gemini switch uses native Google", async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ email: "team@convertcake.com" }));
  const createStorageClient = vi.fn();
  const response = await handlePeoplePhotoAnalysis({ request: request("shared-people-photos/photo.jpg"),
    env: { ...env, GEMINI_API_PROVIDER: "gemini", OPENROUTER_API_KEY: "" }, fetchImpl, createStorageClient });
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ error: "OPENROUTER_API_KEY is required." });
  expect(createStorageClient).not.toHaveBeenCalled();
});
