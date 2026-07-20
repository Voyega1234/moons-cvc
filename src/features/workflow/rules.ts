import { stages } from "./config";
import { canSelectBrand } from "../../domain/brand";
import type { ApprovalRole } from "../../domain/creative-run";
import {
  totalCreativeMixQuantity,
  type WorkflowAction,
  type WorkflowState
} from "./model";

export function isClientReviewComplete(run: WorkflowState): boolean {
  return (
    run.outputs.length > 0 &&
    run.outputs.every((output) => output.clientStatus === "approved")
  );
}

export function isBuildQualityCheckOutput(
  output: WorkflowState["outputs"][number]
): boolean {
  return !output.format.toUpperCase().includes("UGC");
}

export function isStageComplete(
  run: WorkflowState,
  stageId: WorkflowState["stage"]
): boolean {
  switch (stageId) {
    case "start":
      return Boolean(run.brand);
    case "brief":
      return run.directions.length > 0;
    case "directions":
      return run.outputs.length > 0;
    case "studio":
      return (
        run.qaComplete &&
        run.outputs.every(
          (output) =>
            !isBuildQualityCheckOutput(output) ||
            output.status !== "needs-revision"
        )
      );
    case "approval":
      return run.approved;
    case "client":
      return isClientReviewComplete(run);
    case "summary":
      return run.done;
  }
}

export function highestUnlockedStageIndex(run: WorkflowState): number {
  const firstIncompleteIndex = stages.findIndex(
    (stage) => !isStageComplete(run, stage.id)
  );
  return firstIncompleteIndex === -1
    ? stages.length - 1
    : firstIncompleteIndex;
}

export function canNavigateToStage(
  run: WorkflowState,
  target: WorkflowState["stage"]
): boolean {
  const targetIndex = stages.findIndex((stage) => stage.id === target);
  return targetIndex >= 0 && targetIndex <= highestUnlockedStageIndex(run);
}

export function selectedDirectionCount(run: WorkflowState): number {
  return run.directions.filter((direction) => direction.selected).length;
}

export function approvalRolesForOutput(
  output: WorkflowState["outputs"][number]
): readonly ApprovalRole[] {
  return output.format.toUpperCase().includes("UGC")
    ? ["clientService", "projectManager"]
    : ["graphicDesign", "clientService", "projectManager"];
}

export function currentApprovalRole(
  output: WorkflowState["outputs"][number]
): ApprovalRole | null {
  return (
    approvalRolesForOutput(output).find(
      (role) => output.approval[role] !== "approved"
    ) ?? null
  );
}

function approvalRoleLabel(role: ApprovalRole): string {
  if (role === "graphicDesign") return "Graphic Design";
  if (role === "clientService") return "Client Service";
  return "Project Manager";
}

