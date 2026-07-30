import { useCallback, useState, type Dispatch } from "react";
import { useOptionalWorkspace } from "../../app/providers/workspace-provider";
import {
  artworkReferencesFromSelections,
  generateArtworkForSelectedHooks
} from "../../services/artwork-generation/openai-image-generation";
import type { BrandMemoryRepository } from "../../ports/brand-memory-repository";
import { playGenerationSuccessSound } from "../../shared/utils/notification-sound";
import {
  defaultArtworkContextSelection,
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
        personality: selection.brandCi ? run.brand.personality : [],
        colors: selection.brandColors ? run.brand.colors : [],
        memory: selection.brandCi
          ? run.brand.memory
          : { working: [], avoid: [] },
        library: {
          ...run.brand.library,
          brand: run.brand.library.brand.filter((item) => {
            const colorRule = isBrandColorRule(item.title);
            if (!selection.brandColors && colorRule) return false;
            if (!selection.brandCi && !colorRule) return false;
            return true;
          }),
          docs: selection.brandCi ? run.brand.library.docs : [],
          refs: selection.imageReferences ? run.brand.library.refs : []
        }
      }
    : null;

  return {
    ...run,
    brand,
    artworkBrief: selection.artworkBrief ? run.artworkBrief : "",
    referenceImages: selection.imageReferences ? run.referenceImages : [],
    uploadedMaterials: selection.imageMaterials ? run.uploadedMaterials : []
  };
}

export function useCreateSelectedHooks(
  state: WorkflowState,
  dispatch: Dispatch<WorkflowAction>,
  brandMemoryRepository?: Pick<BrandMemoryRepository, "listBrandRules">
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
          const items = await brandMemoryRepository.listBrandRules(
            state.brand.id
          );
          dispatch({ type: "sync-brand-rules", items });
          run = {
            ...state,
            brand: {
              ...state.brand,
              library: { ...state.brand.library, brand: items }
            }
          };
        }
        run = applyArtworkContextSelection(run, contextSelection);

        return generateArtworkForSelectedHooks({
          run,
          referenceImages: artworkReferencesFromSelections(run.referenceImages),
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
