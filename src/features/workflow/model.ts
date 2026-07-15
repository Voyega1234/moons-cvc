import type { Brand, LibrarySection } from "../../domain/brand";
import type {
  ApprovalRole,
  AngleExportGroup,
  ArtworkMode,
  CreativeDirection,
  CreativeOutput,
  CreativeStage,
  ReferenceImageSelection,
  UploadedCreativeMaterial,
  ReviewDecision,
  ServiceType,
  ArtworkOutputSize,
  ImagePromptModel
} from "../../domain/creative-run";

export type AppView = "overview" | "studio";

export const successMetrics = ["CTR", "CVR", "CPA", "ROAS"] as const;
export type SuccessMetric = (typeof successMetrics)[number];

export interface CreativeMixItem {
  id: string;
  service: ServiceType;
  quantity: number;
}

export interface ContentTypeQuota {
  service: ServiceType;
  count: number;
}

export const EXTRA_HOOK_CANDIDATES_PER_TYPE = 2;

export interface WorkflowState {
  id: string;
  createdAt: string;
  updatedAt: string;
  stage: CreativeStage;
  brand: Brand | null;
  brandMenuOpen: boolean;
  brandSearch: string;
  librarySection: LibrarySection;
  creativeMix?: readonly CreativeMixItem[];
  /** Compatibility alias for the first creative-mix item. */
  service: ServiceType;
  artworkMode: ArtworkMode;
  imagePromptModel: ImagePromptModel;
  outputSize: ArtworkOutputSize;
  /** Compatibility alias for the total creative-mix quantity. */
  quantity: number;
  successMetric: SuccessMetric;
  brief: string;
  attachments: readonly string[];
  uploadedMaterials: readonly UploadedCreativeMaterial[];
  referenceImages: readonly ReferenceImageSelection[];
  directions: readonly CreativeDirection[];
  outputs: readonly CreativeOutput[];
  qaComplete: boolean;
  approved: boolean;
  clientSent: boolean;
  done: boolean;
}

export type WorkflowAction =
  | { type: "set-stage"; stage: CreativeStage }
  | { type: "toggle-brand-menu" }
  | { type: "close-brand-menu" }
  | { type: "search-brands"; value: string }
  | { type: "select-brand"; brand: Brand }
  | { type: "set-library-section"; section: LibrarySection }
  | { type: "set-service"; service: ServiceType }
  | { type: "set-artwork-mode"; mode: ArtworkMode }
  | { type: "set-image-prompt-model"; model: ImagePromptModel }
  | { type: "set-output-size"; size: ArtworkOutputSize }
  | { type: "set-quantity"; quantity: number }
  | { type: "apply-monthly-quota" }
  | { type: "set-creative-mix-quantity"; id: string; quantity: number }
  | { type: "set-success-metric"; metric: SuccessMetric }
  | { type: "set-brief"; brief: string }
  | { type: "attach-files"; names: readonly string[] }
  | { type: "add-uploaded-materials"; items: readonly UploadedCreativeMaterial[] }
  | {
      type: "update-uploaded-material";
      id: string;
      changes: Partial<Pick<UploadedCreativeMaterial, "role" | "description">>;
    }
  | { type: "remove-uploaded-material"; id: string }
  | { type: "toggle-reference-image"; item: ReferenceImageSelection }
  | { type: "generate-directions"; directions: readonly CreativeDirection[] }
  | {
      type: "generate-more-directions";
      directions: readonly CreativeDirection[];
    }
  | { type: "replace-direction"; id: string; direction: CreativeDirection }
  | { type: "replace-directions"; directions: readonly CreativeDirection[] }
  | {
      type: "set-direction-export-group";
      id: string;
      group: AngleExportGroup | null;
    }
  | { type: "toggle-direction"; id: string }
  | { type: "auto-select-directions" }
  | { type: "create-outputs"; outputs?: readonly CreativeOutput[] }
  | {
      type: "run-qa";
      results: readonly {
        outputId: string;
        passed: boolean;
        reason: string;
      }[];
    }
  | { type: "approve-all" }
  | {
      type: "review-output";
      id: string;
      role: ApprovalRole;
      decision: NonNullable<ReviewDecision>;
      comment: string;
    }
  | {
      type: "replace-output-asset";
      id: string;
      assetUrl: string;
      assetStoragePath?: string;
      assetBucket?: string;
    }
  | { type: "send-client" }
  | { type: "approve-output"; id: string }
  | { type: "request-client-change"; id: string; comment: string }
  | { type: "mark-delivered" }
  | { type: "mark-done" };

export interface WorkspaceState {
  view: AppView;
  activeRunId: string;
  runOrder: readonly string[];
  runsById: Readonly<Record<string, WorkflowState>>;
  toast: string | null;
}

export type WorkspaceAction =
  | { type: "set-view"; view: AppView }
  | {
      type: "create-run";
      id: string;
      now: string;
      keepBrand: boolean;
    }
  | { type: "switch-run"; id: string }
  | { type: "close-run"; id: string }
  | {
      type: "apply-run-action";
      runId: string;
      action: WorkflowAction;
      now: string;
    }
  | { type: "clear-toast" };

export function creativeMixItems(
  state: Pick<WorkflowState, "creativeMix" | "service" | "quantity">
): readonly CreativeMixItem[] {
  return state.creativeMix?.length
    ? state.creativeMix
    : [{ id: "creative-mix-1", service: state.service, quantity: state.quantity }];
}

export function totalCreativeMixQuantity(
  state: Pick<WorkflowState, "creativeMix" | "service" | "quantity">
): number {
  return creativeMixItems(state).reduce((total, item) => total + item.quantity, 0);
}

export function creativeMixContentTypeQuotas(
  state: Pick<WorkflowState, "creativeMix" | "service" | "quantity">
): readonly ContentTypeQuota[] {
  return creativeMixItems(state)
    .filter((item) => item.quantity > 0)
    .map((item) => ({
      service: item.service,
      count: item.quantity
    }));
}

export function hookGenerationContentTypeQuotas(
  state: Pick<WorkflowState, "creativeMix" | "service" | "quantity">
): readonly ContentTypeQuota[] {
  return creativeMixContentTypeQuotas(state).map((quota) => ({
    ...quota,
    count: quota.count + EXTRA_HOOK_CANDIDATES_PER_TYPE
  }));
}

export function totalHookGenerationQuantity(
  state: Pick<WorkflowState, "creativeMix" | "service" | "quantity">
): number {
  return hookGenerationContentTypeQuotas(state).reduce(
    (total, quota) => total + quota.count,
    0
  );
}

export function creativeMixServiceAt(
  state: Pick<WorkflowState, "creativeMix" | "service" | "quantity">,
  index: number
): ServiceType {
  let cursor = 0;
  for (const item of creativeMixItems(state)) {
    cursor += item.quantity;
    if (index < cursor) return item.service;
  }
  return creativeMixItems(state)[0]?.service ?? state.service;
}

export function directionServiceAt(
  state: Pick<WorkflowState, "creativeMix" | "service" | "quantity">,
  direction: Pick<CreativeDirection, "service">,
  index: number
): ServiceType {
  return direction.service ?? creativeMixServiceAt(state, index);
}