export function workflowActionBlockReason(
  run: WorkflowState,
  action: WorkflowAction
): string | null {
  switch (action.type) {
    case "set-stage":
      return canNavigateToStage(run, action.stage)
        ? null
        : "Finish the current step before opening that stage.";
    case "select-brand":
      return canSelectBrand(action.brand)
        ? null
        : "This client has no Compass brand memory yet.";
    case "start-idea-generation":
    case "generate-directions":
    case "generate-more-directions":
      if (!run.brand) return "Choose a brand first.";
      if (!run.brief.trim()) return "Add a brief first.";
      if (totalCreativeMixQuantity(run) < 1) {
        return "Choose at least one deliverable.";
      }
      return null;
    case "toggle-direction":
      return run.directions.some((direction) => direction.id === action.id)
        ? null
        : "Generate hooks before selecting one.";
    case "replace-direction":
      return run.directions.some((direction) => direction.id === action.id)
        ? null
        : "Hook not found.";
    case "replace-directions":
      if (!run.directions.length) return "Generate hooks first.";
      return action.directions.length === run.directions.length
        ? null
        : "Regenerated hook count does not match the current set.";
    case "add-manual-direction":
      if (!action.hook.trim()) return "Add the hook before saving.";
      if (!action.pillar.trim() || !action.subheadline.trim() || !action.cta.trim()) {
        return "Complete the manual hook template before saving.";
      }
      return null;
    case "delete-direction":
      return run.directions.some((direction) => direction.id === action.id)
        ? null
        : "Hook not found.";
    case "auto-select-directions":
      return run.directions.length > 0
        ? null
        : "Generate hooks before Compass can pick.";
    case "start-artwork-generation":
      if (run.artworkGenerationStatus === "running") {
        return "Artwork generation is already in progress.";
      }
      if (!run.directions.length) return "Generate hooks first.";
      return selectedDirectionCount(run) === totalCreativeMixQuantity(run)
        ? null
        : `Select ${totalCreativeMixQuantity(run)} hooks first.`;
    case "create-outputs":
      if (!run.directions.length) return "Generate hooks first.";
      return selectedDirectionCount(run) === totalCreativeMixQuantity(run)
        ? null
        : `Select ${totalCreativeMixQuantity(run)} hooks first.`;
    case "run-qa":
      return run.outputs.length > 0 ? null : "Create outputs before QA.";
    case "approve-all":
      if (!run.outputs.length) return "Create outputs before internal QC.";
      if (!run.qaComplete) return "Run QA before internal approval.";
      return run.outputs.some((output) => output.status === "needs-revision")
        ? "Resolve every quality suggestion before internal approval."
        : null;
    case "approve-role":
      if (!run.outputs.length) return "Create outputs before internal QC.";
      if (!run.qaComplete) return "Run QA before internal review.";
      {
        const roleOutputs = run.outputs.filter(
          (output) => currentApprovalRole(output) === action.role
        );
        if (!roleOutputs.length) {
          return `No creatives are waiting for ${approvalRoleLabel(action.role)} review.`;
        }
        return roleOutputs.some((output) => output.status === "needs-revision")
          ? "Resolve every quality suggestion in this queue before approval."
          : null;
      }
    case "review-output":
      if (!run.qaComplete) return "Run QA before internal review.";
      if (action.decision === "rejected" && !action.comment.trim()) {
        return "Add a comment before rejecting.";
      }
      {
        const output = run.outputs.find((item) => item.id === action.id);
        if (!output) return "Output not found.";
        const currentRole = currentApprovalRole(output);
        if (!currentRole) return "This creative already passed Internal QC.";
        return currentRole === action.role
          ? null
          : `This creative is waiting for ${approvalRoleLabel(currentRole)} review.`;
      }
    case "resolve-qa-output":
      return run.outputs.some((output) => output.id === action.id)
        ? null
        : "Output not found.";
    case "save-output-reference":
      return run.outputs.some((output) => output.id === action.id)
        ? null
        : "Output not found.";
    case "edit-output-direction":
      return run.outputs.some((output) => output.id === action.id)
        ? null
        : "Output not found.";
    case "route-output-changes":
      if (!action.comment.trim()) return "Add one clear change instruction.";
      {
        const output = run.outputs.find((item) => item.id === action.id);
        if (!output) return "Output not found.";
        const currentRole = currentApprovalRole(output);
        return currentRole === action.requestedBy
          ? null
          : currentRole
            ? `This creative is waiting for ${approvalRoleLabel(currentRole)} review.`
            : "This creative already passed Internal QC.";
      }
    case "replace-output-asset":
      return run.outputs.some((output) => output.id === action.id)
        ? null
        : "Output not found.";
    case "send-client":
      if (!run.outputs.length) return "Create outputs before client review.";
      return run.approved ? null : "Approve internally before client review.";
    case "approve-output":
      if (!run.clientSent) return "Send to client first.";
      return run.outputs.some((output) => output.id === action.id)
        ? null
        : "Output not found.";
    case "request-client-change":
      if (!run.clientSent) return "Send to client first.";
      if (!action.comment.trim()) return "Add a comment before requesting changes.";
      return run.outputs.some((output) => output.id === action.id)
        ? null
        : "Output not found.";
    case "mark-delivered":
      return isClientReviewComplete(run)
        ? null
        : "Client must approve every output first.";
    case "mark-done":
      return run.stage === "summary"
        ? null
        : "Mark delivered before closing the run.";
    default:
      return null;
  }
}

export function canPerformWorkflowAction(
  run: WorkflowState,
  action: WorkflowAction
): boolean {
  return workflowActionBlockReason(run, action) === null;
}

export function runStatus(
  run: WorkflowState
): "active" | "ready" | "warning" | "delivered" {
  if (run.done) return "delivered";
  if (run.outputs.some((output) => output.status === "needs-revision")) {
    return "warning";
  }
  if (run.qaComplete) return "ready";
  return "active";
}
