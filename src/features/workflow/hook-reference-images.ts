import type {
  CreativeDirection,
  ReferenceImageSelection
} from "../../domain/creative-run";

export interface HookReferenceBatch<T> {
  hooks: readonly T[];
  references: readonly ReferenceImageSelection[];
}

/**
 * Keeps ordinary Hooks batched while isolating Hooks with their own reference.
 * This prevents one Hook's image from influencing artwork generated for another.
 */
export function batchHooksByReferenceImage<
  T extends Pick<CreativeDirection, "referenceImages">
>(hooks: readonly T[], batchSize: number): readonly HookReferenceBatch<T>[] {
  const batches: HookReferenceBatch<T>[] = [];
  let ordinaryHooks: T[] = [];

  const flushOrdinaryHooks = () => {
    while (ordinaryHooks.length) {
      batches.push({
        hooks: ordinaryHooks.slice(0, batchSize),
        references: []
      });
      ordinaryHooks = ordinaryHooks.slice(batchSize);
    }
  };

  hooks.forEach((hook) => {
    if (!hook.referenceImages?.length) {
      ordinaryHooks.push(hook);
      if (ordinaryHooks.length === batchSize) flushOrdinaryHooks();
      return;
    }

    flushOrdinaryHooks();
    batches.push({ hooks: [hook], references: hook.referenceImages });
  });
  flushOrdinaryHooks();

  return batches;
}
