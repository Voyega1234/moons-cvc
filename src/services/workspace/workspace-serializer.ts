import {
  creativeStages,
  serviceTypes,
  type CreativeStage,
  type ServiceType
} from "../../domain/creative-run";
import type { Brand, BrandLibrary, LibraryItem } from "../../domain/brand";
import type {
  AppView,
  WorkspaceState,
  WorkflowState
} from "../../features/workflow/model";

export const WORKSPACE_SCHEMA_VERSION = 1;

interface WorkspaceSnapshotV1 {
  schemaVersion: 1;
  savedAt: string;
  data: WorkspaceState;
}

type UnknownRecord = Record<string, unknown>;

export function serializeWorkspace(
  workspace: WorkspaceState,
  savedAt: string
): string {
  const snapshot: WorkspaceSnapshotV1 = {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    savedAt,
    data: sanitizeWorkspace(workspace)
  };
  return JSON.stringify(snapshot);
}

export function deserializeWorkspace(raw: string): WorkspaceState | null {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(value) || value.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    return null;
  }

  return parseWorkspace(value.data);
}

function sanitizeWorkspace(workspace: WorkspaceState): WorkspaceState {
  const runsById = Object.fromEntries(
    Object.entries(workspace.runsById).map(([id, run]) => [
      id,
      {
        ...run,
        brandMenuOpen: false,
        brandSearch: ""
      }
    ])
  );

  return {
    ...workspace,
    runsById,
    toast: null
  };
}

function parseWorkspace(value: unknown): WorkspaceState | null {
  if (!isRecord(value)) return null;

  const view = parseView(value.view);
  const activeRunId = parseString(value.activeRunId);
  const runOrder = parseStringArray(value.runOrder);
  const runsRecord = isRecord(value.runsById) ? value.runsById : null;

  if (!view || !activeRunId || !runOrder?.length || !runsRecord) return null;
  if (new Set(runOrder).size !== runOrder.length) return null;

  const runsById: Record<string, WorkflowState> = {};
  for (const runId of runOrder) {
    const run = parseRun(runsRecord[runId]);
    if (!run || run.id !== runId) return null;
    runsById[runId] = run;
  }

  if (!runsById[activeRunId]) return null;

  return {
    view,
    activeRunId,
    runOrder,
    runsById,
    toast: null
  };
}

function parseRun(value: unknown): WorkflowState | null {
  if (!isRecord(value)) return null;

  const id = parseString(value.id);
  const createdAt = parseString(value.createdAt);
  const updatedAt = parseString(value.updatedAt);
  const stage = parseMember(value.stage, creativeStages);
  const service = parseMember(value.service, serviceTypes);
  const quantity = parseNumber(value.quantity);
  const brief = parseString(value.brief, true);
  const attachments = parseStringArray(value.attachments);

  if (
    !id ||
    !createdAt ||
    !updatedAt ||
    !stage ||
    !service ||
    quantity === null ||
    brief === null ||
    !attachments ||
    typeof value.qaComplete !== "boolean" ||
    typeof value.approved !== "boolean" ||
    typeof value.clientSent !== "boolean" ||
    typeof value.done !== "boolean" ||
    quantity < 1 ||
    quantity > 6
  ) {
    return null;
  }

  const brand = value.brand === null ? null : parseBrand(value.brand);
  if (value.brand !== null && !brand) return null;

  const librarySection = parseMember(value.librarySection, [
    "brand",
    "products",
    "docs",
    "refs"
  ] as const);
  const directions = parseDirections(value.directions);
  const outputs = parseOutputs(value.outputs);
  if (!librarySection || !directions || !outputs) return null;

  return {
    id,
    createdAt,
    updatedAt,
    stage: stage as CreativeStage,
    brand,
    brandMenuOpen: false,
    brandSearch: "",
    librarySection,
    service: service as ServiceType,
    quantity,
    brief,
    attachments,
    directions,
    outputs,
    qaComplete: value.qaComplete,
    approved: value.approved,
    clientSent: value.clientSent,
    done: value.done
  };
}

function parseBrand(value: unknown): Brand | null {
  if (!isRecord(value)) return null;
  const id = parseString(value.id);
  const name = parseString(value.name);
  const category = parseString(value.category);
  const initials = parseString(value.initials);
  const library = parseBrandLibrary(value.library);
  const memory = isRecord(value.memory) ? value.memory : null;
  const working = memory ? parseStringArray(memory.working) : null;
  const avoid = memory ? parseStringArray(memory.avoid) : null;

  if (
    !id ||
    !name ||
    !category ||
    !initials ||
    !library ||
    !working ||
    !avoid
  ) {
    return null;
  }

  return {
    id,
    name,
    category,
    initials,
    library,
    memory: { working, avoid }
  };
}

