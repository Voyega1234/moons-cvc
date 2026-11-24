import { env } from "../../config/env";
import type { BrandAssetFolder, BrandAssetImage } from "../../domain/brand-memory";
import type {
  CreativeDirection,
  UploadedCreativeMaterial
} from "../../domain/creative-run";
import { getSupabaseClient } from "../../lib/supabase/client";
import type { BrandMemoryRepository } from "../../ports/brand-memory-repository";

export type MaterialAiRepository = Pick<
  BrandMemoryRepository,
  "listAssetImages" | "listAssetFolders" | "updateAssetImageLabel"
>;

/** "Products / Serum" style path for an asset's folder; "" at the library root. */
export function assetFolderPath(
  folderId: string | null,
  folders: readonly BrandAssetFolder[]
): string {
  const names: string[] = [];
  const seen = new Set<string>();
  let current = folders.find((folder) => folder.id === folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = folders.find((folder) => folder.id === current!.parentId);
  }
  return names.join(" / ");
}

const MAX_BACKFILL = 40;
const BACKFILL_CONCURRENCY = 4;

async function callMaterialAi<T>(body: object): Promise<T> {
  const { data } = await getSupabaseClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in before using Material AI.");
  const response = await fetch(`${env.apiBaseUrl}/material-ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(170_000)
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true) {
    throw new Error(typeof result.error === "string" ? result.error : "Material AI failed.");
  }
  return result as T;
}

/** Asks GPT Luna what the image shows and saves it on the asset. Never throws. */
export async function labelMaterialAsset(
  asset: BrandAssetImage,
  repository: Pick<BrandMemoryRepository, "updateAssetImageLabel">
): Promise<BrandAssetImage> {
  if (asset.kind !== "material" || asset.aiLabel) return asset;
  try {
    const { label } = await callMaterialAi<{ label: string }>({
      action: "label",
      storagePath: asset.storagePath
    });
    await repository.updateAssetImageLabel(asset.id, label);
    return { ...asset, aiLabel: label };
  } catch (caught) {
    console.warn(`Could not label material ${asset.name}.`, caught);
    return asset;
  }
}

/** Labels assets with a small concurrency limit; reports each one as it finishes. */
export async function labelMaterialAssets(
  assets: readonly BrandAssetImage[],
  repository: Pick<BrandMemoryRepository, "updateAssetImageLabel">,
  onLabeled?: (asset: BrandAssetImage) => void
): Promise<readonly BrandAssetImage[]> {
  const results: BrandAssetImage[] = [...assets];
  let next = 0;
  const worker = async () => {
    while (next < assets.length) {
      const index = next++;
      const labeled = await labelMaterialAsset(assets[index]!, repository);
      results[index] = labeled;
      if (labeled !== assets[index]) onLabeled?.(labeled);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(BACKFILL_CONCURRENCY, assets.length) }, worker)
  );
  return results;
}

export function assetToHookMaterial(asset: BrandAssetImage): UploadedCreativeMaterial {
  return {
    id: `brand-asset-${asset.id}`,
    name: asset.name,
    mediaType: asset.mimeType,
    role: "main-object",
    description: asset.aiLabel ?? "",
    url: asset.url,
    storagePath: asset.storagePath,
    storageBucket: env.brandAssetsBucket
  };
}

/**
 * Picks library Materials for each idea. Unlabeled library images are labeled
 * first (capped), then Luna matches ideas to labels. Returns only non-empty picks.
 */
export async function suggestMaterialsForHooks({
  clientId,
  hooks,
  repository
}: {
  clientId: string;
  hooks: readonly Pick<CreativeDirection, "id" | "hook" | "concept">[];
  repository: MaterialAiRepository;
}): Promise<readonly { id: string; materials: readonly UploadedCreativeMaterial[] }[]> {
  const [images, folders] = await Promise.all([
    repository.listAssetImages(clientId),
    repository.listAssetFolders(clientId)
  ]);
  const library = images.filter((asset) => asset.kind === "material");
  const unlabeled = library.filter((asset) => !asset.aiLabel).slice(0, MAX_BACKFILL);
  const labeledNow = new Map(
    (await labelMaterialAssets(unlabeled, repository)).map((asset) => [asset.id, asset])
  );
  const assets = library
    .map((asset) => labeledNow.get(asset.id) ?? asset)
    .filter((asset) => asset.aiLabel);
  if (!assets.length || !hooks.length) return [];

  const { assignments } = await callMaterialAi<{
    assignments: { hookId: string; materialIds: string[] }[];
  }>({
    action: "match",
    hooks: hooks.map(({ id, hook, concept }) => ({ id, hook, concept })),
    materials: assets.map((asset) => ({
      id: asset.id,
      label: asset.aiLabel,
      folder: assetFolderPath(asset.folderId, folders)
    }))
  });
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  return assignments.flatMap(({ hookId, materialIds }) => {
    const materials = materialIds.flatMap((id) => {
      const asset = byId.get(id);
      return asset ? [assetToHookMaterial(asset)] : [];
    });
    return materials.length ? [{ id: hookId, materials }] : [];
  });
}
