import { env } from "../../config/env";
import type { Brand, LibraryItem } from "../../domain/brand";
import { CREATIVE_APPROVAL_DOCUMENT_TITLE, creativeApprovalSourceUrl } from "../../domain/creative-approval";
import { requireGoogleProviderToken, clearGoogleProviderToken } from "../../lib/google-workspace/provider-token";
import { getSupabaseClient } from "../../lib/supabase/client";

// Model comparisons and concurrent runs share the import, not duplicate vision requests.
const pending = new Map<string, Promise<LibraryItem>>();

export async function withCreativeApprovalContext(brand: Brand | null, runId: string): Promise<Brand | null> {
  if (env.dataSource !== "supabase" || !brand) return brand;
  const sourceUrl = creativeApprovalSourceUrl(brand);
  if (!sourceUrl) return brand;
  const key = `${brand.id}:${sourceUrl}`;
  let task = pending.get(key);
  if (!task) {
    task = importContext(brand.id, runId, sourceUrl);
    pending.set(key, task);
  }
  let document: LibraryItem;
  try { document = await task; }
  finally { if (pending.get(key) === task) pending.delete(key); }
  return { ...brand, library: { ...brand.library, docs: [...brand.library.docs.filter(item => item.title !== CREATIVE_APPROVAL_DOCUMENT_TITLE), document] } };
}

async function importContext(clientId: string, runId: string, sourceUrl: string): Promise<LibraryItem> {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw error;
  if (!data.session?.access_token) throw new Error("Sign in before importing Creative Approval.");
  const googleAccessToken = await requireGoogleProviderToken();
  const response = await fetch(`${env.apiBaseUrl || "/api"}/creative-approval`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}`, "X-Google-Access-Token": googleAccessToken },
    body: JSON.stringify({ clientId, runId, sourceUrl })
  });
  const payload = await response.json() as { ok?: boolean; error?: string; document?: LibraryItem };
  if (!response.ok || payload.ok !== true) {
    if (/Google access|Reconnect Google/i.test(payload.error ?? "")) clearGoogleProviderToken();
    throw new Error(payload.error || "Could not import Creative Approval style context.");
  }
  const document = payload.document;
  if (!document || typeof document.id !== "string" || document.title !== CREATIVE_APPROVAL_DOCUMENT_TITLE || typeof document.description !== "string") throw new Error("Creative Approval returned invalid context.");
  return document;
}
