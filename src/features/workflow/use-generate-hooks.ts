import { useCallback, useState, type Dispatch } from "react";
import { useOptionalWorkspace } from "../../app/providers/workspace-provider";
import { env } from "../../config/env";
import type {
  HookGenerationModel,
  ServiceType
} from "../../domain/creative-run";
import { MAX_HOOK_GENERATION_MODELS } from "../../domain/creative-run";
import {
  generateDirectionsWithHarness,
  generateHookResearchWithHarness
} from "../../services/creative-generation/harness-hook-generation";
import {
  generateDirectionsFromNewCompassWebhook,
  generateDirectionsFromWebhook
} from "../../services/creative-generation/n8n-hook-generation";
import { playGenerationSuccessSound } from "../../shared/utils/notification-sound";
import { serviceLabels } from "./config";
import {
  creativeMixContentTypeQuotas,
  directionServiceAt,
  EXTRA_HOOK_OPTIONS_PER_TYPE,
  hookGenerationContentTypeQuotas,
  selectedUploadedMaterials,
  totalHookGenerationQuantity,
  type WorkflowAction,
  type WorkflowState
} from "./model";

export function buildSuccessMetricInstructions(
  metric: WorkflowState["successMetric"]
): string {
  return `Primary success metric: ${metric}. Make the angle support this outcome without inventing performance claims.`;
}

export function buildCreativeMixInstructions(
  state: Pick<WorkflowState, "creativeMix" | "service" | "quantity">
): string {
  const requestedQuotas = creativeMixContentTypeQuotas(state);
  const requestedMix = requestedQuotas
    .map((item) => `${serviceLabels[item.service]} × ${item.count}`)
    .join("; ");
  return `Creative mix quota: ${requestedMix}. Generate ${totalHookGenerationQuantity(state)} finished hook directions in one pass: the exact requested quantity plus 2 additional finished options for every active content type. Do not create or return an intermediate candidate pool.`;
}

function withCreativeMixInstructions(
  state: WorkflowState,
  instructions: string
): string {
  return [buildCreativeMixInstructions(state), instructions]
    .filter(Boolean)
    .join("\n");
}

const GENERATE_MORE_IDEA_COUNT = 3;

export function selectedHookGenerationModels(
  state: Pick<WorkflowState, "hookGenerationModel" | "hookGenerationModels">
): readonly HookGenerationModel[] {
  const selected =
    state.hookGenerationModels?.length &&
    state.hookGenerationModels[0] === state.hookGenerationModel
      ? state.hookGenerationModels
      : [state.hookGenerationModel];
  return Array.from(new Set(selected)).slice(0, MAX_HOOK_GENERATION_MODELS);
}

function generateDirectionsForModel(
  state: WorkflowState,
  extraInstructions: string,
  model: HookGenerationModel,
  researchDossier?: unknown
) {
  const modelState: WorkflowState = {
    ...state,
    hookGenerationModel: model,
    hookGenerationModels: [model]
  };
  const contentTypeQuotas = hookGenerationContentTypeQuotas(state);
  const webhookInput = {
    brand: state.brand,
    hookIdeaMode: state.hookIdeaMode,
    albumFormat: state.albumFormat,
    service: contentTypeQuotas[0]?.service ?? state.service,
    quantity: totalHookGenerationQuantity(state),
    contentTypeQuotas,
    brief: state.brief,
    uploadedMaterials: selectedUploadedMaterials(state),
    extraInstructions
  };

  if (model === "n8n-compass-new") {
    return generateDirectionsFromNewCompassWebhook(webhookInput);
  }
  if (env.hookGenerationMode === "harness") {
    return generateDirectionsWithHarness({
      run: modelState,
      extraInstructions,
      researchDossier
    });
  }
  return generateDirectionsFromWebhook(webhookInput);
}

async function generateDirectionsForState(
  state: WorkflowState,
  extraInstructions: string
) {
  const models = selectedHookGenerationModels(state);
  const compared = models.length > 1;
  const directModels = models.filter((model) => model !== "n8n-compass-new");
  const researchDossier =
    env.hookGenerationMode === "harness" && directModels.length
      ? await generateHookResearchWithHarness({
          run: {
            ...state,
            hookGenerationModel: directModels[0]!,
            hookGenerationModels: [directModels[0]!]
          },
          extraInstructions
        })
      : undefined;
  const settledResults = await Promise.allSettled(
    models.map(async (model) => {
      const directions = await generateDirectionsForModel(
        state,
        extraInstructions,
        model,
        model === "n8n-compass-new" ? undefined : researchDossier
      );
      const idPrefix = model.replaceAll(/[^a-z0-9]+/gi, "-");
      return directions.map((direction, index) => ({
        ...direction,
        id: compared
          ? `${idPrefix}-${direction.id || `direction-${index + 1}`}`
          : direction.id,
        generationModel: model
      }));
    })
  );

  const successful = settledResults.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  );
  const failures = settledResults.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  if (!successful.length && failures.length) {
    throw failures[0]!.reason;
  }
  if (failures.length) {
    console.warn(
      `${failures.length} Hook model request(s) failed; keeping successful model results.`,
      failures.map((failure) => failure.reason)
    );
  }
  return successful;
}

