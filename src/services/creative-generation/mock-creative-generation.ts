import type { CreativeOutput } from "../../domain/creative-run";
import type { WorkflowState } from "../../features/workflow/model";

export function generateMockOutputs(
  state: WorkflowState
): readonly CreativeOutput[] {
  return state.directions
    .filter((direction) => direction.selected)
    .map((direction, index) => ({
      id: `output-${index + 1}`,
      directionId: direction.id,
      format: state.service === "ugc-video" ? "9:16 UGC" : "1:1 Static",
      status: "draft" as const,
      clientStatus: "queued" as const,
      revisionCount: 0
    }));
}
