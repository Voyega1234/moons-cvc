import { emptyApprovalGate } from "../../domain/creative-run";
import { generateMockOutputs } from "../../services/creative-generation/mock-creative-generation";
import { QUANTITY_LIMITS } from "../../shared/constants/ui";
import { clamp } from "../../shared/utils/number";
import { createId } from "../../shared/utils/id";
import { pluralize } from "../../shared/utils/text";
import type { WorkflowAction, WorkflowState } from "./model";

function isOutputFullyApproved(output: WorkflowState["outputs"][number]): boolean {
  return (
    output.approval.graphicDesign === "approved" &&
    output.approval.clientService === "approved" &&
    output.approval.projectManager === "approved"
  );
}

function computeApproved(outputs: WorkflowState["outputs"]): boolean {
  return outputs.length > 0 && outputs.every(isOutputFullyApproved);
}

export const defaultBrief = `Objective: Create Meta performance creatives for this month.
Audience: Warm and cold prospects who need one clear reason to take action.
Message: Keep it premium, clean, benefit-led, and direct.
Need: Strong hooks first. Moons should create only after approval.`;

export function createInitialWorkflowState({
  id,
  now,
  brand = null
}: {
  id: string;
  now: string;
  brand?: WorkflowState["brand"];
}): WorkflowState {
  return {
    id,
    createdAt: now,
    updatedAt: now,
    stage: "start",
    brand,
    brandMenuOpen: false,
    brandSearch: "",
    librarySection: "brand",
    service: "single-static",
    quantity: 3,
    brief: defaultBrief,
    attachments: [],
    referenceImages: [],
    directions: [],
    outputs: [],
    qaComplete: false,
    approved: false,
    clientSent: false,
    done: false
  };
}

export const initialWorkflowState = createInitialWorkflowState({
  id: "run-1",
  now: "2026-06-23T00:00:00.000Z"
});

export function workflowActionToast(
  action: WorkflowAction,
  state: WorkflowState
): string | null {
  switch (action.type) {
    case "select-brand":
      return `${action.brand.name} loaded`;
    case "attach-files":
      return `${action.names.length} ${pluralize(action.names.length, "file")} attached`;
    case "toggle-reference-image": {
      const nowSelected = state.referenceImages.some(
        (item) => item.id === action.item.id
      );
      return nowSelected
        ? `${action.item.label} added as reference`
        : `${action.item.label} removed from references`;
    }
    case "generate-directions":
      return "Hooks generated";
    case "generate-more-directions":
      return `${action.directions.length} more ${pluralize(action.directions.length, "hook")} added`;
    case "create-outputs":
      return "Creative set created";
    case "run-qa": {
      const failed = action.results.filter((result) => !result.passed).length;
      return failed
        ? `Quality check flagged ${failed} ${pluralize(failed, "creative")}`
        : "Quality check passed";
    }
    case "approve-all":
      return "Packet approved";
    case "review-output":
      return action.decision === "approved" ? "Creative approved" : "Creative rejected";
    case "comment-output":
      return "Comment saved";
    case "replace-output-asset":
      return "Replacement image uploaded";
    case "send-client":
      return "Sent to client";
    case "approve-output":
      return "Client approved";
    case "mark-delivered":
      return "Marked delivered";
    case "mark-done":
      return state.brand ? "Saved to Past work" : "Marked sent";
    default:
      return null;
  }
}