export function useGenerateHooks(
  state: WorkflowState,
  dispatch: Dispatch<WorkflowAction>
) {
  const generate = useCallback(() => {
    dispatch({ type: "start-idea-generation" });

    const extraInstructions = withCreativeMixInstructions(
      state,
      buildSuccessMetricInstructions(state.successMetric)
    );

    const generation = Promise.resolve().then(() =>
      generateDirectionsForState(state, extraInstructions)
    );

    void generation
      .then((directions) => {
        dispatch({ type: "generate-directions", directions });
        playGenerationSuccessSound();
      })
      .catch((caught: unknown) => {
        dispatch({
          type: "fail-idea-generation",
          message:
            caught instanceof Error
              ? caught.message
              : "Could not generate hooks."
        });
      });
  }, [state, dispatch]);

  return {
    generate,
    loading: state.ideaGenerationStatus === "running",
    error:
      state.ideaGenerationStatus === "failed"
        ? state.ideaGenerationError
        : null
  };
}

export function useGenerateMoreHooks(
  state: WorkflowState,
  dispatch: Dispatch<WorkflowAction>
) {
  const [loadingService, setLoadingService] = useState<ServiceType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generateMore = useCallback(
    (service: ServiceType, userDirection?: string) => {
      setLoadingService(service);
      setError(null);

      const requestedQuantity = Math.max(
        1,
        GENERATE_MORE_IDEA_COUNT - EXTRA_HOOK_OPTIONS_PER_TYPE
      );
      const targetedState: WorkflowState = {
        ...state,
        service,
        quantity: requestedQuantity,
        creativeMix: [
          {
            id: `generate-more-${service}`,
            service,
            quantity: requestedQuantity
          }
        ]
      };
      const contentTypeLabel = serviceLabels[service];
      const trimmedUserDirection = userDirection?.trim();
      const combinedInstructions = withCreativeMixInstructions(
        targetedState,
        [
          `Generate additional ${contentTypeLabel} hook ideas only.`,
          `Every returned direction must use the ${contentTypeLabel} content type.`,
          "Make each new idea meaningfully different from the existing hooks.",
          ...(trimmedUserDirection
            ? [
                "USER DIRECTION FOR THESE ADDITIONAL IDEAS:",
                trimmedUserDirection
              ]
            : [])
        ].join("\n")
      );
      const generation = generateDirectionsForState(
        targetedState,
        combinedInstructions
      );

      void generation
        .then((directions) => {
          dispatch({
            type: "generate-more-directions",
            directions: directions.map((direction) => ({
              ...direction,
              service
            }))
          });
          playGenerationSuccessSound();
        })
        .catch((caught: unknown) => {
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not generate more hooks."
          );
        })
        .finally(() => {
          setLoadingService(null);
        });
    },
    [state, dispatch]
  );

  return {
    generateMore,
    loading: loadingService !== null,
    loadingService,
    error
  };
}

export function useRegenerateHook(
  state: WorkflowState,
  dispatch: Dispatch<WorkflowAction>
) {
  const createCheckpoint = useOptionalWorkspace()?.createCheckpoint;
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const regenerate = useCallback(
    async (direction: WorkflowState["directions"][number], feedback: string) => {
      const normalizedFeedback = feedback.trim();
      if (!normalizedFeedback) {
        setError("Add clear rewrite feedback first.");
        return false;
      }

      setLoadingId(direction.id);
      setError(null);

      const directionIndex = state.directions.findIndex(
        (item) => item.id === direction.id
      );
      const service = directionServiceAt(state, direction, directionIndex);
      const targetedState: WorkflowState = {
        ...state,
        hookGenerationModel:
          direction.generationModel ?? state.hookGenerationModel,
        hookGenerationModels: [
          direction.generationModel ?? state.hookGenerationModel
        ],
        service,
        quantity: 1,
        creativeMix: [
          { id: `regenerate-${service}`, service, quantity: 1 }
        ]
      };

      const extraInstructions = withCreativeMixInstructions(targetedState, [
        "Regenerate one existing hook instead of creating an unrelated idea.",
        `Original hook: ${direction.hook}`,
        `Original concept: ${direction.concept}`,
        `Rewrite feedback: ${normalizedFeedback}`,
        "Keep the same strategic idea, audience tension, product truth, and CTA intent.",
        "Apply the feedback to the hook and supporting copy. Return the replacement as the first direction."
      ].join("\n"));

      const generation = generateDirectionsForState(
        targetedState,
        extraInstructions
      );

      try {
        const directions = await generation;
        const replacement = directions[0];
        if (!replacement) throw new Error("Hook regeneration returned no hook.");
        await createCheckpoint?.("regenerate", state.id);
        dispatch({
          type: "replace-direction",
          id: direction.id,
          direction: replacement
        });
        playGenerationSuccessSound();
        return true;
      } catch (caught: unknown) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not regenerate this hook."
        );
        return false;
      } finally {
        setLoadingId(null);
      }
    },
    [state, dispatch, createCheckpoint]
  );

  return { regenerate, loadingId, error };
}

