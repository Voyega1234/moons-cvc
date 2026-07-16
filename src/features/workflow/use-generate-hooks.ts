import { useCallback, useState, type Dispatch } from "react";
import { env } from "../../config/env";
import type { ServiceType } from "../../domain/creative-run";
import { generateDirectionsWithHarness } from "../../services/creative-generation/harness-hook-generation";
import { generateDirectionsFromWebhook } from "../../services/creative-generation/n8n-hook-generation";
import { playGenerationSuccessSound } from "../../shared/utils/notification-sound";
import { serviceLabels } from "./config";
import {
  creativeMixContentTypeQuotas,
  EXTRA_HOOK_CANDIDATES_PER_TYPE,
  hookGenerationContentTypeQuotas,
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
  const generationQuotas = hookGenerationContentTypeQuotas(state);
  const requestedMix = requestedQuotas
    .map((item) => `${serviceLabels[item.service]} × ${item.count}`)
    .join("; ");
  const candidateMix = generationQuotas
    .map((item) => `${serviceLabels[item.service]} × ${item.count}`)
    .join("; ");
  return `Creative mix quota: ${requestedMix}. Generate ${totalHookGenerationQuantity(state)} hook candidates in total. Candidate pool by content type: ${candidateMix}. Always generate 2 extra candidates for every active content type.`;
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

    const contentTypeQuotas = hookGenerationContentTypeQuotas(state);
    const generation = Promise.resolve().then(() =>
      env.hookGenerationMode === "harness"
        ? generateDirectionsWithHarness({ run: state, extraInstructions })
        : generateDirectionsFromWebhook({
            brand: state.brand,
            service: contentTypeQuotas[0]?.service ?? state.service,
            quantity: totalHookGenerationQuantity(state),
            contentTypeQuotas,
            brief: state.brief,
            uploadedMaterials: state.uploadedMaterials,
            extraInstructions
          })
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
    (service: ServiceType) => {
      setLoadingService(service);
      setError(null);

      const existingHooks = state.directions.map((direction) => ({
        hook: direction.hook,
        concept: direction.concept
      }));

      const requestedQuantity = Math.max(
        1,
        GENERATE_MORE_IDEA_COUNT - EXTRA_HOOK_CANDIDATES_PER_TYPE
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
      const combinedInstructions = withCreativeMixInstructions(
        targetedState,
        [
          `Generate additional ${contentTypeLabel} hook ideas only.`,
          `Every returned direction must use the ${contentTypeLabel} content type.`,
          "Make each new idea meaningfully different from the existing hooks."
        ].join("\n")
      );
      const contentTypeQuotas = hookGenerationContentTypeQuotas(targetedState);
      const generation =
        env.hookGenerationMode === "harness"
          ? generateDirectionsWithHarness({
              run: targetedState,
              extraInstructions: combinedInstructions
            })
          : generateDirectionsFromWebhook({
              brand: targetedState.brand,
              service,
              quantity: totalHookGenerationQuantity(targetedState),
              contentTypeQuotas,
              brief: targetedState.brief,
              uploadedMaterials: targetedState.uploadedMaterials,
              extraInstructions: combinedInstructions,
              existingHooks
            });

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

      const extraInstructions = withCreativeMixInstructions(state, [
        "Regenerate one existing hook instead of creating an unrelated idea.",
        `Original hook: ${direction.hook}`,
        `Original concept: ${direction.concept}`,
        `Rewrite feedback: ${normalizedFeedback}`,
        "Keep the same strategic idea, audience tension, product truth, and CTA intent.",
        "Apply the feedback to the hook and supporting copy. Return the replacement as the first direction."
      ].join("\n"));

      const existingHooks = state.directions.map((item) => ({
        hook: item.hook,
        concept: item.concept
      }));
      const contentTypeQuotas = hookGenerationContentTypeQuotas(state);

      const generation =
        env.hookGenerationMode === "harness"
          ? generateDirectionsWithHarness({ run: state, extraInstructions })
          : generateDirectionsFromWebhook({
              brand: state.brand,
              service: contentTypeQuotas[0]?.service ?? state.service,
              quantity: totalHookGenerationQuantity(state),
              contentTypeQuotas,
              brief: state.brief,
              uploadedMaterials: state.uploadedMaterials,
              extraInstructions,
              existingHooks
            });

      try {
        const directions = await generation;
        const replacement = directions[0];
        if (!replacement) throw new Error("Hook regeneration returned no hook.");
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
    [state, dispatch]
  );

  return { regenerate, loadingId, error };
}

const REGENERATE_ALL_BATCH_SIZE = 6;

export function useRegenerateAllHooks(
  state: WorkflowState,
  dispatch: Dispatch<WorkflowAction>
) {
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
        const replacements = [];
        for (
          let offset = 0;
          offset < state.directions.length;
          offset += REGENERATE_ALL_BATCH_SIZE
        ) {
          const originals = state.directions.slice(
            offset,
            offset + REGENERATE_ALL_BATCH_SIZE
          );
          const originalList = originals
            .map(
              (direction, index) =>
                `${index + 1}. Hook: ${direction.hook}\nConcept: ${direction.concept}`
            )
            .join("\n\n");
          const extraInstructions = withCreativeMixInstructions(state, [
            `Regenerate these ${originals.length} existing hooks in the same order instead of creating unrelated ideas:`,
            originalList,
            `New writing tone for every hook: ${normalizedTone}`,
            "For each hook, keep its strategic idea, audience tension, product truth, and CTA intent.",
            `Return at least ${originals.length} replacements in the same numbered order.`
          ].join("\n"));
          const existingHooks = state.directions.map((direction) => ({
            hook: direction.hook,
            concept: direction.concept
          }));
          const contentTypeQuotas = hookGenerationContentTypeQuotas(state);
          const generated =
            env.hookGenerationMode === "harness"
              ? await generateDirectionsWithHarness({
                  run: state,
                  extraInstructions
                })
              : await generateDirectionsFromWebhook({
                  brand: state.brand,
                  service: contentTypeQuotas[0]?.service ?? state.service,
                  quantity: totalHookGenerationQuantity(state),
                  contentTypeQuotas,
                  brief: state.brief,
                  uploadedMaterials: state.uploadedMaterials,
                  extraInstructions,
                  existingHooks
                });

          if (generated.length < originals.length) {
            throw new Error(
              `Regeneration returned ${generated.length} of ${originals.length} required hooks.`
            );
          }
          replacements.push(...generated.slice(0, originals.length));
        }

        dispatch({ type: "replace-directions", directions: replacements });
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
    [state, dispatch]
  );

  return { regenerateAll, loading, error };
}
