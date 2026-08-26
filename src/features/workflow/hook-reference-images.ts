import type {
  CreativeDirection,
  ReferenceImageSelection,
  UploadedCreativeMaterial
} from "../../domain/creative-run";

export interface HookReferenceBatch<T> {
  hooks: readonly T[];
  references: readonly ReferenceImageSelection[];
  materials: readonly UploadedCreativeMaterial[];
}

/**
 * Keeps ordinary Hooks batched while isolating Hooks with their own reference
 * or their own materials. This prevents one Hook's image from influencing
 * artwork generated for another.
 */
export function batchHooksByReferenceImage<
  T extends Pick<CreativeDirection, "referenceImages" | "uploadedMaterials">
>(hooks: readonly T[], batchSize: number): readonly HookReferenceBatch<T>[] {
  const batches: HookReferenceBatch<T>[] = [];
  let ordinaryHooks: T[] = [];

  const flushOrdinaryHooks = () => {
    while (ordinaryHooks.length) {
      batches.push({
        hooks: ordinaryHooks.slice(0, batchSize),
        references: [],
        materials: []
      });
      ordinaryHooks = ordinaryHooks.slice(batchSize);
    }
  };

  hooks.forEach((hook) => {
    const hasOwnAssets = Boolean(
      hook.referenceImages?.length || hook.uploadedMaterials?.length
    );
    if (!hasOwnAssets) {
      ordinaryHooks.push(hook);
      if (ordinaryHooks.length === batchSize) flushOrdinaryHooks();
      return;
    }

    flushOrdinaryHooks();
    batches.push({
      hooks: [hook],
      references: hook.referenceImages ?? [],
      materials: hook.uploadedMaterials ?? []
    });
  });
  flushOrdinaryHooks();

  return batches;
}