const REGENERATE_ALL_BATCH_SIZE = 6;

export function useRegenerateAllHooks(
  state: WorkflowState,
  dispatch: Dispatch<WorkflowAction>
) {
  const createCheckpoint = useOptionalWorkspace()?.createCheckpoint;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const regenerateAll = useCallback(
    async (tone: string) => {
      const normalizedTone = tone.trim();
      if (!normalizedTone) {
        setError("Add the new writing tone first.");
        return false;
      }

      setLoading(true);
      setError(null);

      try {
        const replacementsByIndex = new Map<
          number,
          WorkflowState["directions"][number]
        >();
        const directionGroups = new Map<
          string,
          {
            service: ServiceType;
            model: HookGenerationModel;
            items: {
              direction: WorkflowState["directions"][number];
              index: number;
            }[];
          }
        >();
        state.directions.forEach((direction, index) => {
          const service = directionServiceAt(state, direction, index);
          const model =
            direction.generationModel ?? state.hookGenerationModel;
          const key = `${service}:${model}`;
          const group = directionGroups.get(key) ?? {
            service,
            model,
            items: []
          };
          group.items.push({ direction, index });
          directionGroups.set(key, group);
        });

        for (const { service, model, items } of directionGroups.values()) {
          for (
            let offset = 0;
            offset < items.length;
            offset += REGENERATE_ALL_BATCH_SIZE
          ) {
          const batch = items.slice(offset, offset + REGENERATE_ALL_BATCH_SIZE);
          const originals = batch.map((item) => item.direction);
          const targetedState: WorkflowState = {
            ...state,
            hookGenerationModel: model,
            hookGenerationModels: [model],
            service,
            quantity: originals.length,
            creativeMix: [
              {
                id: `regenerate-all-${service}`,
                service,
                quantity: originals.length
              }
            ]
          };
          const originalList = originals
            .map(
              (direction, index) =>
                `${index + 1}. Hook: ${direction.hook}\nConcept: ${direction.concept}`
            )
            .join("\n\n");
          const extraInstructions = withCreativeMixInstructions(targetedState, [
            `Regenerate these ${originals.length} existing hooks in the same order instead of creating unrelated ideas:`,
            originalList,
            `New writing tone for every hook: ${normalizedTone}`,
            "For each hook, keep its strategic idea, audience tension, product truth, and CTA intent.",
            `Return at least ${originals.length} replacements in the same numbered order.`
          ].join("\n"));
          const generated = await generateDirectionsForState(
            targetedState,
            extraInstructions
          );

          if (generated.length < originals.length) {
            throw new Error(
              `Regeneration returned ${generated.length} of ${originals.length} required hooks.`
            );
          }
          generated.slice(0, originals.length).forEach((direction, index) => {
            const originalIndex = batch[index]?.index;
            if (originalIndex !== undefined) {
              replacementsByIndex.set(originalIndex, direction);
            }
          });
          }
        }

        const replacements = state.directions.map(
          (_, index) => replacementsByIndex.get(index)
        );
        if (replacements.some((direction) => direction === undefined)) {
          throw new Error("Regeneration did not return every required hook.");
        }

        await createCheckpoint?.("regenerate", state.id);
        dispatch({
          type: "replace-directions",
          directions: replacements.filter(
            (direction): direction is WorkflowState["directions"][number] =>
              direction !== undefined
          )
        });
        playGenerationSuccessSound();
        return true;
      } catch (caught: unknown) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not regenerate all hooks."
        );
        return false;
      } finally {
        setLoading(false);
      }
    },
    [state, dispatch, createCheckpoint]
  );

  return { regenerateAll, loading, error };
}
