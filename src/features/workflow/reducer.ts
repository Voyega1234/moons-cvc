import {
  defaultArtworkOutputSize,
  emptyApprovalGate,
  normalizeFormatBeatsForService,
  type ApprovalRole
} from "../../domain/creative-run";
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
  hookGenerationContentTypeQuotas,
  totalCreativeMixQuantity,
  type CreativeMixItem,
  type WorkspaceToast,
  type WorkflowAction,
  type WorkflowState
} from "./model";
import { currentApprovalRole } from "./rules";

function assignDirectionsToMix(
  state: WorkflowState,
  directions: WorkflowState["directions"]
): WorkflowState["directions"] {
  const total = Math.max(1, totalCreativeMixQuantity(state));
  const candidateServices = hookGenerationContentTypeQuotas(state).flatMap(
    ({ service, count }) => Array.from({ length: count }, () => service)
  );
  const usesCandidatePool = directions.length > total;
  return directions.map((direction, index) => {
    const subheadline = directionSubheadline(direction);
    const fallbackService = usesCandidatePool
      ? candidateServices[index % candidateServices.length]
      : creativeMixServiceAt(state, index % total);
    const service = direction.service ?? fallbackService;
    return {
      ...direction,
      service,
      formatBeats: normalizeFormatBeatsForService(
        service,
        direction.formatBeats
      ),
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
  return output.format.includes("UGC")
    ? output.approval.clientService === "approved" &&
        output.approval.projectManager === "approved"
    : output.approval.graphicDesign === "approved" &&
        output.approval.clientService === "approved" &&
        output.approval.projectManager === "approved";
}

function computeApproved(outputs: WorkflowState["outputs"]): boolean {
  return outputs.length > 0 && outputs.every(isOutputFullyApproved);
}

export const defaultBrief = `Objective: Create Meta performance creatives that make the product benefit instantly clear.

Audience: People who know the problem but have not found a solution they trust.

Message priority: Lead with a recognizable tension, prove the product difference, and end with a low-friction action.

Creative guardrails: Keep the first frame bold, reduce decorative copy, show the product early, and make every execution feel native to its format.`;

function resetCreativeWork(state: WorkflowState): WorkflowState {
  return {
    ...state,
    ideaGenerationStatus: "idle",
    ideaGenerationError: null,
    artworkGenerationStatus: "idle",
    artworkGenerationError: null,
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
      { id: "creative-mix-1", service: "single-static", quantity: 3 },
      { id: "creative-mix-2", service: "ugc-video", quantity: 2 },
      { id: "creative-mix-3", service: "album-post", quantity: 1 }
    ],
    service: "single-static",
    artworkMode: "design-system",
    imagePromptModel: "gpt-5.6-terra",
    outputSize: defaultArtworkOutputSize,
    quantity: 6,
    successMetric: "CVR",
    brief: defaultBrief,
    attachments: [],
    uploadedMaterials: [],
    referenceImages: [],
    ideaGenerationStatus: "idle",
    ideaGenerationError: null,
    artworkGenerationStatus: "idle",
    artworkGenerationError: null,
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
): WorkspaceToast | null {
  switch (action.type) {
    case "select-brand":
      return successToast(
        "Brand memory loaded",
        `${action.brand.name} context is ready for the brief.`
      );
    case "apply-monthly-quota":
      return successToast(
        "Monthly quota applied",
        "3 Static, 2 UGC, and 1 Album are planned."
      );
    case "attach-files":
      return successToast(
        "Brief files attached",
        `${action.names.length} ${pluralize(action.names.length, "file")} added to this run.`
      );
    case "add-uploaded-materials":
      return successToast(
        "Creative materials added",
        `${action.items.length} ${pluralize(action.items.length, "image")} will travel with the brief.`
      );
    case "update-uploaded-material":
      return null;
    case "remove-uploaded-material":
      return successToast(
        "Creative material removed",
        "The file is no longer attached to this run."
      );
    case "select-reference-image":
      return successToast(
        "Reference selected",
        `${action.item.label} will guide idea and artwork generation.`
      );
    case "toggle-reference-image": {
      const nowSelected = state.referenceImages.some(
        (item) => item.id === action.item.id
      );
      return nowSelected
        ? successToast(
            "Reference selected",
            `${action.item.label} will guide idea and artwork generation.`
          )
        : successToast(
            "Reference removed",
            `${action.item.label} is no longer attached to this run.`
          );
    }
    case "generate-directions":
      return successToast(
        "Fresh ideas generated",
        `${action.directions.length} hook ${pluralize(action.directions.length, "option")} ready to review.`
      );
    case "start-idea-generation":
      return null;
    case "fail-idea-generation":
      return errorToast("Idea generation failed", action.message);
    case "generate-more-directions":
      return successToast(
        "More ideas generated",
        `${action.directions.length} new ${pluralize(action.directions.length, "hook")} added to this run.`
      );
    case "replace-direction":
      return successToast(
        "Hook updated",
        "Your feedback was applied to this hook only."
      );
    case "replace-directions":
      return successToast(
        "All hooks regenerated",
        "The new writing direction is ready to review."
      );
    case "set-direction-export-group":
      return successToast(
        "PDF group updated",
        "The idea will appear in the selected review section."
      );
    case "add-manual-direction":
      return successToast(
        "Manual hook added",
        "The new option is available in this creative type."
      );
    case "delete-direction":
      return successToast(
        "Hook deleted",
        "The option was removed from this run."
      );
    case "auto-select-directions":
      return successToast(
        "Recommended ideas selected",
        "Compass filled each creative type using the planned quota."
      );
    case "start-artwork-generation":
      return null;
    case "fail-artwork-generation":
      return errorToast("Artwork generation failed", action.message);
    case "create-outputs":
      return successToast(
        "Creative set created",
        `${state.outputs.length} ${pluralize(state.outputs.length, "draft")} ready in Build.`
      );
    case "run-qa": {
      const failed = action.results.filter((result) => !result.passed).length;
      return failed
        ? warningToast(
            "Quality check complete",
            `${failed} ${pluralize(failed, "creative")} ${failed === 1 ? "needs" : "need"} review before Internal QC.`
          )
        : successToast(
            "Quality check passed",
            "Every draft is ready for Internal QC."
          );
    }
    case "resolve-qa-output":
      return successToast(
        "Current version kept",
        "Your decision is recorded and the draft can move forward."
      );
    case "save-output-reference":
      return successToast(
        "Saved to references",
        "This execution is now available in the brand memory."
      );
    case "edit-output-direction":
      return successToast(
        "Creative copy updated",
        "Quality Check reset for the updated copy."
      );
    case "approve-all":
      return successToast(
        "All approvals complete",
        "Every asset is approved for Client Review."
      );
    case "review-output":
      return action.decision === "approved"
        ? successToast(
            "Creative approved",
            "The next reviewer can continue with this asset."
          )
        : warningToast(
            "Changes requested",
            "The feedback is attached to the correct review owner."
          );
    case "approve-role":
      return successToast(
        "Review queue approved",
        "The next review queue is ready to open."
      );
    case "route-output-changes":
      return warningToast(
        "Changes routed",
        "The fix owner can update the asset inside Internal QC."
      );
    case "replace-output-asset":
      return successToast(
        "Artwork replaced",
        "The updated asset is ready for review."
      );
    case "send-client":
      return successToast(
        "Sent to client",
        "The approved creative set is ready for client decisions."
      );
    case "approve-output":
      return successToast(
        "Creative approved",
        "This asset is ready for delivery."
      );
    case "request-client-change":
      return warningToast(
        "Client feedback recorded",
        "The request was routed to Internal QC with its context."
      );
    case "mark-delivered":
      return successToast(
        "Marked delivered",
        "The completed creative set is ready for Learn."
      );
    case "mark-done":
      return successToast(
        state.brand ? "Saved to Past work" : "Run completed",
        "This run is complete and remains available in your workspace."
      );
    default:
      return null;
  }
}

function successToast(title: string, message: string): WorkspaceToast {
  return { title, message, tone: "success" };
}

function warningToast(title: string, message: string): WorkspaceToast {
  return { title, message, tone: "warning" };
}

function errorToast(title: string, message: string): WorkspaceToast {
  return { title, message, tone: "error" };
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
        brandSearch: "",
        referenceImages:
          state.brand?.id === action.brand.id ? state.referenceImages : []
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
    case "set-output-size":
      return { ...state, outputSize: action.size };
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
    case "apply-monthly-quota": {
      const current = creativeMixItems(state);
      const idFor = (service: CreativeMixItem["service"]) =>
        current.find((item) => item.service === service)?.id ??
        createId("creative-mix");
      return withCreativeMix(state, [
        {
          id: idFor("single-static"),
          service: "single-static",
          quantity: 3
        },
        { id: idFor("ugc-video"), service: "ugc-video", quantity: 2 },
        { id: idFor("album-post"), service: "album-post", quantity: 1 }
      ]);
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
    case "set-success-metric":
      return { ...state, successMetric: action.metric };
    case "set-brief":
      return { ...state, brief: action.brief };
    case "attach-files":
      return { ...state, attachments: action.names };
    case "add-uploaded-materials":
      return {
        ...state,
        uploadedMaterials: [...state.uploadedMaterials, ...action.items]
      };
    case "update-uploaded-material":
      return {
        ...state,
        uploadedMaterials: state.uploadedMaterials.map((item) =>
          item.id === action.id ? { ...item, ...action.changes } : item
        )
      };
    case "remove-uploaded-material":
      return {
        ...state,
        uploadedMaterials: state.uploadedMaterials.filter(
          (item) => item.id !== action.id
        )
      };
    case "select-reference-image":
      return state.referenceImages.some((item) => item.id === action.item.id)
        ? state
        : {
            ...state,
            referenceImages: [...state.referenceImages, action.item]
          };
    case "sync-brand-logo-reference": {
      const nonLogoReferences = state.referenceImages.filter(
        (item) => item.label.trim().toLowerCase() !== "logo"
      );
      return {
        ...state,
        referenceImages: action.item
          ? [...nonLogoReferences, action.item]
          : nonLogoReferences
      };
    }
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
    case "start-idea-generation":
      return {
        ...state,
        ideaGenerationStatus: "running",
        ideaGenerationError: null
      };
    case "fail-idea-generation":
      return {
        ...state,
        ideaGenerationStatus: "failed",
        ideaGenerationError: action.message
      };
    case "generate-directions":
      return {
        ...state,
        ideaGenerationStatus: "idle",
        ideaGenerationError: null,
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
                  manual: direction.manual,
                  pillar: direction.pillar,
                  objective: direction.objective,
                  formatBeats: normalizeFormatBeatsForService(
                    directionServiceAt(state, direction, index),
                    action.direction.formatBeats
                  ),
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
            manual: state.directions[index]?.manual,
            pillar: state.directions[index]?.pillar,
            objective: state.directions[index]?.objective,
            formatBeats: normalizeFormatBeatsForService(
              state.directions[index]?.service ?? creativeMixServiceAt(state, index),
              direction.formatBeats
            ),
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
    case "add-manual-direction": {
      const hook = action.hook.trim();
      const subheadline = action.subheadline.trim();
      const pillar = action.pillar.trim();
      const objective = action.objective.trim();
      const cta = action.cta.trim();
      if (!hook || !subheadline || !pillar || !objective || !cta) return state;

      return {
        ...state,
        directions: [
          ...state.directions,
          {
            id: createId("manual-direction"),
            service: action.service,
            manual: true,
            pillar,
            objective,
            hook,
            subheadline,
            subheadlineHighlight: resolveSubheadlineHighlight(
              subheadline,
              undefined
            ),
            concept: pillar,
            why: `Created manually for the ${objective.toLowerCase()} objective.`,
            visual: "Use the hook and sub-headline as the primary copy hierarchy.",
            cta,
            supportingPoints: [],
            formatBeats: [],
            ctaActionType: "other" as const,
            caption: [hook, subheadline, cta].join("\n\n"),
            selected: false,
            exportGroup: null
          }
        ],
        outputs: [],
        qaComplete: false,
        approved: false,
        clientSent: false,
        done: false
      };
    }
    case "delete-direction": {
      if (!state.directions.some((direction) => direction.id === action.id)) {
        return state;
      }
      return {
        ...state,
        directions: state.directions.filter(
          (direction) => direction.id !== action.id
        ),
        outputs: [],
        qaComplete: false,
        approved: false,
        clientSent: false,
        done: false
      };
    }
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
    case "start-artwork-generation":
      return {
        ...state,
        artworkGenerationStatus: "running",
        artworkGenerationError: null
      };
    case "fail-artwork-generation":
      return {
        ...state,
        artworkGenerationStatus: "failed",
        artworkGenerationError: action.message
      };
    case "create-outputs":
      return {
        ...state,
        artworkGenerationStatus: "idle",
        artworkGenerationError: null,
        outputs: action.outputs ?? generateMockOutputs(state),
        stage: "studio",
        qaComplete: false
      };
    case "run-qa": {
      const resultsByOutputId = new Map(
        action.results.map((result) => [result.outputId, result])
      );
      const outputs = state.outputs.map((output) => {
        const result = resultsByOutputId.get(output.id);
        if (!result) return output;
        return {
          ...output,
          status: result.passed
            ? ("ready" as const)
            : ("needs-revision" as const),
          qaNote: result.reason,
          qaReport: result.report
        };
      });
      return {
        ...state,
        qaComplete: outputs.every(
          (output) => !output.assetUrl || output.status !== "draft"
        ),
        outputs
      };
    }
    case "resolve-qa-output":
      return {
        ...state,
        outputs: state.outputs.map((output) =>
          output.id === action.id
            ? { ...output, status: "ready" as const, qaNote: undefined }
            : output
        )
      };
    case "save-output-reference":
      return {
        ...state,
        outputs: state.outputs.map((output) =>
          output.id === action.id
            ? { ...output, savedToReferences: true }
            : output
        )
      };
    case "edit-output-direction": {
      const output = state.outputs.find((item) => item.id === action.id);
      if (!output) return state;
      return {
        ...state,
        qaComplete: false,
        directions: state.directions.map((direction) =>
          direction.id === output.directionId
            ? {
                ...direction,
                hook: action.hook.trim() || direction.hook,
                caption: action.caption.trim() || direction.caption,
                formatBeats: action.formatBeats
                  .map((item) => item.trim())
                  .filter(Boolean)
              }
            : direction
        ),
        outputs: state.outputs.map((currentOutput) =>
          currentOutput.id === action.id
            ? {
                ...currentOutput,
                status: "draft" as const,
                qaNote: undefined,
                qaReport: undefined
              }
            : currentOutput
        )
      };
    }
    case "approve-all": {
      const outputs = state.outputs.map((output) => ({
        ...output,
        approval: {
          graphicDesign: output.format.includes("UGC")
            ? null
            : output.approval.graphicDesign ?? "approved",
          clientService: output.approval.clientService ?? "approved",
          projectManager: output.approval.projectManager ?? "approved"
        } as const
      }));
      return { ...state, outputs, approved: computeApproved(outputs) };
    }
    case "approve-role": {
      const outputs = state.outputs.map((output) =>
        currentApprovalRole(output) === action.role
          ? {
              ...output,
              approval: {
                ...output.approval,
                [action.role]: "approved" as const
              }
            }
          : output
      );
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
    case "route-output-changes": {
      if (!action.comment.trim()) return state;
      const roleOrder: readonly ApprovalRole[] = [
        "graphicDesign",
        "clientService",
        "projectManager"
      ];
      const targetIndex = roleOrder.indexOf(action.targetRole);
      const outputs = state.outputs.map((output) => {
        if (output.id !== action.id) return output;
        const approval = { ...output.approval };
        roleOrder.forEach((role, index) => {
          if (index === targetIndex) approval[role] = "rejected";
          if (index > targetIndex) approval[role] = null;
        });
        const approvalComments = {
          ...output.approvalComments,
          [action.targetRole]: action.comment.trim()
        };
        return {
          ...output,
          approval,
          approvalComments,
          status: "needs-revision" as const
        };
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
              status: "draft" as const,
              qaNote: undefined,
              qaReport: undefined,
              approval: emptyApprovalGate
            }
          : output
      );
      return {
        ...state,
        outputs,
        qaComplete: false,
        approved: computeApproved(outputs)
      };
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
