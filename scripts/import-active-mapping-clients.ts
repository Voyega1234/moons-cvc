import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types.js";
import { createGoogleSheetsAccessToken } from "../src/server/google-sheets/google-workspace-auth.js";
import { readMappingClientsFromGoogleSheet } from "../src/server/google-sheets/mapping-client-sheet.js";
import { planActiveMappingClientImports } from "../src/services/clients/plan-mapping-client-import.js";

const apply = process.argv.includes("--apply");
const unexpectedArguments = process.argv.slice(2).filter((value) => value !== "--apply");
if (unexpectedArguments.length) {
  throw new Error(`Unknown arguments: ${unexpectedArguments.join(", ")}`);
}

const supabase = createClient<Database>(
  requiredEnvironmentVariable("SUPABASE_URL"),
  requiredEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } }
);
const googleWorkspaceUser = requiredEnvironmentVariable(
  "GOOGLE_WORKSPACE_LOCAL_USER"
);
const googleSheetsAccessToken = await createGoogleSheetsAccessToken({
  env: {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_APPLICATION_CREDENTIALS:
      process.env.GOOGLE_APPLICATION_CREDENTIALS
  },
  subjectEmail: googleWorkspaceUser
});
const { clients: mappingClients } = await readMappingClientsFromGoogleSheet({
  sheetUrl: requiredEnvironmentVariable("MAPPING_CLIENTS_GOOGLE_SHEET_URL"),
  accessToken: googleSheetsAccessToken
});
if (!mappingClients.length) {
  throw new Error("The mapping Google Sheet returned no clients; import aborted.");
}

const existingClients = await listExistingClients();
const plannedRows = planActiveMappingClientImports(
  mappingClients,
  existingClients
);

console.log(
  JSON.stringify(
    {
      mode: apply ? "apply" : "dry-run",
      mappingClients: mappingClients.length,
      activeMappingClients: mappingClients.filter(
        (client) => client.status.trim().toLowerCase() === "active"
      ).length,
      existingSupabaseClients: existingClients.length,
      clientsToInsert: plannedRows.length,
      preview: plannedRows.map((row) => ({
        id: row.id,
        name: row.name,
        hasFacebookUrl: Boolean(row.facebook_url)
      }))
    },
    null,
    2
  )
);

if (!apply || !plannedRows.length) process.exit(0);

for (let index = 0; index < plannedRows.length; index += 100) {
  const batch = plannedRows.slice(index, index + 100);
  const { error } = await supabase.schema("moons").from("clients").insert(batch);
  if (error) throw new Error(`Client import failed: ${error.message}`);
}

const remainingRows = planActiveMappingClientImports(
  mappingClients,
  await listExistingClients()
);
if (remainingRows.length) {
  throw new Error(
    `Import verification failed: ${remainingRows.length} active clients remain missing.`
  );
}

console.log(`Imported and verified ${plannedRows.length} active mapping clients.`);

async function listExistingClients(): Promise<
  Array<{ id: string; name: string }>
> {
  const clients: Array<{ id: string; name: string }> = [];

  for (let from = 0; ; from += 1_000) {
    const { data, error } = await supabase
      .schema("moons")
      .from("clients")
      .select("id,name")
      .order("name")
      .range(from, from + 999);
    if (error) throw new Error(`Could not read clients: ${error.message}`);
    clients.push(...data);
    if (data.length < 1_000) return clients;
  }
}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
