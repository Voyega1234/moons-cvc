import { createHash } from "node:crypto";
import { CREATIVE_APPROVAL_DOCUMENT_TITLE, isCreativeApprovalVisualStyle, type CreativeApprovalContext } from "../../domain/creative-approval.js";
import type { LibraryItem } from "../../domain/brand.js";
import { validateQuestionnaireGoogleSheetUrl } from "../../domain/client-ingestion.js";
import { analyzeCreativeApproval } from "../client-ingestion/creative-approval-analyzer.js";
import { createAiUsageTrackingFetch } from "../shared/ai-usage-recorder.js";
import { resolveConvertCakeAuthorization } from "../shared/convert-cake-auth.js";
import { readCreativeApprovalSheet } from "./creative-approval-sheet.js";

export interface CreativeApprovalEndpointEnv {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_BRAND_ANALYSIS_MODEL?: string;
  OPENROUTER_TERRA_MODEL?: string;
}

export async function handleCreativeApprovalRequest({ request, env, fetchImpl = fetch, analyze = analyzeCreativeApproval }: {
  request: Request;
  env: CreativeApprovalEndpointEnv;
  fetchImpl?: typeof fetch;
  analyze?: typeof analyzeCreativeApproval;
}): Promise<Response> {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_ANON_KEY?.trim()) return json({ ok: false, error: "Supabase auth configuration is required." }, 503);
  try {
    const auth = await resolveConvertCakeAuthorization(request, env, fetchImpl);
    if (!auth.authorized || !auth.accessToken || !auth.userId) return json({ ok: false, error: "Unauthorized." }, 401);
    const input = await request.json() as { clientId?: unknown; runId?: unknown; sourceUrl?: unknown };
    if (!input || typeof input.clientId !== "string" || !/^[\w-]{1,100}$/.test(input.clientId) || typeof input.runId !== "string" || !input.runId.trim() || input.runId.length > 100 || typeof input.sourceUrl !== "string" || !input.sourceUrl.trim() || validateQuestionnaireGoogleSheetUrl(input.sourceUrl)) return json({ ok: false, error: "Invalid Creative Approval source." }, 400);
    const clientId = input.clientId;
    const headers = {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${auth.accessToken}`,
      "Accept-Profile": "moons",
      "Content-Profile": "moons",
      "Content-Type": "application/json"
    };
    const rest = `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;
    // Use the user's token, not the service role: private-client RLS applies to reads and writes.
    const clients = await databaseRead(`${rest}/clients?id=eq.${encodeURIComponent(clientId)}&select=id&limit=1`, headers, fetchImpl);
    if (!Array.isArray(clients) || !clients.length) return json({ ok: false, error: "Client is not accessible." }, 403);
    const googleAccessToken = request.headers.get("x-google-access-token")?.trim();
    if (!googleAccessToken) return json({ ok: false, error: "Reconnect Google to read Creative Approval and artwork files." }, 403);
    const existing = await databaseRead(`${rest}/brand_library?client_id=eq.${encodeURIComponent(clientId)}&section=eq.docs&title=eq.${encodeURIComponent(CREATIVE_APPROVAL_DOCUMENT_TITLE)}&select=id,title,description&order=created_at.desc&limit=1`, headers, fetchImpl) as LibraryItem[];
    const document = existing[0];
    const cached = readCachedContext(document?.description);
    const sheet = await readCreativeApprovalSheet({ sheetUrl: input.sourceUrl, accessToken: googleAccessToken, fetchImpl });
    const examples = await analyze({
      rows: sheet.rows,
      cached: cached?.sourceUrl === sheet.sourceUrl ? cached : undefined,
      googleAccessToken,
      apiKey: env.OPENROUTER_API_KEY?.trim() ?? "",
      model: env.OPENROUTER_BRAND_ANALYSIS_MODEL?.trim() || env.OPENROUTER_TERRA_MODEL?.trim() || "",
      fetchImpl: createAiUsageTrackingFetch({ fetchImpl, context: {
        supabaseUrl: env.SUPABASE_URL, supabaseAnonKey: env.SUPABASE_ANON_KEY,
        accessToken: auth.accessToken, ownerUserId: auth.userId, clientId,
        workspaceRunId: input.runId, operation: "hook-generation"
      } })
    });
    const context: CreativeApprovalContext = { version: 1, sourceUrl: sheet.sourceUrl, sheetTitle: sheet.sheetTitle, sources: sheet.sources, examples };
    const description = JSON.stringify(context, null, 2);
    if (document?.description === description) return json({ ok: true, document, exampleCount: examples.length });
    const nextDocument = { id: document?.id ?? documentId(clientId), title: CREATIVE_APPROVAL_DOCUMENT_TITLE, description };
    const saved = await fetchImpl(`${rest}/brand_library?on_conflict=id`, {
      method: "POST", headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ ...nextDocument, client_id: clientId, section: "docs", sort_order: 100 })
    });
    if (!saved.ok) throw new Error(`Could not save Creative Approval context: HTTP ${saved.status}`);
    return json({ ok: true, document: nextDocument, exampleCount: examples.length });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Could not import Creative Approval." }, 502);
  }
}

function readCachedContext(description: string | undefined): CreativeApprovalContext | undefined {
  try {
    const value = JSON.parse(description ?? "") as CreativeApprovalContext;
    if (value.version === 1 && typeof value.sourceUrl === "string" && Array.isArray(value.examples) && value.examples.every(example => isCreativeApprovalVisualStyle(example.visualStyle) && typeof example.fingerprint === "string" && typeof example.headline === "string" && typeof example.cta === "string" && [example.supportingCopy, example.styleObservations, example.uncertainties].every(list => Array.isArray(list) && list.every(item => typeof item === "string")))) return value;
  } catch { /* Old or user-edited documents are re-extracted rather than trusted as a cache. */ }
  return undefined;
}

async function databaseRead(url: string, headers: Record<string, string>, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Could not read brand context: HTTP ${response.status}`);
  return response.json();
}

function documentId(clientId: string): string {
  const hash = createHash("sha256").update(`creative-approval:${clientId}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
