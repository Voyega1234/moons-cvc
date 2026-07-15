import {
  angleExportGroups,
  artworkModes,
  artworkOutputSizes,
  creativeStages,
  ctaActionTypes,
  defaultArtworkOutputSize,
  emptyApprovalComments,
  imagePromptModels,
  serviceTypes,
  type CreativeStage,
  type ServiceType
} from "../../domain/creative-run";
import type { Brand, BrandLibrary, LibraryItem } from "../../domain/brand";
import { resolveSubheadlineHighlight } from "../../domain/subheadline-highlight";
import type {
  AppView,
  CreativeMixItem,
  WorkspaceState,
  WorkflowState
} from "../../features/workflow/model";
import { successMetrics } from "../../features/workflow/model";

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
  const artworkMode =
    value.artworkMode === undefined
      ? "standard"
      : parseMember(value.artworkMode, artworkModes);
  const imagePromptModel =
    value.imagePromptModel === undefined
      ? "gpt-5.6-terra"
      : parseMember(value.imagePromptModel, imagePromptModels);
  const outputSize =
    value.outputSize === undefined
      ? defaultArtworkOutputSize
      : parseMember(value.outputSize, artworkOutputSizes);
  const quantity = parseNumber(value.quantity);
  const successMetric =
    value.successMetric === undefined
      ? "CTR"
      : parseMember(value.successMetric, successMetrics);
  const brief = parseString(value.brief, true);
  const attachments = parseStringArray(value.attachments);
  const uploadedMaterials = parseUploadedMaterials(value.uploadedMaterials);

  if (
    !id ||
    !createdAt ||
    !updatedAt ||
    !stage ||
    !service ||
    !artworkMode ||
    !imagePromptModel ||
    !outputSize ||
    !successMetric ||
    quantity === null ||
    brief === null ||
    !attachments ||
    !uploadedMaterials ||
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

  const creativeMix =
    value.creativeMix === undefined
      ? [{ id: "creative-mix-1", service, quantity }]
      : parseCreativeMix(value.creativeMix);
  if (!creativeMix) return null;

  const librarySection = parseMember(value.librarySection, [
    "brand",
    "products",
    "docs",
    "refs"
  ] as const);
  const directions = parseDirections(value.directions);
  const outputs = parseOutputs(value.outputs);
  const referenceImages = parseReferenceImages(value.referenceImages);
  if (!librarySection || !directions || !outputs || !referenceImages) {
    return null;
  }

  return {
    id,
    createdAt,
    updatedAt,
    stage: stage as CreativeStage,
    brand,
    brandMenuOpen: false,
    brandSearch: "",
    librarySection,
    creativeMix,
    service: creativeMix[0]?.service ?? (service as ServiceType),
    artworkMode,
    imagePromptModel,
    outputSize,
    quantity: creativeMix.reduce((total, item) => total + item.quantity, 0),
    successMetric,
    brief,
    attachments,
    uploadedMaterials,
    referenceImages,
    directions,
    outputs,
    qaComplete: value.qaComplete,
    approved: value.approved,
    clientSent: value.clientSent,
    done: value.done
  };
}

function parseCreativeMix(value: unknown): readonly CreativeMixItem[] | null {
  if (!Array.isArray(value) || !value.length) return null;

  const items: CreativeMixItem[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) return null;
    const id = parseString(candidate.id);
    const service = parseMember(candidate.service, serviceTypes);
    const quantity = parseNumber(candidate.quantity);
    if (
      !id ||
      !service ||
      quantity === null ||
      quantity < 1 ||
      quantity > 6
    ) {
      return null;
    }
    items.push({ id, service, quantity });
  }

  if (new Set(items.map((item) => item.id)).size !== items.length) return null;
  if (new Set(items.map((item) => item.service)).size !== items.length) return null;
  if (items.reduce((total, item) => total + item.quantity, 0) > 6) return null;
  return items;
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

function parseReferenceImages(
  value: unknown
): WorkflowState["referenceImages"] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const items = value.map((item) => {
    if (!isRecord(item)) return null;
    const id = parseString(item.id);
    const url = parseString(item.url);
    const label = parseString(item.label, true);
    if (!id || !url || label === null) return null;
    return { id, url, label };
  });

  return items.every((item) => item !== null) ? items : null;
}

