import {
  emptyApprovalComments,
  emptyApprovalGate,
  outputFormatForService,
  type CreativeOutput
} from "../../domain/creative-run";
import {
  directionServiceAt,
  type WorkflowState
} from "../../features/workflow/model";

export function generateMockOutputs(
  state: WorkflowState
): readonly CreativeOutput[] {
  return state.directions
    .map((direction, index) => ({ direction, index }))
    .filter(({ direction }) => direction.selected)
    .map(({ direction, index }, outputIndex) => ({
      id: `output-${outputIndex + 1}`,
      directionId: direction.id,
      format: outputFormatForService(directionServiceAt(state, direction, index)),
      status: "draft" as const,
      clientStatus: "queued" as const,
      revisionCount: 0,
      approval: emptyApprovalGate,
      approvalComments: emptyApprovalComments
    }));
}
