import type { Brand, LibrarySection } from "../../domain/brand";
import type {
  ApprovalRole,
  CreativeDirection,
  CreativeOutput,
  CreativeStage,
  ReferenceImageSelection,
  ReviewDecision,
  ServiceType
} from "../../domain/creative-run";

export type AppView = "overview" | "studio";

export interface WorkflowState {
  id: string;
  createdAt: string;
  updatedAt: string;
  stage: CreativeStage;
  brand: Brand | null;
  brandMenuOpen: boolean;
  brandSearch: string;
  librarySection: LibrarySection;
  service: ServiceType;
  quantity: number;
  brief: string;
  attachments: readonly string[];
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
  | { type: "set-quantity"; quantity: number }
  | { type: "set-brief"; brief: string }
  | { type: "attach-files"; names: readonly string[] }
  | { type: "toggle-reference-image"; item: ReferenceImageSelection }
  | { type: "generate-directions"; directions: readonly CreativeDirection[] }
  | {
      type: "generate-more-directions";
      directions: readonly CreativeDirection[];
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
    }
  | {
      type: "comment-output";
      id: string;
      role: ApprovalRole;
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
