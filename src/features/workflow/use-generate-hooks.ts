import { useCallback, useState, type Dispatch } from "react";
import { env } from "../../config/env";
import { generateDirectionsWithHarness } from "../../services/creative-generation/harness-hook-generation";
import { generateDirectionsFromWebhook } from "../../services/creative-generation/n8n-hook-generation";
import { playGenerationSuccessSound } from "../../shared/utils/notification-sound";
import { serviceLabels } from "./config";
import {
  creativeMixContentTypeQuotas,
  creativeMixItems,
  totalCreativeMixQuantity,
  type WorkflowAction,
  type WorkflowState
} from "./model";

export function buildSuccessMetricInstructions(
  metric: WorkflowState["successMetric"]
): string {
  return `Primary success metric: ${metric}. Make the angle support this outcome without inventing performance claims.`;
}

export function buildCreativeMixInstructions(state: WorkflowState): string {
  const mix = creativeMixItems(state)
    .map((item) => `${serviceLabels[item.service]} × ${item.quantity}`)
    .join("; ");
  return `Creative mix: ${mix}. Generate ${totalCreativeMixQuantity(state)} hooks in total so each requested deliverable can use one hook.`;
}

function withCreativeMixInstructions(
  state: WorkflowState,
  instructions: string
): string {
  return [buildCreativeMixInstructions(state), instructions]
    .filter(Boolean)
    .join("\n");
}

export function useGenerateHooks(
  state: WorkflowState,
  dispatch: Dispatch<WorkflowAction>
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(() => {
    setLoading(true);
    setError(null);

    const extraInstructions = withCreativeMixInstructions(
      state,
      buildSuccessMetricInstructions(state.successMetric)
    );

    const generation =
      env.hookGenerationMode === "harness"
        ? generateDirectionsWithHarness({ run: state, extraInstructions })
        : generateDirectionsFromWebhook({
            brand: state.brand,
            service: creativeMixItems(state)[0]?.service ?? state.service,
            quantity: totalCreativeMixQuantity(state),
            contentTypeQuotas: creativeMixContentTypeQuotas(state),
            brief: state.brief,
            extraInstructions
          });

    void generation
      .then((directions) => {
        dispatch({ type: "generate-directions", directions });
        playGenerationSuccessSound();
      })
      .catch((caught: unknown) => {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not generate hooks."
        );
      })
      .finally(() => {
        setLoading(false);
      });
  }, [state, dispatch]);

  return { generate, loading, error };
}

export function useGenerateMoreHooks(
  state: WorkflowState,
  dispatch: Dispatch<WorkflowAction>
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateMore = useCallback(
    (extraInstructions: string) => {
      setLoading(true);
      setError(null);

      const existingHooks = state.directions.map((direction) => ({
        hook: direction.hook,
        concept: direction.concept
      }));

      const combinedInstructions = withCreativeMixInstructions(
        state,
        extraInstructions
      );
      const generation =
        env.hookGenerationMode === "harness"
          ? generateDirectionsWithHarness({
              run: state,
              extraInstructions: combinedInstructions
            })
          : generateDirectionsFromWebhook({
              brand: state.brand,
              service: creativeMixItems(state)[0]?.service ?? state.service,
              quantity: totalCreativeMixQuantity(state),
              contentTypeQuotas: creativeMixContentTypeQuotas(state),
              brief: state.brief,
              extraInstructions: combinedInstructions,
              existingHooks
            });

      void generation
        .then((directions) => {
          dispatch({ type: "generate-more-directions", directions });
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
          setLoading(false);
        });
    },
    [state, dispatch]
  );

  return { generateMore, loading, error };
}

export function useRegenerateHook(
  state: WorkflowState,
  dispatch: Dispatch<WorkflowAction>
) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const regenerate = useCallback(
    async (direction: WorkflowState["directions"][number], tone: string) => {
      const normalizedTone = tone.trim();
      if (!normalizedTone) {
        setError("Add the new writing tone first.");
        return false;
      }

      setLoadingId(direction.id);
      setError(null);

      const extraInstructions = withCreativeMixInstructions(state, [
        "Regenerate one existing hook instead of creating an unrelated idea.",
        `Original hook: ${direction.hook}`,
        `Original concept: ${direction.concept}`,
        `New writing tone: ${normalizedTone}`,
        "Keep the same strategic idea, audience tension, product truth, and CTA intent.",
        "Rewrite the hook and supporting copy in the new tone. Return the replacement as the first direction."
      ].join("\n"));

      const existingHooks = state.directions.map((item) => ({
        hook: item.hook,
        concept: item.concept
      }));

      const generation =
        env.hookGenerationMode === "harness"
          ? generateDirectionsWithHarness({ run: state, extraInstructions })
          : generateDirectionsFromWebhook({
              brand: state.brand,
              service: creativeMixItems(state)[0]?.service ?? state.service,
              quantity: totalCreativeMixQuantity(state),
              contentTypeQuotas: creativeMixContentTypeQuotas(state),
              brief: state.brief,
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
          const generated =
            env.hookGenerationMode === "harness"
              ? await generateDirectionsWithHarness({
                  run: state,
                  extraInstructions
                })
              : await generateDirectionsFromWebhook({
                  brand: state.brand,
                  service: creativeMixItems(state)[0]?.service ?? state.service,
                  quantity: totalCreativeMixQuantity(state),
                  contentTypeQuotas: creativeMixContentTypeQuotas(state),
                  brief: state.brief,
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
