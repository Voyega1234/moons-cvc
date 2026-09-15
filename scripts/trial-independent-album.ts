import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateIndependentAlbumPanels } from "../src/server/artwork-generation/album-panels.js";

// Local preview only: no workspace mutation or upload to production storage.
const [inputPath, destination] = process.argv.slice(2);
if (!inputPath || !destination) throw new Error("Usage: trial-independent-album.ts <input.json> <output-directory>");
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("OPENROUTER_API_KEY is required.");
const input = JSON.parse(await readFile(inputPath, "utf8"));
const directory = resolve(destination);
await mkdir(directory, { recursive: true });
const basePrompt = await readFile("agent_prompt/agent_image.md", "utf8");
const references = await Promise.all((input.references ?? []).map(async (reference: {
  path: string; mimeType: string; label: string;
}) => ({ bytes: await readFile(reference.path), mimeType: reference.mimeType, label: reference.label })));
let attempt = 0;
const result = await generateIndependentAlbumPanels({
  hook: input.hook, format: input.format, prompt: `${basePrompt}\n\nCAMPAIGN INPUT\n${input.prompt}`,
  artDirection: input.artDirection,
  references, apiKey, model: input.model, runId: "local-album-trial",
  fetchImpl: async (url, options) => {
    const index = ++attempt;
    console.log(`Generating panel ${index}...`);
    const response = await fetch(url, options);
    const payload = await response.clone().json();
    await appendFile(resolve(directory, "usage.jsonl"), JSON.stringify({
      index, status: response.status, usage: payload.usage ?? null
    }) + "\n");
    console.log(`Panel ${index}: HTTP ${response.status}`);
    return response;
  },
  writeDebugLog: async (_directory, entry) => {
    await appendFile(resolve(directory, "requests.jsonl"), JSON.stringify(entry) + "\n");
  }
});
for (const panel of result.panels) await writeFile(resolve(directory, `panel-${panel.index}.png`), panel.bytes);
await writeFile(resolve(directory, "preview.png"), result.masterBytes);
console.log(`Saved ${result.panels.length} panels and preview to ${directory}`);
