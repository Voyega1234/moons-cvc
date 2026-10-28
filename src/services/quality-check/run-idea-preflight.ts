import { env } from "../../config/env";
import { getSupabaseClient } from "../../lib/supabase/client";

export type IdeaPreflightCheckId = "quality" | "spelling" | "policy";

export interface IdeaPreflightContext {
  runId: string;
  brief: string;
  brandContext: {
    name: string;
    category: string;
    policies: readonly string[];
    products: readonly string[];
    documents: readonly string[];
    working: readonly string[];
    avoid: readonly string[];
  } | null;
}

export interface IdeaPreflightDirection {
  id: string;
  service: string;
  hook: string;
  subheadline: string;
  concept: string;
  visual: string;
  cta: string;
  caption: string;
  formatBeats: readonly string[];
  revisionFeedback: string;
}

export type IdeaPreflightFixableField =
  | "hook"
  | "subheadline"
  | "concept"
  | "visual"
  | "cta"
  | "caption";

export interface IdeaPreflightFinding {
  check: IdeaPreflightCheckId;
  message: string;
  field: IdeaPreflightFixableField | null;
  suggestion: string | null;
}

export interface IdeaPreflightResult {
  directionId: string;
  findings: readonly IdeaPreflightFinding[];
}

export interface IdeaPreflightRequest extends IdeaPreflightContext {
  checks: readonly IdeaPreflightCheckId[];
  directions: readonly IdeaPreflightDirection[];
}

const PREFLIGHT_BATCH_SIZE = 3;
const PREFLIGHT_CONCURRENCY = 2;
const retryableGatewayStatuses = new Set([500, 502, 503, 504]);

export async function runIdeaPreflight(
  request: IdeaPreflightRequest
): Promise<readonly IdeaPreflightResult[]> {
  if (!request.directions.length) return [];
  const headers = await buildHeaders();
  const results: IdeaPreflightResult[] = [];
  const groupSize = PREFLIGHT_BATCH_SIZE * PREFLIGHT_CONCURRENCY;
  for (let offset = 0; offset < request.directions.length; offset += groupSize) {
    const batches: IdeaPreflightRequest[] = [];
    for (
      let index = offset;
      index < Math.min(offset + groupSize, request.directions.length);
      index += PREFLIGHT_BATCH_SIZE
    ) {
      batches.push({
        ...request,
        directions: request.directions.slice(index, index + PREFLIGHT_BATCH_SIZE)
      });
    }
    const outcomes = await Promise.allSettled(
      batches.map(batch => requestPreflightBatch(batch, headers))
    );
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") throw outcome.reason;
      results.push(...outcome.value);
    }
  }
  return results;
}

async function requestPreflightBatch(
  request: IdeaPreflightRequest,
  headers: HeadersInit
): Promise<readonly IdeaPreflightResult[]> {
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    let text: string;
    try {
      response = await fetch(env.ideaPreflightEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(270_000)
      });
      text = await response.text();
    } catch (error) {
      if (attempt === 0 && error instanceof TypeError) continue;
      throw new Error("ระบบตรวจไอเดียไม่ตอบกลับ กรุณาลองตรวจอีกครั้ง โดยไอเดียเดิมยังอยู่ครบ", { cause: error });
    }
    let payload: { results?: readonly IdeaPreflightResult[]; error?: string } | null;
    try {
      payload = JSON.parse(text) as typeof payload;
    } catch {
      if (attempt === 0 && retryableGatewayStatuses.has(response.status)) continue;
      throw new Error(`บริการตรวจไอเดียขัดข้องชั่วคราว กรุณาลองตรวจอีกครั้ง (HTTP ${response.status})`);
    }
    if (!response.ok) {
      if (response.status >= 500) {
        throw new Error("ระบบตรวจไอเดียขัดข้องชั่วคราว กรุณาลองตรวจอีกครั้ง โดยไอเดียเดิมยังอยู่ครบ", { cause: payload?.error });
      }
      throw new Error(payload?.error ?? `ระบบตรวจไอเดียไม่สำเร็จ (HTTP ${response.status})`);
    }
    if (!Array.isArray(payload?.results) || payload.results.some(result =>
      !result || typeof result.directionId !== "string" || !Array.isArray(result.findings)
    )) {
      throw new Error("ระบบตรวจไอเดียตอบกลับไม่ครบ กรุณาลองตรวจอีกครั้ง");
    }
    const returnedResults = payload.results;
    const returnedIds = new Set(returnedResults.map(result => result.directionId));
    const missing = request.directions.filter(direction => !returnedIds.has(direction.id));
    if (missing.length) {
      throw new Error(`ระบบยังตรวจไอเดียไม่ครบ ${missing.length} รายการ กรุณาลองตรวจอีกครั้ง`);
    }
    return request.directions.map(direction =>
      returnedResults.find(result => result.directionId === direction.id)!
    );
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
