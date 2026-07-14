import { env } from "../../config/env";
import type { CreativeDirection } from "../../domain/creative-run";
import { getSupabaseClient } from "../../lib/supabase/client";
import {
  normalizeCreativeDirections,
  type HookGenerationRunInput,
  type RawDirection
} from "./hook-generation-types";
import {
  creativeMixContentTypeQuotas,
  creativeMixItems,
  totalCreativeMixQuantity
} from "../../features/workflow/model";

export interface HookGenerationHarnessRequest {
  runId: string;
  brand: {
    id: string;
    name: string;
    category: string;
  } | null;
  service: HookGenerationRunInput["run"]["service"];
  quantity: number;
  contentTypeQuotas: readonly {
    service: HookGenerationRunInput["run"]["service"];
    count: number;
  }[];
  brief: string;
  extraInstructions: string;
  existingHooks: readonly { hook: string; concept: string }[];
  attachments: readonly string[];
  brandMemory: {
    working: readonly string[];
    avoid: readonly string[];
  };
  brandLibrary: {
    brand: readonly { title: string; description: string }[];
    products: readonly { title: string; description: string }[];
    docs: readonly { title: string; description: string }[];
    refs: readonly { title: string; description: string }[];
  };
}

export interface HookGenerationHarnessResponse {
  directions: readonly RawDirection[];
}

export async function generateDirectionsWithHarness({
  run,
  extraInstructions
}: HookGenerationRunInput): Promise<readonly CreativeDirection[]> {
  const response = await fetch(env.hookGenerationHarnessEndpoint, {
    method: "POST",
    headers: await buildHeaders(),
    body: JSON.stringify(
      buildHookGenerationHarnessRequest({ run, extraInstructions })
    )
  });

  const payload = await readJsonResponse<Partial<HookGenerationHarnessResponse>>(
    response,
    "Harness hook generation"
  );

  if (!response.ok) {
    throw new Error(
      readErrorMessage(payload) ??
        `Harness hook generation failed (${response.status}).`
    );
  }

  if (!Array.isArray(payload.directions)) {
    throw new Error("Harness hook generation returned no hooks.");
  }

  return normalizeCreativeDirections(payload.directions);
}

export function buildHookGenerationHarnessRequest({
  run,
  extraInstructions
}: HookGenerationRunInput): HookGenerationHarnessRequest {
  const brand = run.brand;

  return {
    runId: run.id,
    brand: brand
      ? {
          id: brand.id,
          name: brand.name,
          category: brand.category
        }
      : null,
    service: creativeMixItems(run)[0]?.service ?? run.service,
    quantity: totalCreativeMixQuantity(run),
    contentTypeQuotas: creativeMixContentTypeQuotas(run),
    brief: run.brief,
    extraInstructions: extraInstructions?.trim() ?? "",
    existingHooks: run.directions.map((direction) => ({
      hook: direction.hook,
      concept: direction.concept
    })),
    attachments: run.attachments,
    brandMemory: {
      working: brand?.memory.working ?? [],
      avoid: brand?.memory.avoid ?? []
    },
    brandLibrary: {
      brand: compactLibraryItems(brand?.library.brand ?? []),
      products: compactLibraryItems(brand?.library.products ?? []),
      docs: compactLibraryItems(brand?.library.docs ?? []),
      refs: compactLibraryItems(brand?.library.refs ?? [])
    }
  };
}

function compactLibraryItems(
  items: NonNullable<HookGenerationRunInput["run"]["brand"]>["library"]["brand"]
) {
  return items.map((item) => ({
    title: item.title,
    description: item.description
  }));
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

function readErrorMessage(payload: unknown): string | null {
  if (
    payload &&
    typeof payload === "object" &&
    typeof (payload as { error?: unknown }).error === "string"
  ) {
    return (payload as { error: string }).error;
  }

  return null;
}
