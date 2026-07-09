import { generateMockOutputs } from "../../services/creative-generation/mock-creative-generation";
import { QUANTITY_LIMITS } from "../../shared/constants/ui";
import { clamp } from "../../shared/utils/number";
import { pluralize } from "../../shared/utils/text";
import type { WorkflowAction, WorkflowState } from "./model";

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
    case "generate-directions":
      return "Hooks generated";
    case "create-outputs":
      return "Creative set created";
    case "run-qa":
      return "Quality check passed";
    case "approve-all":
      return "Packet approved";
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
    case "generate-directions":
      return {
        ...state,
        directions: action.directions,
        stage: "directions"
      };
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
    case "run-qa":
      return {
        ...state,
        qaComplete: true,
        outputs: state.outputs.map((output) => ({
          ...output,
          status: "ready"
        }))
      };
    case "approve-all":
      return { ...state, approved: true };
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
