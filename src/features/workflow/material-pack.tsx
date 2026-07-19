import { useEffect, useMemo, useState } from "react";
import {
  DownloadSimple,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  X
} from "@phosphor-icons/react";
import { useBrandMemoryRepository } from "../../app/providers/brand-memory-provider";
import type { LibraryItem } from "../../domain/brand";
import type { BrandDocument } from "../../domain/brand-memory";
import type { WorkflowState } from "./model";

interface MaterialAsset {
  id: string;
  label: string;
  url: string;
  group: "Brand" | "References" | "Product / client images" | "Documents";
  mimeType?: string | null;
}

const MATERIAL_GROUPS: readonly MaterialAsset["group"][] = [
  "Brand",
  "References",
  "Product / client images",
  "Documents"
];

export function WorkflowMaterialPack({ state }: { state: WorkflowState }) {
  const repository = useBrandMemoryRepository();
  const [open, setOpen] = useState(false);
  const [brandRules, setBrandRules] = useState<readonly LibraryItem[]>([]);
  const [documents, setDocuments] = useState<readonly BrandDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clientId = state.brand?.id;

  useEffect(() => {
    if (!open || !clientId) return;
    let active = true;
    setLoading(true);
    setError(null);
    void Promise.all([
      repository.listBrandRules(clientId),
      repository.listDocuments(clientId)
    ])
      .then(([rules, nextDocuments]) => {
        if (!active) return;
        setBrandRules(rules);
        setDocuments(nextDocuments);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not load the material pack."
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [clientId, open, repository]);

  const assets = useMemo(
    () => materialAssets(state, brandRules, documents),
    [brandRules, documents, state]
  );
  const visibleCount = assets.length || quickMaterialCount(state);

  if (!state.brand) return null;

  async function download(asset: MaterialAsset) {
    setDownloadingId(asset.id);
    setError(null);
    try {
      await downloadMaterialAsset(asset);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not download this file."
      );
    } finally {
      setDownloadingId(null);
    }
  }

  async function downloadAll() {
    setDownloadingId("all");
    setError(null);
    try {
      for (const asset of assets) {
        await downloadMaterialAsset(asset);
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not download every material."
      );
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <>
      <div className="compass-project-material-bar">
        <button
          className="compass-project-material-button"
          type="button"
          onClick={() => setOpen(true)}
        >
          <FolderOpen size={18} weight="duotone" aria-hidden="true" />
          <span>
            <b>Material pack</b>
            <small>Download original files before editing</small>
          </span>
          <strong>{visibleCount}</strong>
        </button>
      </div>

      {open ? (
        <div
          className="output-modal-backdrop compass-material-pack-backdrop"
          onClick={() => setOpen(false)}
        >
          <section
            className="output-modal compass-material-pack-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="material-pack-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="compass-material-pack-head">
              <div>
                <span>GD working files</span>
                <h3 id="material-pack-title">{state.brand.name} material pack</h3>
                <p>Download the original files used to build this creative set.</p>
              </div>
              <div>
                <button
                  className="btn secondary"
                  type="button"
                  disabled={!assets.length || Boolean(downloadingId)}
                  onClick={() => void downloadAll()}
                >
                  <DownloadSimple size={17} weight="bold" aria-hidden="true" />
                  {downloadingId === "all" ? "Downloading…" : "Download all"}
                </button>
                <button
                  className="compass-material-pack-close"
                  type="button"
                  aria-label="Close material pack"
                  onClick={() => setOpen(false)}
                >
                  <X size={18} weight="bold" aria-hidden="true" />
                </button>
              </div>
            </header>

            <div className="compass-material-pack-body">
              {loading ? (
                <div className="compass-material-pack-empty">Loading materials…</div>
              ) : assets.length ? (
                MATERIAL_GROUPS.map((group) => {
                  const groupAssets = assets.filter((asset) => asset.group === group);
                  if (!groupAssets.length) return null;
                  return (
                    <section className="compass-material-pack-group" key={group}>
                      <header>
                        <h4>{group}</h4>
                        <span>{groupAssets.length}</span>
                      </header>
                      <div>
                        {groupAssets.map((asset) => (
                          <article className="compass-material-pack-item" key={asset.id}>
                            <span className="compass-material-pack-thumb">
                              {isImageAsset(asset) ? (
                                <img src={asset.url} alt="" />
                              ) : (
                                <FileText size={22} weight="duotone" aria-hidden="true" />
                              )}
                            </span>
                            <span>
                              <b>{asset.label}</b>
                              <small>{asset.group}</small>
                            </span>
                            <button
                              className="btn secondary small"
                              type="button"
                              disabled={Boolean(downloadingId)}
                              onClick={() => void download(asset)}
                            >
                              <DownloadSimple size={15} weight="bold" aria-hidden="true" />
                              {downloadingId === asset.id ? "Downloading…" : "Download"}
                            </button>
                          </article>
                        ))}
                      </div>
                    </section>
                  );
                })
              ) : (
                <div className="compass-material-pack-empty">
                  <ImageIcon size={24} weight="duotone" aria-hidden="true" />
                  <b>No downloadable materials yet.</b>
                  <span>Add a logo, reference, document, or product image in Brief materials.</span>
                </div>
              )}

              {state.attachments.length ? (
                <div className="compass-material-pack-filename-note">
                  <b>File names recorded in this brief</b>
                  <span>{state.attachments.join(", ")}</span>
                  <small>
                    These older attachments contain file names only. Upload the source file to make it downloadable.
                  </small>
                </div>
              ) : null}
              {error ? <p className="repository-message error">{error}</p> : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function quickMaterialCount(state: WorkflowState): number {
  return (
    state.referenceImages.length +
    state.uploadedMaterials.length +
    state.brand!.library.docs.filter((item) => item.assetUrl).length
  );
}

function materialAssets(
  state: WorkflowState,
  rules: readonly LibraryItem[],
  documents: readonly BrandDocument[]
): MaterialAsset[] {
  const candidates: MaterialAsset[] = [];
  const logo = rules.find(
    (rule) => rule.title.trim().toLowerCase() === "logo" && rule.assetUrl
  );
  if (logo?.assetUrl) {
    candidates.push({
      id: `logo-${logo.id}`,
      label: logo.title || "Brand logo",
      url: logo.assetUrl,
      group: "Brand"
    });
  }

  state.referenceImages.forEach((reference) => {
    candidates.push({
      id: `reference-${reference.id}`,
      label: reference.label,
      url: reference.url,
      group: "References"
    });
  });
  state.uploadedMaterials.forEach((material) => {
    candidates.push({
      id: `upload-${material.id}`,
      label: material.name,
      url: material.url,
      group: "Product / client images",
      mimeType: material.mediaType
    });
  });
  documents.forEach((document) => {
    if (!document.fileUrl) return;
    candidates.push({
      id: `document-${document.id}`,
      label: document.title,
      url: document.fileUrl,
      group: "Documents",
      mimeType: document.mimeType
    });
  });
  state.brand?.library.docs.forEach((document) => {
    if (!document.assetUrl) return;
    candidates.push({
      id: `library-document-${document.id}`,
      label: document.title,
      url: document.assetUrl,
      group: "Documents"
    });
  });

  const seen = new Set<string>();
  return candidates.filter((asset) => {
    if (seen.has(asset.url)) return false;
    seen.add(asset.url);
    return true;
  });
}

function isImageAsset(asset: MaterialAsset): boolean {
  if (asset.mimeType) return asset.mimeType.startsWith("image/");
  return /\.(png|jpe?g|webp|gif|avif)(?:\?|$)/i.test(asset.url);
}

async function downloadMaterialAsset(asset: MaterialAsset): Promise<void> {
  const response = await fetch(asset.url);
  if (!response.ok) {
    throw new Error(`Could not download ${asset.label} (${response.status}).`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = materialFileName(asset, blob);
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function materialFileName(asset: MaterialAsset, blob: Blob): string {
  const cleanLabel = asset.label
    .trim()
    .replace(/[^a-z0-9ก-๙]+/gi, "-")
    .replace(/^-|-$/g, "") || "material";
  const pathname = (() => {
    try {
      return new URL(asset.url).pathname;
    } catch {
      return asset.url;
    }
  })();
  const urlExtension = /\.([a-z0-9]{2,5})$/i.exec(pathname)?.[1];
  const mimeExtension = blob.type.split("/")[1]?.replace("jpeg", "jpg");
  return `${cleanLabel}.${urlExtension ?? mimeExtension ?? "bin"}`;
}
