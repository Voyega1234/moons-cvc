// One-off backend backfill: GPT Luna labels existing brand Materials that have no ai_label.
// Dry run by default. Usage:
//   npm run materials:label -- --list                          (unlabeled count per client, read-only)
//   npm run materials:label -- --client "glass skin"            (shows what would be labeled)
//   npm run materials:label -- --client "glass skin" --apply    (labels and saves)
//   npm run materials:label -- --all --apply                    (every client; only unlabeled rows)
// Requires migration 202611240001_brand_asset_ai_label.sql to be applied first.
import { createClient } from "@supabase/supabase-js";
import { labelMaterialImage } from "../src/server/material-ai/material-ai-endpoint";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1]; };
const clientQuery = flag("client");
const listOnly = args.includes("--list");
const apply = args.includes("--apply");
const allClients = args.includes("--all");
if (!clientQuery && !listOnly && !allClients) throw new Error('Pass --client "<name>", --all, or --list.');

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENROUTER_API_KEY) throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and OPENROUTER_API_KEY are required.");
const bucket = process.env.BRAND_ASSETS_BUCKET || process.env.VITE_BRAND_ASSETS_BUCKET || "brand-assets";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const db = supabase.schema("moons");

if (listOnly) {
  const all: { data: { client_id: string; ai_label: string | null }[] } = { data: [] };
  for (let from = 0; ; from += 1000) { // Supabase caps a response at 1000 rows
    const page = await db.from("brand_assets").select("client_id,ai_label").eq("asset_kind", "material").order("id").range(from, from + 999);
    if (page.error) throw new Error(`brand_assets: ${page.error.message}`);
    all.data.push(...page.data);
    if (page.data.length < 1000) break;
  }
  const names = await db.from("clients").select("id,name");
  if (names.error) throw new Error(`clients: ${names.error.message}`);
  const nameOf = new Map(names.data.map((c) => [c.id, c.name]));
  const counts = new Map<string, { total: number; unlabeled: number }>();
  for (const row of all.data) {
    const c = counts.get(row.client_id) ?? { total: 0, unlabeled: 0 };
    c.total++; if (!row.ai_label) c.unlabeled++;
    counts.set(row.client_id, c);
  }
  for (const [id, c] of [...counts].sort((a, b) => b[1].unlabeled - a[1].unlabeled)) console.log(`${String(c.unlabeled).padStart(4)} unlabeled / ${String(c.total).padStart(4)} materials  ${nameOf.get(id) ?? id}`);
  process.exit(0);
}

let todo: { id: string; name: string; storage_path: string }[] = [];
if (allClients) {
  for (let from = 0; ; from += 1000) { // Supabase caps a response at 1000 rows
    const page = await db.from("brand_assets").select("id,name,storage_path").eq("asset_kind", "material").is("ai_label", null).order("id").range(from, from + 999);
    if (page.error) throw new Error(`brand_assets: ${page.error.message}`);
    todo.push(...page.data);
    if (page.data.length < 1000) break;
  }
  console.log(`All clients: ${todo.length} materials without a label.`);
} else {
  const clients = await db.from("clients").select("id,name").ilike("name", `%${clientQuery!}%`);
  if (clients.error) throw new Error(`clients: ${clients.error.message}`);
  if (clients.data.length !== 1) throw new Error(`Expected exactly one client for "${clientQuery}", found: ${clients.data.map((c) => c.name).join(", ") || "none"}.`);
  const client = clients.data[0]!;
  const assets = await db.from("brand_assets").select("id,name,storage_path,ai_label").eq("client_id", client.id).eq("asset_kind", "material");
  if (assets.error) throw new Error(`brand_assets: ${assets.error.message}`);
  todo = assets.data.filter((a) => !a.ai_label);
  console.log(`${client.name}: ${assets.data.length} materials, ${todo.length} without a label.`);
}
if (!apply) { console.log("Dry run. Add --apply to label them."); process.exit(0); }

let done = 0, failed = 0, next = 0;
await Promise.all(Array.from({ length: Math.min(4, todo.length) }, async () => {
  while (next < todo.length) {
    const asset = todo[next++]!;
    try {
      const file = await supabase.storage.from(bucket).download(asset.storage_path);
      if (file.error || !file.data) throw new Error(file.error?.message ?? "download failed");
      const label = await labelMaterialImage({ fetchImpl: fetch, apiKey: OPENROUTER_API_KEY, image: Buffer.from(await file.data.arrayBuffer()) });
      const saved = await db.from("brand_assets").update({ ai_label: label }).eq("id", asset.id);
      if (saved.error) throw new Error(saved.error.message);
      done++; console.log(`✓ ${asset.name} → ${label}`);
    } catch (caught) { failed++; console.warn(`✗ ${asset.name}: ${caught instanceof Error ? caught.message : caught}`); }
  }
}));
console.log(`Done: ${done} labeled, ${failed} failed.`);