function parseUploadedMaterials(
  value: unknown
): WorkflowState["uploadedMaterials"] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const allowedRoles = new Set([
    "main-object",
    "product",
    "supporting-component",
    "client-context"
  ]);
  const items = value.map((item) => {
    if (!isRecord(item)) return null;
    const id = parseString(item.id);
    const name = parseString(item.name, true);
    const mediaType = parseString(item.mediaType);
    const role = parseString(item.role);
    const description = parseString(item.description, true);
    const url = parseString(item.url);
    const storagePath =
      item.storagePath === undefined ? undefined : parseString(item.storagePath);
    const storageBucket =
      item.storageBucket === undefined
        ? undefined
        : parseString(item.storageBucket);
    if (
      !id ||
      name === null ||
      !mediaType ||
      !role ||
      !allowedRoles.has(role) ||
      description === null ||
      !url ||
      storagePath === null ||
      storageBucket === null
    ) {
      return null;
    }
    return {
      id,
      name,
      mediaType,
      role: role as WorkflowState["uploadedMaterials"][number]["role"],
      description,
      url,
      ...(storagePath ? { storagePath } : {}),
      ...(storageBucket ? { storageBucket } : {})
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
    const service =
      item.service === undefined
        ? undefined
        : parseMember(item.service, serviceTypes);
    const hook = parseString(item.hook, true);
    const concept = parseString(item.concept, true);
    const subheadline =
      item.subheadline === undefined
        ? concept
        : parseString(item.subheadline, true);
    const subheadlineHighlight =
      item.subheadlineHighlight === undefined
        ? undefined
        : parseString(item.subheadlineHighlight, true);
    const exportGroup =
      item.exportGroup === undefined || item.exportGroup === null
        ? null
        : parseMember(item.exportGroup, angleExportGroups);
    const why =
      item.why === undefined
        ? "Works when the audience needs fast clarity."
        : parseString(item.why, true);
    const visual = parseString(item.visual, true);
    const cta =
      item.cta === undefined ? "Learn more" : parseString(item.cta, true);
    const supportingPoints =
      item.supportingPoints === undefined
        ? []
        : parseStringArray(item.supportingPoints);
    const formatBeats =
      item.formatBeats === undefined ? [] : parseStringArray(item.formatBeats);
    const ctaActionType =
      item.ctaActionType === undefined
        ? undefined
        : parseMember(item.ctaActionType, ctaActionTypes);
    const ctaDestination =
      item.ctaDestination === undefined
        ? undefined
        : parseString(item.ctaDestination, true);
    const contactLine =
      item.contactLine === undefined
        ? undefined
        : parseString(item.contactLine, true);
    const caption = parseString(item.caption, true);
    if (
      !id ||
      (item.service !== undefined && !service) ||
      hook === null ||
      concept === null ||
      subheadline === null ||
      subheadlineHighlight === null ||
      (item.exportGroup !== undefined &&
        item.exportGroup !== null &&
        !exportGroup) ||
      why === null ||
      visual === null ||
      cta === null ||
      supportingPoints === null ||
      formatBeats === null ||
      (item.ctaActionType !== undefined && !ctaActionType) ||
      ctaDestination === null ||
      contactLine === null ||
      caption === null ||
      typeof item.selected !== "boolean"
    ) {
      return null;
    }
    return {
      id,
      service: service ?? undefined,
      hook,
      subheadline,
      concept,
      subheadlineHighlight: resolveSubheadlineHighlight(
        subheadline,
        subheadlineHighlight
      ),
      exportGroup,
      why,
      visual,
      cta,
      supportingPoints,
      formatBeats,
      ctaActionType: ctaActionType ?? undefined,
      ctaDestination: ctaDestination ?? undefined,
      contactLine: contactLine ?? undefined,
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
    const approval = parseApprovalGate(item.approval);
    const approvalComments =
      parseApprovalComments(item.approvalComments) ?? emptyApprovalComments;
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
      !approval ||
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
      approval,
      approvalComments,
      ...(assetUrl ? { assetUrl } : {}),
      ...(assetStoragePath ? { assetStoragePath } : {}),
      ...(assetBucket ? { assetBucket } : {}),
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {})
    };
  });

  return outputs.every((output) => output !== null) ? outputs : null;
}

function parseApprovalGate(value: unknown): WorkflowState["outputs"][number]["approval"] | null {
  if (!isRecord(value)) return null;
  const graphicDesign = parseReviewDecision(value.graphicDesign);
  const clientService = parseReviewDecision(value.clientService);
  const projectManager = parseReviewDecision(value.projectManager);
  if (
    graphicDesign === undefined ||
    clientService === undefined ||
    projectManager === undefined
  ) {
    return null;
  }
  return { graphicDesign, clientService, projectManager };
}

function parseApprovalComments(
  value: unknown
): WorkflowState["outputs"][number]["approvalComments"] | null {
  if (!isRecord(value)) return null;
  const graphicDesign = parseString(value.graphicDesign, true);
  const clientService = parseString(value.clientService, true);
  const projectManager = parseString(value.projectManager, true);
  if (
    graphicDesign === null ||
    clientService === null ||
    projectManager === null
  ) {
    return null;
  }
  return { graphicDesign, clientService, projectManager };
}

function parseReviewDecision(
  value: unknown
): "approved" | "rejected" | null | undefined {
  if (value === null) return null;
  return value === "approved" || value === "rejected" ? value : undefined;
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