function parseBrandLibrary(value: unknown): BrandLibrary | null {
  if (!isRecord(value)) return null;
  const brand = parseLibraryItems(value.brand);
  const products = parseLibraryItems(value.products);
  const docs = parseLibraryItems(value.docs);
  const refs = parseLibraryItems(value.refs);
  return brand && products && docs && refs
    ? { brand, products, docs, refs }
    : null;
}

function parseLibraryItems(value: unknown): readonly LibraryItem[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.map((item) => {
    if (!isRecord(item)) return null;
    const id = parseString(item.id);
    const title = parseString(item.title);
    const description = parseString(item.description, true);
    const assetUrl =
      item.assetUrl === undefined ? undefined : parseString(item.assetUrl);
    if (!id || !title || description === null || assetUrl === null) return null;
    return {
      id,
      title,
      description,
      ...(assetUrl ? { assetUrl } : {})
    };
  });
  return items.every((item) => item !== null) ? items : null;
}

function parseDirections(
  value: unknown
): WorkflowState["directions"] | null {
  if (!Array.isArray(value)) return null;

  const directions = value.map((item) => {
    if (!isRecord(item)) return null;
    const id = parseString(item.id);
    const hook = parseString(item.hook, true);
    const concept = parseString(item.concept, true);
    const why =
      item.why === undefined
        ? "Works when the audience needs fast clarity."
        : parseString(item.why, true);
    const visual = parseString(item.visual, true);
    const cta =
      item.cta === undefined ? "Learn more" : parseString(item.cta, true);
    const caption = parseString(item.caption, true);
    if (
      !id ||
      hook === null ||
      concept === null ||
      why === null ||
      visual === null ||
      cta === null ||
      caption === null ||
      typeof item.selected !== "boolean"
    ) {
      return null;
    }
    return {
      id,
      hook,
      concept,
      why,
      visual,
      cta,
      caption,
      selected: item.selected
    };
  });

  return directions.every((direction) => direction !== null)
    ? directions
    : null;
}

function parseOutputs(value: unknown): WorkflowState["outputs"] | null {
  if (!Array.isArray(value)) return null;

  const validStatuses = ["draft", "needs-revision", "ready", "fixed"] as const;
  const validClientStatuses = [
    "queued",
    "sent",
    "revision",
    "approved"
  ] as const;
  const outputs = value.map((item) => {
    if (!isRecord(item)) return null;
    const id = parseString(item.id);
    const directionId = parseString(item.directionId);
    const format = parseString(item.format);
    const status = parseMember(item.status, validStatuses);
    const clientStatus = parseMember(item.clientStatus, validClientStatuses);
    const revisionCount = parseNumber(item.revisionCount);
    const assetUrl =
      item.assetUrl === undefined ? undefined : parseString(item.assetUrl);
    const assetStoragePath =
      item.assetStoragePath === undefined
        ? undefined
        : parseString(item.assetStoragePath);
    const assetBucket =
      item.assetBucket === undefined ? undefined : parseString(item.assetBucket);
    const provider =
      item.provider === undefined ? undefined : parseString(item.provider);
    const model = item.model === undefined ? undefined : parseString(item.model);

    if (
      !id ||
      !directionId ||
      !format ||
      !status ||
      !clientStatus ||
      revisionCount === null ||
      revisionCount < 0 ||
      assetUrl === null ||
      assetStoragePath === null ||
      assetBucket === null ||
      provider === null ||
      model === null
    ) {
      return null;
    }

    return {
      id,
      directionId,
      format,
      status,
      clientStatus,
      revisionCount,
      ...(assetUrl ? { assetUrl } : {}),
      ...(assetStoragePath ? { assetStoragePath } : {}),
      ...(assetBucket ? { assetBucket } : {}),
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {})
    };
  });

  return outputs.every((output) => output !== null) ? outputs : null;
}

function parseView(value: unknown): AppView | null {
  return value === "overview" || value === "studio" ? value : null;
}

function parseString(value: unknown, allowEmpty = false): string | null {
  if (typeof value !== "string") return null;
  return allowEmpty || value.length > 0 ? value : null;
}

function parseNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseStringArray(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null;
}

function parseMember<const Values extends readonly string[]>(
  value: unknown,
  values: Values
): Values[number] | null {
  return typeof value === "string" && values.includes(value)
    ? (value as Values[number])
    : null;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
