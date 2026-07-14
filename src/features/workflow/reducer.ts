import { emptyApprovalGate, serviceTypes } from "../../domain/creative-run";
import {
  directionSubheadline,
  resolveSubheadlineHighlight
} from "../../domain/subheadline-highlight";
import { generateMockOutputs } from "../../services/creative-generation/mock-creative-generation";
import { QUANTITY_LIMITS } from "../../shared/constants/ui";
import { clamp } from "../../shared/utils/number";
import { createId } from "../../shared/utils/id";
import { pluralize } from "../../shared/utils/text";
import {
  creativeMixItems,
  creativeMixServiceAt,
  directionServiceAt,
  totalCreativeMixQuantity,
  type CreativeMixItem,
  type WorkflowAction,
  type WorkflowState
} from "./model";

function assignDirectionsToMix(
  state: WorkflowState,
  directions: WorkflowState["directions"]
): WorkflowState["directions"] {
  const total = Math.max(1, totalCreativeMixQuantity(state));
  return directions.map((direction, index) => {
    const subheadline = directionSubheadline(direction);
    return {
      ...direction,
      service: creativeMixServiceAt(state, index % total),
      subheadline,
      exportGroup: direction.exportGroup ?? null,
      subheadlineHighlight: resolveSubheadlineHighlight(
        subheadline,
        direction.subheadlineHighlight
      )
    };
  });
}

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
Need: Strong hooks first. Neo should create only after approval.`;

function resetCreativeWork(state: WorkflowState): WorkflowState {
  return {
    ...state,
    directions: [],
    outputs: [],
    qaComplete: false,
    approved: false,
    clientSent: false,
    done: false
  };
}

function withCreativeMix(
  state: WorkflowState,
  creativeMix: readonly CreativeMixItem[]
): WorkflowState {
  const [first] = creativeMix;
  if (!first) return state;
  return resetCreativeWork({
    ...state,
    creativeMix,
    service: first.service,
    quantity: creativeMix.reduce((total, item) => total + item.quantity, 0)
  });
}

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
    creativeMix: [
      { id: "creative-mix-1", service: "single-static", quantity: 3 }
    ],
    service: "single-static",
    artworkMode: "standard",
    imagePromptModel: "gpt-5.6-terra",
    quantity: 3,
    successMetric: "CTR",
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
    case "replace-direction":
      return "Hook updated";
    case "replace-directions":
      return "All hooks regenerated";
    case "set-direction-export-group":
      return "PDF group updated";
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
    case "replace-output-asset":
      return "Replacement image uploaded";
    case "send-client":
      return "Sent to client";
    case "approve-output":
      return "Client approved";
    case "request-client-change":
      return "Client changes routed to Internal QC";
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
      return withCreativeMix(state, [
        {
          ...(creativeMixItems(state)[0] ?? { id: "creative-mix-1", quantity: 1 }),
          service: action.service
        }
      ]);
    case "set-artwork-mode":
      return { ...state, artworkMode: action.mode };
    case "set-image-prompt-model":
      return { ...state, imagePromptModel: action.model };
    case "set-quantity":
      return withCreativeMix(state, [
        {
          ...(creativeMixItems(state)[0] ?? {
            id: "creative-mix-1",
            service: state.service
          }),
          quantity: clamp(
            action.quantity,
            QUANTITY_LIMITS.minimum,
            QUANTITY_LIMITS.maximum
          )
        }
      ]);
    case "add-creative-mix-item": {
      const current = creativeMixItems(state);
      if (totalCreativeMixQuantity(state) >= QUANTITY_LIMITS.maximum) return state;
      const usedServices = new Set(current.map((item) => item.service));
      const service = serviceTypes.find((item) => !usedServices.has(item));
      if (!service) return state;
      return withCreativeMix(state, [
        ...current,
        { id: createId("creative-mix"), service, quantity: 1 }
      ]);
    }
    case "set-creative-mix-service": {
      const current = creativeMixItems(state);
      if (
        current.some(
          (item) => item.id !== action.id && item.service === action.service
        )
      ) {
        return state;
      }
      return withCreativeMix(
        state,
        current.map((item) =>
          item.id === action.id ? { ...item, service: action.service } : item
        )
      );
    }
    case "set-creative-mix-quantity": {
      const current = creativeMixItems(state);
      const otherTotal = current.reduce(
        (total, item) => total + (item.id === action.id ? 0 : item.quantity),
        0
      );
      const maximum = Math.max(
        QUANTITY_LIMITS.minimum,
        QUANTITY_LIMITS.maximum - otherTotal
      );
      return withCreativeMix(
        state,
        current.map((item) =>
          item.id === action.id
            ? {
                ...item,
                quantity: clamp(action.quantity, QUANTITY_LIMITS.minimum, maximum)
              }
            : item
        )
      );
    }
    case "remove-creative-mix-item": {
      const current = creativeMixItems(state);
      if (current.length === 1) return state;
      return withCreativeMix(
        state,
        current.filter((item) => item.id !== action.id)
      );
    }
    case "set-success-metric":
      return { ...state, successMetric: action.metric };
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
        directions: assignDirectionsToMix(state, action.directions),
        stage: "directions"
      };
    case "generate-more-directions": {
      const existingIds = new Set(state.directions.map((direction) => direction.id));
      const appended = assignDirectionsToMix(state, action.directions).map(
        (direction) =>
          existingIds.has(direction.id)
            ? { ...direction, id: createId("direction") }
            : direction
      );
      return {
        ...state,
        directions: [...state.directions, ...appended]
      };
    }
    case "replace-direction":
      return {
        ...state,
        directions: state.directions.map((direction, index) =>
          direction.id === action.id
            ? (() => {
                const subheadline = directionSubheadline(action.direction);
                return {
                  ...action.direction,
                  id: direction.id,
                  service: directionServiceAt(state, direction, index),
                  subheadline,
                  subheadlineHighlight: resolveSubheadlineHighlight(
                    subheadline,
                    action.direction.subheadlineHighlight
                  ),
                  exportGroup: direction.exportGroup ?? null,
                  selected: direction.selected
                };
              })()
            : direction
        ),
        outputs: [],
        qaComplete: false,
        approved: false,
        clientSent: false,
        done: false
      };
    case "replace-directions":
      if (action.directions.length !== state.directions.length) return state;
      return {
        ...state,
        directions: action.directions.map((direction, index) => {
          const subheadline = directionSubheadline(direction);
          return {
            ...direction,
            id: state.directions[index]?.id ?? direction.id,
            service:
              state.directions[index]?.service ?? creativeMixServiceAt(state, index),
            subheadline,
            subheadlineHighlight: resolveSubheadlineHighlight(
              subheadline,
              direction.subheadlineHighlight
            ),
            exportGroup: state.directions[index]?.exportGroup ?? null,
            selected: state.directions[index]?.selected ?? false
          };
        }),
        outputs: [],
        qaComplete: false,
        approved: false,
        clientSent: false,
        done: false
      };
    case "set-direction-export-group":
      return {
        ...state,
        directions: state.directions.map((direction) =>
          direction.id === action.id
            ? { ...direction, exportGroup: action.group }
            : direction
        )
      };
    case "toggle-direction": {
      const directionIndex = state.directions.findIndex(
        (direction) => direction.id === action.id
      );
      const target = state.directions[directionIndex];
      if (!target) return state;
      const targetService = directionServiceAt(state, target, directionIndex);
      const selectedCount = state.directions.filter(
        (direction) => direction.selected
      ).length;
      const requiredCount = totalCreativeMixQuantity(state);
      const serviceRequired =
        creativeMixItems(state).find((item) => item.service === targetService)
          ?.quantity ?? requiredCount;
      const serviceSelected = state.directions.reduce((count, direction, index) => {
        return direction.selected &&
          directionServiceAt(state, direction, index) === targetService
          ? count + 1
          : count;
      }, 0);
      const canSelect =
        selectedCount < requiredCount && serviceSelected < serviceRequired;
      return {
        ...state,
        directions: state.directions.map((direction) =>
          direction.id === action.id
            ? {
                ...direction,
                selected:
                  direction.selected || canSelect
                    ? !direction.selected
                    : direction.selected
              }
            : direction
        )
      };
    }
    case "auto-select-directions": {
      const selectedByService = new Map<string, number>();
      return {
        ...state,
        directions: state.directions.map((direction, index) => {
          const service = directionServiceAt(state, direction, index);
          const selected = selectedByService.get(service) ?? 0;
          const required =
            creativeMixItems(state).find((item) => item.service === service)
              ?.quantity ?? 0;
          const shouldSelect = selected < required;
          if (shouldSelect) selectedByService.set(service, selected + 1);
          return { ...direction, service, selected: shouldSelect };
        })
      };
    }
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
      if (action.decision === "rejected" && !action.comment.trim()) {
        return state;
      }
      const outputs = state.outputs.map((output) => {
        if (output.id !== action.id) return output;
        const approval = { ...output.approval, [action.role]: action.decision };
        const approvalComments = {
          ...output.approvalComments,
          [action.role]: action.comment
        };
        const hasRejection =
          approval.graphicDesign === "rejected" ||
          approval.clientService === "rejected" ||
          approval.projectManager === "rejected";
        const status = hasRejection
          ? ("needs-revision" as const)
          : output.status === "needs-revision"
            ? ("ready" as const)
            : output.status;
        return { ...output, approval, approvalComments, status };
      });
      return { ...state, outputs, approved: computeApproved(outputs) };
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
          clientStatus:
            output.clientStatus === "approved" ? "approved" : "sent"
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
    case "request-client-change": {
      const comment = action.comment.trim();
      if (
        !comment ||
        !state.clientSent ||
        !state.outputs.some((output) => output.id === action.id)
      ) {
        return state;
      }
      const outputs = state.outputs.map((output) =>
        output.id === action.id
          ? {
              ...output,
              status: "needs-revision" as const,
              clientStatus: "revision" as const,
              approval: {
                ...output.approval,
                projectManager: "rejected" as const
              },
              approvalComments: {
                ...output.approvalComments,
                projectManager: comment
              }
            }
          : output
      );
      return {
        ...state,
        stage: "approval",
        outputs,
        approved: computeApproved(outputs),
        clientSent: false,
        done: false
      };
    }
    case "mark-delivered":
      return { ...state, stage: "summary" };
    case "mark-done":
      return { ...state, done: true };
  }
}