export function workflowReducer(
  state: WorkflowState,
  action: WorkflowAction
): WorkflowState {
  switch (action.type) {
    case "set-stage":
      return { ...state, stage: action.stage };
    case "toggle-brand-menu":
      return { ...state, brandMenuOpen: !state.brandMenuOpen };
    case "close-brand-menu":
      return { ...state, brandMenuOpen: false };
    case "search-brands":
      return { ...state, brandSearch: action.value };
    case "select-brand":
      return {
        ...state,
        brand: action.brand,
        brandMenuOpen: false,
        brandSearch: ""
      };
    case "set-library-section":
      return { ...state, librarySection: action.section };
    case "set-service":
      return {
        ...state,
        service: action.service,
        directions: [],
        outputs: [],
        qaComplete: false,
        approved: false,
        clientSent: false,
        done: false
      };
    case "set-quantity":
      return {
        ...state,
        quantity: clamp(
          action.quantity,
          QUANTITY_LIMITS.minimum,
          QUANTITY_LIMITS.maximum
        )
      };
    case "set-brief":
      return { ...state, brief: action.brief };
    case "attach-files":
      return { ...state, attachments: action.names };
    case "toggle-reference-image": {
      const exists = state.referenceImages.some(
        (item) => item.id === action.item.id
      );
      return {
        ...state,
        referenceImages: exists
          ? state.referenceImages.filter((item) => item.id !== action.item.id)
          : [...state.referenceImages, action.item]
      };
    }
    case "generate-directions":
      return {
        ...state,
        directions: action.directions,
        stage: "directions"
      };
    case "generate-more-directions": {
      const existingIds = new Set(state.directions.map((direction) => direction.id));
      const appended = action.directions.map((direction) =>
        existingIds.has(direction.id)
          ? { ...direction, id: createId("direction") }
          : direction
      );
      return {
        ...state,
        directions: [...state.directions, ...appended]
      };
    }
    case "toggle-direction": {
      const selectedCount = state.directions.filter(
        (direction) => direction.selected
      ).length;
      return {
        ...state,
        directions: state.directions.map((direction) =>
          direction.id === action.id
            ? {
                ...direction,
                selected:
                  direction.selected || selectedCount < state.quantity
                    ? !direction.selected
                    : direction.selected
              }
            : direction
        )
      };
    }
    case "auto-select-directions":
      return {
        ...state,
        directions: state.directions.map((direction, index) => ({
          ...direction,
          selected: index < state.quantity
        }))
      };
    case "create-outputs":
      return {
        ...state,
        outputs: action.outputs ?? generateMockOutputs(state),
        stage: "studio",
        qaComplete: false
      };
    case "run-qa": {
      const resultsByOutputId = new Map(
        action.results.map((result) => [result.outputId, result])
      );
      return {
        ...state,
        qaComplete: true,
        outputs: state.outputs.map((output) => {
          const result = resultsByOutputId.get(output.id);
          if (!result) return output;
          return {
            ...output,
            status: result.passed
              ? ("ready" as const)
              : ("needs-revision" as const),
            qaNote: result.reason
          };
        })
      };
    }
    case "approve-all": {
      const outputs = state.outputs.map((output) => ({
        ...output,
        approval: {
          graphicDesign: output.approval.graphicDesign ?? "approved",
          clientService: output.approval.clientService ?? "approved",
          projectManager: output.approval.projectManager ?? "approved"
        } as const
      }));
      return { ...state, outputs, approved: computeApproved(outputs) };
    }
    case "review-output": {
      const outputs = state.outputs.map((output) => {
        if (output.id !== action.id) return output;
        const approval = { ...output.approval, [action.role]: action.decision };
        const hasRejection =
          approval.graphicDesign === "rejected" ||
          approval.clientService === "rejected" ||
          approval.projectManager === "rejected";
        const status = hasRejection
          ? ("needs-revision" as const)
          : output.status === "needs-revision"
            ? ("ready" as const)
            : output.status;
        return { ...output, approval, status };
      });
      return { ...state, outputs, approved: computeApproved(outputs) };
    }
    case "comment-output": {
      const outputs = state.outputs.map((output) =>
        output.id === action.id
          ? {
              ...output,
              approvalComments: {
                ...output.approvalComments,
                [action.role]: action.comment
              }
            }
          : output
      );
      return { ...state, outputs };
    }
    case "replace-output-asset": {
      const outputs = state.outputs.map((output) =>
        output.id === action.id
          ? {
              ...output,
              assetUrl: action.assetUrl,
              ...(action.assetStoragePath
                ? { assetStoragePath: action.assetStoragePath }
                : {}),
              ...(action.assetBucket ? { assetBucket: action.assetBucket } : {}),
              revisionCount: output.revisionCount + 1,
              status: "fixed" as const,
              approval: emptyApprovalGate
            }
          : output
      );
      return { ...state, outputs, approved: computeApproved(outputs) };
    }
    case "send-client":
      return {
        ...state,
        clientSent: true,
        outputs: state.outputs.map((output) => ({
          ...output,
          clientStatus: "sent"
        }))
      };
    case "approve-output":
      return {
        ...state,
        outputs: state.outputs.map((output) =>
          output.id === action.id
            ? { ...output, clientStatus: "approved" }
            : output
        )
      };
    case "mark-delivered":
      return { ...state, stage: "summary" };
    case "mark-done":
      return { ...state, done: true };
  }
}
