import { env } from "../../config/env";
import type {
  AlbumFormatPreference,
  CreativeDirection,
  HookGenerationModel,
  HookIdeaMode,
  UploadedCreativeMaterial
} from "../../domain/creative-run";
import { getSupabaseClient } from "../../lib/supabase/client";
import {
  normalizeCreativeDirections,
  type HookGenerationRunInput,
  type RawDirection
} from "./hook-generation-types";
import {
  creativeMixItems,
  hookGenerationContentTypeQuotas,
  selectedBrandProducts,
  selectedUploadedMaterials,
  totalHookGenerationQuantity
} from "../../features/workflow/model";
import { buildOnboardingQuestionnaireHookContext } from "./onboarding-questionnaire-hook-context";

export interface HookGenerationHarnessRequest {
  runId: string;
  hookIdeaMode: HookIdeaMode;
  generationModel?: HookGenerationModel;
  albumFormat?: AlbumFormatPreference;
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
  onboardingQuestionnaire: string;
  extraInstructions: string;
  existingHooks: readonly { hook: string; concept: string }[];
  attachments: readonly string[];
  uploadedMaterials: readonly Pick<
    UploadedCreativeMaterial,
    "id" | "name" | "mediaType" | "role" | "description" | "url"
  >[];
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
  const requestInit: RequestInit = {
    method: "POST",
    headers: await buildHeaders(),
    body: JSON.stringify(
      buildHookGenerationHarnessRequest({ run, extraInstructions })
    )
  };
  const maxAttempts = 2;
  let response: Response | undefined;
  let payload: Partial<HookGenerationHarnessResponse> | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    response = await fetch(env.hookGenerationHarnessEndpoint, requestInit);
    const attemptLimit = isRetryableGatewayStatus(response.status)
      ? maxAttempts
      : 1;
    try {
      payload = await readJsonResponse<Partial<HookGenerationHarnessResponse>>(
        response,
        "Harness hook generation",
        attempt,
        attemptLimit
      );
      break;
    } catch (error) {
      if (
        !(error instanceof NonJsonResponseError) ||
        attempt === maxAttempts ||
        !isRetryableGatewayStatus(response.status)
      ) {
        throw error;
      }
    }
  }

  if (!response || !payload) {
    throw new Error("Harness hook generation did not return a response.");
  }

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
  const contentTypeQuotas = hookGenerationContentTypeQuotas(run);

  return {
    runId: run.id,
    hookIdeaMode: run.hookIdeaMode,
    generationModel: run.hookGenerationModel,
    albumFormat: run.albumFormat,
    brand: brand
      ? {
          id: brand.id,
          name: brand.name,
          category: brand.category
        }
      : null,
    service: contentTypeQuotas[0]?.service ?? creativeMixItems(run)[0]?.service ?? run.service,
    quantity: totalHookGenerationQuantity(run),
    contentTypeQuotas,
    brief: run.brief,
    onboardingQuestionnaire: buildOnboardingQuestionnaireHookContext(
      brand?.onboardingQuestionnaire
    ),
    extraInstructions: extraInstructions?.trim() ?? "",
    existingHooks: run.directions.map((direction) => ({
      hook: direction.hook,
      concept: direction.concept
    })),
    attachments: run.attachments,
    uploadedMaterials: selectedUploadedMaterials(run).map(
      ({ id, name, mediaType, role, description, url }) => ({
        id,
        name,
        mediaType,
        role,
        description,
        url
      })
    ),
    brandMemory: {
      working: brand?.memory.working ?? [],
      avoid: brand?.memory.avoid ?? []
    },
    brandLibrary: {
      brand: compactLibraryItems(brand?.library.brand ?? []),
      products: compactLibraryItems(selectedBrandProducts(run)),
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
  label: string,
  attempt: number,
  maxAttempts: number
): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(`${label} returned an empty response body.`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    const contentType =
      response.headers.get("content-type")?.trim() || "unknown content type";
    const requestId =
      response.headers.get("x-vercel-id")?.trim() ||
      response.headers.get("x-request-id")?.trim();
    const bodyKind = /^\s*</.test(text) ? "HTML" : "a non-JSON body";
    const context = [
      String(response.status),
      contentType,
      requestId && `request ${requestId}`
    ]
      .filter(Boolean)
      .join(", ");
    const attemptLabel = `${attempt} ${attempt === 1 ? "attempt" : "attempts"}`;
    const nextAction =
      attempt < maxAttempts
        ? " Retrying once."
        : response.status === 500 || response.status === 504
          ? " The hook-generation runtime stopped this long-running request. Do not retry repeatedly; check the server runtime first."
        : " Please retry the run; if this continues, verify the hook-generation API runtime.";
    throw new NonJsonResponseError(
      `${label} returned ${bodyKind} instead of JSON after ${attemptLabel} (${context}).${nextAction}`
    );
  }
}

class NonJsonResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonJsonResponseError";
  }
}

function isRetryableGatewayStatus(status: number): boolean {
  return status === 502 || status === 503;
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
