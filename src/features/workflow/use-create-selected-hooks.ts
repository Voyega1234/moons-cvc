import { useCallback, useState, type Dispatch } from "react";
import { useOptionalWorkspace } from "../../app/providers/workspace-provider";
import { generateArtworkForSelectedHooks } from "../../services/artwork-generation/openai-image-generation";
import { activeBrandKitItems } from "../../domain/brand";
import { CREATIVE_APPROVAL_DOCUMENT_TITLE } from "../../domain/creative-approval";
import {
  inferredReferenceImageRole,
  normalizeUserSelectableArtworkMode,
  syncSharedReferenceImagesIntoDirections
} from "../../domain/creative-run";
import type { BrandMemoryRepository } from "../../ports/brand-memory-repository";
import { playGenerationSuccessSound } from "../../shared/utils/notification-sound";
import {
  defaultArtworkContextSelection,
  ugcVideoDirectionIds,
  type ArtworkContextSelection,
  type WorkflowAction,
  type WorkflowState
} from "./model";

function applyArtworkContextSelection(
  run: WorkflowState,
  selection: ArtworkContextSelection
): WorkflowState {
  const isBrandColorRule = (title: string) =>
    ["colors", "primarycolors", "secondarycolors"].includes(
      title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")
    );
  const brand = run.brand
      ? {
        ...run.brand,
        memory: selection.brandCi
          ? run.brand.memory
          : { working: [], avoid: [] },
        library: {
          ...run.brand.library,
          brand: activeBrandKitItems(run.brand.library.brand).filter((item) => {
            const colorRule = isBrandColorRule(item.title);
            if (!selection.brandColors && colorRule) return false;
            if (!selection.brandCi && !colorRule) return false;
            return true;
          }),
          docs: selection.brandCi ? run.brand.library.docs.map(item => {
            if (selection.brandColors || item.title !== CREATIVE_APPROVAL_DOCUMENT_TITLE) return item;
            try {
              const context = JSON.parse(item.description);
              if (!Array.isArray(context.examples)) return item;
              return { ...item, description: JSON.stringify({ ...context, examples: context.examples.map((example: Record<string, unknown>) => ({ ...example, visualStyle: { ...(example.visualStyle as object), colors: [] } })) }) };
            } catch { return item; }
          }) : [],
          refs: selection.imageReferences ? run.brand.library.refs : []
        }
      }
    : null;

  return {
    ...run,
    brand,
    artworkBrief: selection.artworkBrief ? run.artworkBrief : "",
    referenceImages: selection.imageReferences
      ? run.referenceImages.filter(
          (reference) => inferredReferenceImageRole(reference) !== "logo"
        )
      : [],
    uploadedMaterials: selection.imageMaterials ? run.uploadedMaterials : []
  };
}

export function useCreateSelectedHooks(
  state: WorkflowState,
  dispatch: Dispatch<WorkflowAction>,
  brandMemoryRepository?: Pick<BrandMemoryRepository, "listBrandRules"> & Partial<Pick<BrandMemoryRepository, "listGuidelines">>
) {
  const createCheckpoint = useOptionalWorkspace()?.createCheckpoint;
  const [progress, setProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const loading = state.artworkGenerationStatus === "running";
  const error =
    state.artworkGenerationStatus === "failed"
      ? state.artworkGenerationError
      : null;

  const create = useCallback(
    (
      contextSelection: ArtworkContextSelection =
        defaultArtworkContextSelection
    ) => {
      if (state.artworkGenerationStatus === "running") return;
      setProgress({ completed: 0, total: 0 });
      dispatch({ type: "start-artwork-generation" });

      const generation = async () => {
        let run = state;
        if (state.brand && brandMemoryRepository) {
          const [items, documents] = await Promise.all([
            brandMemoryRepository.listBrandRules(state.brand.id),
            brandMemoryRepository.listGuidelines?.(state.brand.id) ?? Promise.resolve(state.brand.library.docs)
          ]);
          dispatch({ type: "sync-brand-rules", items });
          if (brandMemoryRepository.listGuidelines) dispatch({ type: "sync-brand-guidelines", items: documents });
          run = {
            ...state,
            brand: {
              ...state.brand,
              library: { ...state.brand.library, brand: items, docs: documents }
            }
          };
        }
        run = applyArtworkContextSelection(run, contextSelection);
        run = {
          ...run,
          artworkMode: normalizeUserSelectableArtworkMode(run.artworkMode)
        };

        {
          const directions = syncSharedReferenceImagesIntoDirections(
            run.directions,
            run.referenceImages,
            { excludeDirectionIds: ugcVideoDirectionIds(run) }
          );
          directions.forEach((direction, index) => {
            if (direction === run.directions[index]) return;
            dispatch({
              type: "set-direction-reference-images",
              id: direction.id,
              images: direction.referenceImages ?? []
            });
          });
          run = { ...run, directions };
        }

        return generateArtworkForSelectedHooks({
          run,
          onProgress: (completed, total) => setProgress({ completed, total }),
          onBatch: (outputs) =>
            dispatch({ type: "append-artwork-generation-outputs", outputs })
        });
      };

      void generation()
        .then(async (outputs) => {
          if (state.outputs.length) {
            await createCheckpoint?.("regenerate", state.id);
          }
          dispatch({ type: "create-outputs", outputs });
          playGenerationSuccessSound();
        })
        .catch((caught: unknown) => {
          setProgress(null);
          dispatch({
            type: "fail-artwork-generation",
            message:
              caught instanceof Error
                ? caught.message
                : "Could not create selected hooks."
          });
        });
    },
    [state, dispatch, createCheckpoint, brandMemoryRepository]
  );

  return { create, loading, error, progress };
}
