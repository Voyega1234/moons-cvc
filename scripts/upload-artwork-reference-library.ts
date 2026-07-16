import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ARTWORK_REFERENCE_BUCKET,
  artworkReferencePatterns
} from "../src/server/artwork-generation/artwork-reference-library.js";

const supabaseUrl = requiredEnvironmentVariable("SUPABASE_URL");
const serviceRoleKey = requiredEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const { error: bucketError } = await supabase.storage.createBucket(
  ARTWORK_REFERENCE_BUCKET,
  {
    public: false,
    fileSizeLimit: 20 * 1024 * 1024,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"]
  }
);
if (bucketError && !bucketError.message.toLowerCase().includes("already exists")) {
  throw new Error(bucketError.message);
}

for (const pattern of artworkReferencePatterns) {
  const bytes = await readFile(
    join(process.cwd(), "agent_prompt", "Images", pattern.sourceFile)
  );
  const { error } = await supabase.storage
    .from(ARTWORK_REFERENCE_BUCKET)
    .upload(pattern.storagePath, bytes, {
      contentType: pattern.mimeType,
      upsert: true
    });
  if (error) throw new Error(`${pattern.label}: ${error.message}`);
  console.log(`Uploaded ${pattern.storagePath}`);
}
console.log(`Uploaded ${artworkReferencePatterns.length} artwork references.`);

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
