import { env } from "../../config/env";
import type { CreativeQualityReport } from "../../domain/quality-check";
import type { WorkflowState } from "../../features/workflow/model";
import { getSupabaseClient } from "../../lib/supabase/client";

export interface QualityCheckResult {
  outputId: string;
  gdPassed?: boolean;
  gdReason?: string;
  csPassed?: boolean;
  csReason?: string;
  passed: boolean;
  reason: string;
  report?: CreativeQualityReport;
}

export async function runQualityCheck(
  run: WorkflowState
): Promise<readonly QualityCheckResult[]> {
  const checkable = run.outputs.filter((output) => output.assetUrl);
  if (!checkable.length) return [];

  const request = {
    runId: run.id,
    brief: run.brief,
    brandContext: run.brand
      ? {
          name: run.brand.name,
          category: run.brand.category,
          brandKit: run.brand.library.brand.map(formatLibraryItem),
          products: run.brand.library.products.map(formatLibraryItem),
          documents: run.brand.library.docs.map(formatLibraryItem),
          working: run.brand.memory.working,
          avoid: run.brand.memory.avoid
        }
      : null,
    referenceImages: collectQualityReferences(run),
    outputs: checkable.map((output) => {
      const direction = run.directions.find(
        (candidate) => candidate.id === output.directionId
      );
      return {
        id: output.id,
        hook: direction?.hook ?? "",
        subheadline: direction?.subheadline ?? "",
        concept: direction?.concept ?? "",
        visual: direction?.visual ?? "",
        cta: direction?.cta ?? "",
        caption: direction?.caption ?? "",
        revisionFeedback: formatRevisionFeedback(output.approvalComments),
        assetUrl: output.assetUrl as string
      };
    })
  };

  const response = await fetch(env.qualityCheckEndpoint, {
    method: "POST",
    headers: await buildHeaders(),
    body: JSON.stringify(request)
  });

  const payload = await readJsonResponse<{
    results?: readonly QualityCheckResult[];
    error?: string;
  }>(response, "Quality check");

  if (!response.ok) {
    throw new Error(payload.error ?? `Quality check failed (${response.status}).`);
  }

  if (!Array.isArray(payload.results)) {
    throw new Error("Quality check returned no results.");
  }

  return payload.results;
}

function formatLibraryItem(item: {
  title: string;
  description: string;
}): string {
  return item.description.trim()
    ? `${item.title}: ${item.description}`
    : item.title;
}

function collectQualityReferences(run: WorkflowState): readonly {
  label: string;
  url: string;
  kind: "brand-kit" | "creative-reference";
}[] {
  const seen = new Set<string>();
  const references: {
    label: string;
    url: string;
    kind: "brand-kit" | "creative-reference";
  }[] = [];

  for (const item of run.brand?.library.brand ?? []) {
    if (!item.assetUrl || seen.has(item.assetUrl)) continue;
    seen.add(item.assetUrl);
    references.push({
      label: item.title,
      url: item.assetUrl,
      kind: "brand-kit"
    });
  }

  for (const item of run.referenceImages) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    references.push({
      label: item.label,
      url: item.url,
      kind: "creative-reference"
    });
  }

  return references;
}

function formatRevisionFeedback(
  comments: WorkflowState["outputs"][number]["approvalComments"]
): string {
  const labels = {
    graphicDesign: "GD",
    clientService: "CS",
    projectManager: "PM / Client"
  } as const;

  return Object.entries(comments)
    .filter((entry): entry is [keyof typeof labels, string] =>
      Boolean(entry[1].trim())
    )
    .map(([role, comment]) => `${labels[role]}: ${comment.trim()}`)
    .join("\n");
}

async function readJsonResponse<T>(
  response: Response,
  label: string
): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(`${label} returned an empty response body.`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label} returned a non-JSON response.`);
  }
}

async function buildHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  try {
    const { data } = await getSupabaseClient().auth.getSession();
    if (data.session?.access_token) {
      headers.Authorization = `Bearer ${data.session.access_token}`;
    }
  } catch {
    return headers;
  }

  return headers;
}
