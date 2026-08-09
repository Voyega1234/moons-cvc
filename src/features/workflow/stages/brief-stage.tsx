import { useEffect, useId, useRef, useState, type ChangeEvent, type Dispatch, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, FolderSimple, ImageBroken, PencilSimple, Trash } from "@phosphor-icons/react";
import { type LibraryItem } from "../../../domain/brand";
import { env } from "../../../config/env";
import { type BrandAssetFolder, type BrandAssetImage, type BrandAssetKind, type BrandPastWorkItem, type BrandProduct } from "../../../domain/brand-memory";
import { creativeMaterialRoles, inferredReferenceImageRole, type CreativeMaterialRole, type UploadedCreativeMaterial, type ReferenceImageRole, type ReferenceImageSelection, type ServiceType } from "../../../domain/creative-run";
import { useBrandMemoryRepository } from "../../../app/providers/brand-memory-provider";
import { useOptionalAuth } from "../../../app/providers/auth-provider";
import { uploadCreativeMaterial } from "../../../services/creative-materials/upload-creative-material";
import { downloadGoogleDriveMaterial, loadGoogleDriveMaterialFolder, openGoogleDriveMaterialFolder, type GoogleDriveMaterialFolder, type GoogleDriveMaterialImage } from "../../../services/google-drive/google-drive-materials";
import { getFileNames } from "../../../shared/utils/files";
import { pluralize } from "../../../shared/utils/text";
import { QUANTITY_LIMITS } from "../../../shared/constants/ui";
import { serviceLabels } from "../config";
import type { WorkflowAction, WorkflowState } from "../model";
import { creativeMixItems, selectedBrandProducts, selectedUploadedMaterials, totalCreativeMixQuantity } from "../model";
import { workflowActionBlockReason } from "../rules";
import { presentBrandMemoryText } from "../brand-memory-presentation";
import { useGenerateHooks } from "../use-generate-hooks";
import { BriefConfirmationModal } from "./brief-confirmation-modal";
import {
  DecisionCard,
  HookGenerationModelSelect,
  HookIdeaModeSelect,
  Spinner,
  type StageProps
} from "./shared";

export function LibraryEditModal({
  title,
  description,
  busy,
  onClose,
  children
}: {
  title: string;
  description?: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  if (typeof document === "undefined") return null;
  const portalRoot = document.querySelector(".compass-app") ?? document.body;

  return createPortal(
    <div
      className="output-modal-backdrop compass-library-edit-backdrop"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <section
        className="output-modal compass-library-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="output-modal-head compass-library-edit-head">
          <div>
            <p className="eyebrow">Manage library</p>
            <h3 id={titleId}>{title}</h3>
            {description ? <p>{description}</p> : null}
          </div>
          <button
            className="btn ghost"
            type="button"
            disabled={busy}
            aria-label="Close edit popup"
            onClick={onClose}
          >
            Close
          </button>
        </header>
        <div className="compass-library-edit-body">{children}</div>
      </section>
    </div>,
    portalRoot
  );
}

export const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function BrandKitTag({ value }: { value: string }) {
  const isColor = HEX_COLOR_PATTERN.test(value);
  return (
    <span className="memory-tag">
      {isColor ? (
        <span className="memory-tag-swatch" style={{ background: value }} />
      ) : null}
      {value}
    </span>
  );
}

export function BrandLogoCard({
  clientId,
  logoItem,
  onSaved
}: {
  clientId: string;
  logoItem: LibraryItem | undefined;
  onSaved: (item: LibraryItem) => void;
}) {
  const repository = useBrandMemoryRepository();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const saved = logoItem
        ? await repository.updateBrandRule({
            id: logoItem.id,
            title: "Logo",
            description: logoItem.description || "Brand logo",
            assetFile: file
          })
        : await repository.createBrandRule({
            clientId,
            title: "Logo",
            description: "Brand logo",
            assetFile: file
          });
      onSaved(saved);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not upload logo."
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="brand-logo-card">
      <div className="brand-logo-preview">
        {logoItem?.assetUrl ? (
          <img src={logoItem.assetUrl} alt="Brand logo" />
        ) : (
          <span className="brand-logo-placeholder">Logo</span>
        )}
      </div>
      <div className="brand-logo-body">
        <b>Logo</b>
        <p>
          Official Brand CI identity asset. Shown in previews and sent as a
          logo—not as a style reference.
        </p>
        {!logoItem?.assetUrl ? (
          <p className="compass-quality-note">
            Upload your logo to keep generated artwork visually consistent.
            You can add it later.
          </p>
        ) : null}
        {error ? <p className="memory-error">{error}</p> : null}
      </div>
      <label
        className={`btn secondary small upload-inline ${uploading ? "disabled" : ""}`}
      >
        {uploading ? "Uploading…" : logoItem ? "Replace logo" : "Upload logo"}
        <input
          className="file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label={logoItem ? "Replace logo" : "Upload logo"}
          disabled={uploading}
          onChange={(event) => void handleUpload(event)}
        />
      </label>
    </div>
  );
}

const successMetricOptions = [
  { value: "CTR", description: "Stop the scroll" },
  { value: "CVR", description: "Strengthen intent" },
  { value: "CPA", description: "Improve efficiency" },
  { value: "ROAS", description: "Scale revenue" }
] as const;

const serviceDescriptions: Record<ServiceType, string> = {
  "single-static": "1:1 or 4:5 performance artwork",
  "album-post": "3 or 4-image Facebook album",
  "motion-static": "A lightweight animated execution",
  resize: "Adapt approved work to another placement",
  "ugc-video": "9:16 creator-led video concept"
};

const briefServiceTypes: readonly ServiceType[] = [
  "single-static",
  "album-post",
  "ugc-video"
];

const briefServiceLabels: Partial<Record<ServiceType, string>> = {
  "single-static": "Single",
  "album-post": "Album",
  "ugc-video": "UGC"
};

function briefSignalValue(
  brief: string,
  labels: readonly string[]
): string | null {
  const lines = brief.split(/\r?\n/);
  for (const line of lines) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex < 0) continue;
    const label = line.slice(0, separatorIndex).trim().toLowerCase();
    if (!labels.some((candidate) => label === candidate.toLowerCase())) continue;
    const value = line.slice(separatorIndex + 1).trim();
    if (value) return value;
  }
  return null;
}

const SIGNAL_PREVIEW_LIMIT = 150;

function compactSignalPreview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= SIGNAL_PREVIEW_LIMIT) return normalized;
  const clipped = normalized.slice(0, SIGNAL_PREVIEW_LIMIT + 1);
  const wordBoundary = clipped.lastIndexOf(" ");
  const preview =
    wordBoundary > SIGNAL_PREVIEW_LIMIT * 0.72
      ? clipped.slice(0, wordBoundary)
      : clipped.slice(0, SIGNAL_PREVIEW_LIMIT);
  return `${preview.trimEnd()}…`;
}

function SignalStackItem({
  title,
  value
}: {
  title: string;
  value: string;
}) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const preview = compactSignalPreview(normalized);
  const expandable = normalized.length > SIGNAL_PREVIEW_LIMIT;

  if (!expandable) {
    return (
      <div className="compass-signal-line compact">
        <b>{title}</b>
        <span>{normalized}</span>
      </div>
    );
  }

  return (
    <details className="compass-signal-disclosure">
      <summary>
        <span className="compass-signal-summary-copy">
          <b>{title}</b>
          <span className="compass-signal-preview">{preview}</span>
          <small>View details</small>
        </span>
        <i className="compass-signal-chevron" aria-hidden="true">›</i>
      </summary>
      <div className="compass-signal-detail">
        <p>{normalized}</p>
      </div>
    </details>
  );
}

function briefServiceLabel(service: ServiceType): string {
  return briefServiceLabels[service] ?? serviceLabels[service];
}

const briefServiceIcons: Partial<Record<ServiceType, string>> = {
  "single-static": "ST",
  "album-post": "AL",
  "ugc-video": "UG"
};

const creativeMaterialRoleLabels: Record<CreativeMaterialRole, string> = {
  "main-object": "Main object",
  product: "Product",
  "supporting-component": "Supporting component",
  "client-context": "Person / client context"
};

function AssetPreviewImage({
  src,
  alt
}: {
  src: string;
  alt: string;
}) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    "loading"
  );

  useEffect(() => {
    setStatus("loading");
  }, [src]);

  return (
    <div className={`compass-asset-preview ${status}`}>
      {status === "loading" ? (
        <span className="compass-asset-preview-skeleton" aria-hidden="true" />
      ) : null}
      {status === "error" ? (
        <span className="compass-asset-preview-error">
          <ImageBroken aria-hidden="true" size={24} weight="duotone" />
          Preview unavailable
        </span>
      ) : null}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setStatus("loaded")}
        onError={() => setStatus("error")}
      />
    </div>
  );
}

export function CreativeMaterialsEditor({
  state,
  dispatch,
  kind = "material",
  legacyReferences = [],
  onAssetCountChange
}: StageProps & {
  kind?: BrandAssetKind;
  legacyReferences?: readonly LibraryItem[];
  onAssetCountChange?: (kind: BrandAssetKind, count: number) => void;
}) {
  const brandMemoryRepository = useBrandMemoryRepository();
  const auth = useOptionalAuth();
  const [uploadPending, setUploadPending] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [driveLink, setDriveLink] = useState("");
  const [drivePending, setDrivePending] = useState(false);
  const [googleReconnectPending, setGoogleReconnectPending] = useState(false);
  const assetKind = kind;
  const [assetFolders, setAssetFolders] = useState<readonly BrandAssetFolder[]>(
    []
  );
  const [assetImages, setAssetImages] = useState<readonly BrandAssetImage[]>([]);
  const [currentAssetFolderId, setCurrentAssetFolderId] = useState<string | null>(
    null
  );
  const [newFolderName, setNewFolderName] = useState("");
  const [assetActionPopup, setAssetActionPopup] = useState<
    "folder" | "drive" | null
  >(null);
  const [assetLibraryPending, setAssetLibraryPending] = useState(false);
  const [assetLibraryReady, setAssetLibraryReady] = useState(false);
  const [editingAssetFolder, setEditingAssetFolder] =
    useState<BrandAssetFolder | null>(null);
  const [editingAssetFolderName, setEditingAssetFolderName] = useState("");
  const [folderMutationPending, setFolderMutationPending] = useState(false);
  const [deletingAssetImageId, setDeletingAssetImageId] = useState<
    string | null
  >(null);
  const [deletingLegacyReferenceId, setDeletingLegacyReferenceId] = useState<
    string | null
  >(null);
  const [driveImportStatuses, setDriveImportStatuses] = useState<
    Readonly<Record<string, "pending" | "imported" | "failed">>
  >({});
  const driveImportIds = useRef(new Set<string>());
  const selectedMaterials = selectedUploadedMaterials(state);
  const googleReconnectRequired = Boolean(
    uploadError &&
      /Google access|Continue with Google|session has expired/i.test(uploadError)
  );

  async function reconnectGoogle(): Promise<void> {
    if (!auth?.enabled || googleReconnectPending) return;
    setGoogleReconnectPending(true);
    setUploadError(null);
    try {
      await auth.reconnectGoogle();
    } catch (caught) {
      setUploadError(
        caught instanceof Error
          ? caught.message
          : "Could not reconnect Google."
      );
      setGoogleReconnectPending(false);
    }
  }

  useEffect(() => {
    const clientId = state.brand?.id;
    if (!clientId) {
      setAssetFolders([]);
      setAssetImages([]);
      setAssetLibraryReady(false);
      return;
    }
    let active = true;
    setAssetLibraryPending(true);
    setAssetLibraryReady(false);
    void Promise.all([
      brandMemoryRepository.listAssetFolders(clientId),
      brandMemoryRepository.listAssetImages(clientId)
    ])
      .then(([folders, images]) => {
        if (!active) return;
        setAssetFolders(folders);
        setAssetImages(images);
        images.forEach((image) => {
          if (image.sourceProvider === "google-drive" && image.sourceId) {
            driveImportIds.current.add(image.sourceId);
          }
        });
      })
      .catch((caught) => {
        if (!active) return;
        setUploadError(
          caught instanceof Error
            ? caught.message
            : "Could not load the brand asset library."
        );
      })
      .finally(() => {
        if (active) {
          setAssetLibraryPending(false);
          setAssetLibraryReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, [brandMemoryRepository, state.brand?.id]);

  useEffect(() => {
    if (!assetLibraryReady) return;
    onAssetCountChange?.(
      assetKind,
      assetImages.filter((image) => image.kind === assetKind).length
    );
  }, [
    assetImages,
    assetKind,
    assetLibraryReady,
    onAssetCountChange
  ]);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    if (files.length > 20) {
      setUploadError("Upload up to 20 images at a time.");
      return;
    }

    setUploadPending(true);
    setUploadError(null);
    try {
      const clientId = state.brand?.id;
      if (clientId) {
        const items = await Promise.all(
          files.map((file) =>
            brandMemoryRepository.createAssetImage({
              clientId,
              kind: assetKind,
              folderId: currentAssetFolderId ?? undefined,
              file
            })
          )
        );
        setAssetImages((current) => mergeBrandAssetImages(current, items));
      } else {
        const items = await Promise.all(
          files.map((file) =>
            uploadCreativeMaterial({
              runId: state.id,
              file
            })
          )
        );
        dispatch({ type: "add-uploaded-materials", items });
      }
    } catch (caught) {
      setUploadError(
        caught instanceof Error ? caught.message : "Could not upload the image."
      );
    } finally {
      setUploadPending(false);
    }
  }

  async function handleBrowseDrive() {
    if (!driveLink.trim() || drivePending) return;
    const clientId = state.brand?.id;
    if (!clientId) {
      setUploadError("Choose a brand before adding a Drive folder.");
      return;
    }
    setDrivePending(true);
    setUploadError(null);
    try {
      const root = await openGoogleDriveMaterialFolder(driveLink);
      const contents = await loadGoogleDriveMaterialFolder(root);
      const rootLibraryFolder = await brandMemoryRepository.createAssetFolder({
        clientId,
        kind: assetKind,
        name: root.name,
        parentId: currentAssetFolderId ?? undefined,
        sourceProvider: "google-drive",
        sourceId: root.id,
        sourceUrl: driveLink
      });
      const childLibraryFolders = await Promise.all(
        contents.folders.map((folder) =>
          brandMemoryRepository.createAssetFolder({
            clientId,
            kind: assetKind,
            name: folder.name,
            parentId: rootLibraryFolder.id,
            sourceProvider: "google-drive",
            sourceId: folder.id
          })
        )
      );
      setAssetFolders((folders) =>
        mergeBrandAssetFolders(folders, [
          rootLibraryFolder,
          ...childLibraryFolders
        ])
      );
      setCurrentAssetFolderId(rootLibraryFolder.id);
      setDriveLink("");
      setAssetActionPopup(null);
      void importDriveImages(contents.images, rootLibraryFolder.id);
    } catch (caught) {
      setUploadError(
        caught instanceof Error
          ? caught.message
          : "Could not open the Google Drive folder."
      );
    } finally {
      setDrivePending(false);
    }
  }

  async function importDriveImages(
    images: readonly GoogleDriveMaterialImage[],
    folderId: string
  ): Promise<void> {
    const clientId = state.brand?.id;
    if (!clientId) return;
    const candidates = images.filter((image) => {
      if (driveImportIds.current.has(image.id)) return false;
      driveImportIds.current.add(image.id);
      return true;
    });
    if (!candidates.length) return;
    setDriveImportStatuses((statuses) => ({
      ...statuses,
      ...Object.fromEntries(candidates.map((image) => [image.id, "pending"]))
    }));

    let failures = 0;
    for (let index = 0; index < candidates.length; index += 4) {
      const batch = candidates.slice(index, index + 4);
      const results = await Promise.allSettled(
        batch.map(async (image) => {
          const file = await downloadGoogleDriveMaterial(image);
          return brandMemoryRepository.createAssetImage({
            clientId,
            kind: assetKind,
            folderId,
            file,
            sourceProvider: "google-drive",
            sourceId: image.id
          });
        })
      );
      const imported = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []
      );
      setAssetImages((current) => mergeBrandAssetImages(current, imported));
      setDriveImportStatuses((statuses) => {
        const next = { ...statuses };
        results.forEach((result, resultIndex) => {
          const image = batch[resultIndex];
          if (!image) return;
          if (result.status === "fulfilled") {
            next[image.id] = "imported";
          } else {
            next[image.id] = "failed";
            driveImportIds.current.delete(image.id);
            failures += 1;
          }
        });
        return next;
      });
    }
    if (failures) {
      setUploadError(
        `${failures} Drive ${pluralize(failures, "image")} could not be imported. Re-enter the folder to retry.`
      );
    }
  }

  async function createAssetFolder() {
    const clientId = state.brand?.id;
    const name = newFolderName.trim();
    if (!clientId || !name || assetLibraryPending) return;
    setAssetLibraryPending(true);
    setUploadError(null);
    try {
      const folder = await brandMemoryRepository.createAssetFolder({
        clientId,
        kind: assetKind,
        name,
        parentId: currentAssetFolderId ?? undefined
      });
      setAssetFolders((folders) => mergeBrandAssetFolders(folders, [folder]));
      setNewFolderName("");
      setAssetActionPopup(null);
    } catch (caught) {
      setUploadError(
        caught instanceof Error ? caught.message : "Could not create the folder."
      );
    } finally {
      setAssetLibraryPending(false);
    }
  }

  function openAssetFolderEditor(folder: BrandAssetFolder): void {
    setEditingAssetFolder(folder);
    setEditingAssetFolderName(folder.name);
    setUploadError(null);
  }

  function removeAssetFromBrief(asset: BrandAssetImage): void {
    const selectionId = `brand-asset-${asset.id}`;
    if (asset.kind === "material") {
      if (state.uploadedMaterials.some((item) => item.id === selectionId)) {
        dispatch({ type: "remove-uploaded-material", id: selectionId });
      }
      return;
    }
    const reference = state.referenceImages.find(
      (item) => item.id === selectionId
    );
    if (reference) {
      dispatch({ type: "toggle-reference-image", item: reference });
    }
  }

  async function renameAssetFolder(): Promise<void> {
    const folder = editingAssetFolder;
    const name = editingAssetFolderName.trim();
    if (!folder || !name || name === folder.name || folderMutationPending) {
      return;
    }
    setFolderMutationPending(true);
    setUploadError(null);
    try {
      const updated = await brandMemoryRepository.updateAssetFolder({
        id: folder.id,
        name
      });
      setAssetFolders((folders) =>
        folders.map((candidate) =>
          candidate.id === updated.id ? updated : candidate
        )
      );
      setEditingAssetFolder(null);
    } catch (caught) {
      setUploadError(
        caught instanceof Error ? caught.message : "Could not rename the folder."
      );
    } finally {
      setFolderMutationPending(false);
    }
  }

  async function deleteAssetFolder(): Promise<void> {
    const folder = editingAssetFolder;
    if (!folder || folderMutationPending) return;
    if (
      !window.confirm(
        `Delete “${folder.name}” and every nested folder and image inside it?`
      )
    ) {
      return;
    }
    const deletedFolderIds = brandAssetFolderSubtreeIds(folder.id, assetFolders);
    const deletedImages = assetImages.filter(
      (image) => image.folderId && deletedFolderIds.has(image.folderId)
    );
    setFolderMutationPending(true);
    setUploadError(null);
    try {
      await brandMemoryRepository.deleteAssetFolder(folder.id);
      setAssetFolders((folders) =>
        folders.filter((candidate) => !deletedFolderIds.has(candidate.id))
      );
      setAssetImages((images) =>
        images.filter(
          (image) => !image.folderId || !deletedFolderIds.has(image.folderId)
        )
      );
      deletedImages.forEach(removeAssetFromBrief);
      if (
        currentAssetFolderId &&
        deletedFolderIds.has(currentAssetFolderId)
      ) {
        setCurrentAssetFolderId(folder.parentId);
      }
      setEditingAssetFolder(null);
    } catch (caught) {
      setUploadError(
        caught instanceof Error ? caught.message : "Could not delete the folder."
      );
    } finally {
      setFolderMutationPending(false);
    }
  }

  async function deleteAssetImage(asset: BrandAssetImage): Promise<void> {
    if (deletingAssetImageId) return;
    if (!window.confirm(`Delete “${asset.name}” from the library?`)) return;
    setDeletingAssetImageId(asset.id);
    setUploadError(null);
    try {
      await brandMemoryRepository.deleteAssetImage(asset.id);
      setAssetImages((images) =>
        images.filter((candidate) => candidate.id !== asset.id)
      );
      removeAssetFromBrief(asset);
    } catch (caught) {
      setUploadError(
        caught instanceof Error ? caught.message : "Could not delete the image."
      );
    } finally {
      setDeletingAssetImageId(null);
    }
  }

  async function deleteLegacyReference(item: LibraryItem): Promise<void> {
    if (deletingLegacyReferenceId) return;
    if (!window.confirm(`Delete “${item.title}” from References?`)) return;
    setDeletingLegacyReferenceId(item.id);
    setUploadError(null);
    try {
      await brandMemoryRepository.deleteReferenceImage(item.id);
      state.referenceImages
        .filter(
          (reference) =>
            reference.id === `brand-library-${item.id}` ||
            reference.id === `library-${item.id}`
        )
        .forEach((reference) =>
          dispatch({ type: "toggle-reference-image", item: reference })
        );
      dispatch({
        type: "sync-brand-references",
        items: legacyReferences.filter(
          (reference) => reference.id !== item.id
        )
      });
    } catch (caught) {
      setUploadError(
        caught instanceof Error
          ? caught.message
          : "Could not delete the reference."
      );
    } finally {
      setDeletingLegacyReferenceId(null);
    }
  }

  async function openSavedAssetFolder(folder: BrandAssetFolder) {
    setCurrentAssetFolderId(folder.id);
    if (folder.sourceProvider !== "google-drive" || !folder.sourceId) return;

    const clientId = state.brand?.id;
    if (!clientId || assetLibraryPending) return;
    setAssetLibraryPending(true);
    setUploadError(null);
    try {
      const driveFolder: GoogleDriveMaterialFolder = {
        id: folder.sourceId,
        name: folder.name,
        path: brandAssetFolderPath(folder, assetFolders)
      };
      const contents = await loadGoogleDriveMaterialFolder(driveFolder);
      const children = await Promise.all(
        contents.folders.map((child) =>
          brandMemoryRepository.createAssetFolder({
            clientId,
            kind: assetKind,
            name: child.name,
            parentId: folder.id,
            sourceProvider: "google-drive",
            sourceId: child.id
          })
        )
      );
      setAssetFolders((folders) => mergeBrandAssetFolders(folders, children));
      await importDriveImages(contents.images, folder.id);
    } catch (caught) {
      setUploadError(
        caught instanceof Error
          ? caught.message
          : "Could not sync the Google Drive folder."
      );
    } finally {
      setAssetLibraryPending(false);
    }
  }

  function selectBrandAsset(asset: BrandAssetImage) {
    if (asset.kind === "reference") {
      const item: ReferenceImageSelection = {
        id: `brand-asset-${asset.id}`,
        url: asset.url,
        label: asset.name,
        role: "style"
      };
      dispatch({ type: "toggle-reference-image", item });
      return;
    }
    const id = `brand-asset-${asset.id}`;
    const existing = state.uploadedMaterials.find((item) => item.id === id);
    if (existing) {
      toggleMaterial(existing);
      return;
    }
    if (selectedMaterials.length >= 8) {
      setUploadError("Select up to 8 creative material images per brief.");
      return;
    }
    dispatch({
      type: "add-uploaded-materials",
      items: [
        {
          id,
          name: asset.name,
          mediaType: asset.mimeType,
          role: "main-object",
          description: "",
          selected: true,
          url: asset.url,
          storagePath: asset.storagePath,
          storageBucket: env.brandAssetsBucket
        }
      ]
    });
  }

  function selectLegacyReference(item: LibraryItem) {
    if (!item.assetUrl) return;
    dispatch({
      type: "toggle-reference-image",
      item: {
        id: `brand-library-${item.id}`,
        url: item.assetUrl,
        label: item.title,
        role: "style"
      }
    });
  }

  function toggleMaterial(material: UploadedCreativeMaterial) {
    const willSelect = material.selected === false;
    if (willSelect && selectedMaterials.length >= 8) {
      setUploadError("Select up to 8 creative material images per brief.");
      return;
    }
    setUploadError(null);
    dispatch({
      type: "update-uploaded-material",
      id: material.id,
      changes: { selected: !willSelect ? false : true }
    });
  }

  const currentAssetFolder =
    assetFolders.find((folder) => folder.id === currentAssetFolderId) ?? null;
  const visibleAssetFolders = assetFolders.filter(
    (folder) =>
      folder.kind === assetKind &&
      folder.parentId === (currentAssetFolder?.id ?? null)
  );
  const visibleAssetImages = assetImages.filter(
    (image) =>
      image.kind === assetKind &&
      image.folderId === (currentAssetFolder?.id ?? null)
  );
  const visibleLegacyReferences =
    assetKind === "reference" && !currentAssetFolder
      ? legacyReferences.filter(
          (item): item is LibraryItem & { assetUrl: string } =>
            Boolean(item.assetUrl)
        )
      : [];
  const pendingDriveImports = Object.values(driveImportStatuses).filter(
    (status) => status === "pending"
  ).length;
  const visibleAssetCount =
    visibleAssetImages.length + visibleLegacyReferences.length;
  const showAssetSkeletons =
    (assetLibraryPending ||
      uploadPending ||
      drivePending ||
      pendingDriveImports > 0) &&
    !visibleAssetFolders.length &&
    visibleAssetCount === 0;

  return (
    <div className="compass-creative-material-editor">
      {state.brand ? (
        <div className="compass-asset-library-browser">
          <nav aria-label={`${assetKind} library folder path`}>
            <button
              type="button"
              aria-label="Go to parent folder"
              disabled={!currentAssetFolder}
              onClick={() =>
                setCurrentAssetFolderId(currentAssetFolder?.parentId ?? null)
              }
            >
              <ArrowLeft aria-hidden="true" size={15} weight="bold" />
            </button>
            <b>
              {currentAssetFolder
                ? brandAssetFolderPath(currentAssetFolder, assetFolders)
                : `${state.brand.name} / ${
                    assetKind === "material" ? "Materials" : "References"
                  }`}
            </b>
            <span>
              {visibleAssetFolders.length} folders ·{" "}
              {visibleAssetCount} images
              {pendingDriveImports ? ` · importing ${pendingDriveImports}` : ""}
            </span>
            <div className="compass-asset-library-actions">
              <button
                className="btn secondary small"
                type="button"
                aria-expanded={assetActionPopup === "folder"}
                disabled={assetLibraryPending}
                onClick={() =>
                  setAssetActionPopup((current) =>
                    current === "folder" ? null : "folder"
                  )
                }
              >
                Create folder
              </button>
              <label className="btn secondary small compass-brief-add-files">
                {uploadPending
                  ? "Uploading…"
                  : assetKind === "material"
                    ? "Upload Materials"
                    : "Upload images"}
                <input
                  className="file-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  aria-label={
                    assetKind === "material"
                      ? "Upload Materials"
                      : "Upload images"
                  }
                  disabled={uploadPending}
                  onChange={handleUpload}
                />
              </label>
              <button
                className="btn secondary small"
                type="button"
                aria-expanded={assetActionPopup === "drive"}
                disabled={drivePending}
                onClick={() =>
                  setAssetActionPopup((current) =>
                    current === "drive" ? null : "drive"
                  )
                }
              >
                {drivePending ? "Adding…" : "Add Drive folder"}
              </button>
            </div>
          </nav>
          {assetActionPopup === "folder" ? (
            <form
              className="compass-asset-action-popover"
              role="dialog"
              aria-label="Create a folder"
              onSubmit={(event) => {
                event.preventDefault();
                void createAssetFolder();
              }}
            >
              <header>
                <div>
                  <b>Create folder</b>
                  <span>Keep related images together in this location.</span>
                </div>
                <button
                  type="button"
                  aria-label="Close create folder popup"
                  onClick={() => setAssetActionPopup(null)}
                >
                  ×
                </button>
              </header>
              <label>
                <span>Folder name</span>
                <input
                  autoFocus
                  aria-label="New folder name"
                  value={newFolderName}
                  placeholder="e.g. Product packshots"
                  onChange={(event) => setNewFolderName(event.target.value)}
                />
              </label>
              <footer>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => setAssetActionPopup(null)}
                >
                  Cancel
                </button>
                <button
                  className="btn primary"
                  type="submit"
                  disabled={!newFolderName.trim() || assetLibraryPending}
                >
                  {assetLibraryPending ? "Creating…" : "Create"}
                </button>
              </footer>
            </form>
          ) : null}
          {assetActionPopup === "drive" ? (
            <form
              className="compass-asset-action-popover"
              role="dialog"
              aria-label="Add a Google Drive folder"
              onSubmit={(event) => {
                event.preventDefault();
                void handleBrowseDrive();
              }}
            >
              <header>
                <div>
                  <b>Add Google Drive folder</b>
                  <span>Paste a shared folder link to sync its images.</span>
                </div>
                <button
                  type="button"
                  aria-label="Close Drive folder popup"
                  onClick={() => setAssetActionPopup(null)}
                >
                  ×
                </button>
              </header>
              <label>
                <span>Google Drive folder link</span>
                <input
                  autoFocus
                  aria-label="Google Drive folder link"
                  type="url"
                  value={driveLink}
                  placeholder="https://drive.google.com/drive/folders/…"
                  onChange={(event) => setDriveLink(event.target.value)}
                />
              </label>
              <footer>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => setAssetActionPopup(null)}
                >
                  Cancel
                </button>
                <button
                  className="btn primary"
                  type="submit"
                  disabled={!driveLink.trim() || drivePending}
                >
                  {drivePending ? "Adding…" : "Add folder"}
                </button>
              </footer>
            </form>
          ) : null}
          {visibleAssetFolders.length ? (
            <>
              <div className="compass-asset-library-subhead">
                <b>Folders</b>
                <span>Choose a folder to preview its images</span>
              </div>
              <div className="compass-drive-subfolder-grid">
                {visibleAssetFolders.map((folder) => (
                  <article key={folder.id}>
                    <button
                      className="compass-folder-open"
                      type="button"
                      aria-label={`${folder.name} Open folder`}
                      onClick={() => void openSavedAssetFolder(folder)}
                    >
                      <FolderSimple
                        aria-hidden="true"
                        size={21}
                        weight="duotone"
                      />
                      <b>{folder.name}</b>
                      <small>Open folder</small>
                    </button>
                    <button
                      className="compass-folder-edit"
                      type="button"
                      aria-label={`Edit folder ${folder.name}`}
                      title={`Edit ${folder.name}`}
                      onClick={() => openAssetFolderEditor(folder)}
                    >
                      <PencilSimple aria-hidden="true" size={14} weight="bold" />
                    </button>
                  </article>
                ))}
              </div>
            </>
          ) : null}
          {visibleAssetImages.length || visibleLegacyReferences.length ? (
            <>
              <div className="compass-asset-library-subhead">
                <b>
                  {currentAssetFolder
                    ? `Images in ${currentAssetFolder.name}`
                    : "Images in this folder"}
                </b>
                <span>Select the images Creative Compass should use</span>
              </div>
              <div className="compass-persistent-asset-grid">
                {visibleAssetImages.map((asset) => {
                  const selected =
                    asset.kind === "material"
                      ? state.uploadedMaterials.some(
                          (item) =>
                            item.id === `brand-asset-${asset.id}` &&
                            item.selected !== false
                        )
                      : state.referenceImages.some(
                          (item) => item.id === `brand-asset-${asset.id}`
                        );
                  return (
                    <article key={asset.id}>
                      <AssetPreviewImage src={asset.url} alt={asset.name} />
                      <b>{asset.name}</b>
                      <div className="compass-persistent-asset-actions">
                        <button
                          type="button"
                          aria-pressed={selected}
                          onClick={() => selectBrandAsset(asset)}
                        >
                          {selected ? "Selected" : "Select"}
                        </button>
                        <button
                          className="danger"
                          type="button"
                          disabled={deletingAssetImageId === asset.id}
                          aria-label={`Delete image ${asset.name}`}
                          onClick={() => void deleteAssetImage(asset)}
                        >
                          <Trash aria-hidden="true" size={13} weight="bold" />
                          {deletingAssetImageId === asset.id
                            ? "Deleting…"
                            : "Delete"}
                        </button>
                      </div>
                    </article>
                  );
                })}
                {visibleLegacyReferences.map((item) => {
                  const selected = state.referenceImages.some(
                    (reference) => reference.id === `brand-library-${item.id}`
                  );
                  return (
                    <article key={`legacy-${item.id}`}>
                      <AssetPreviewImage
                        src={item.assetUrl}
                        alt={item.title}
                      />
                      <b>{item.title}</b>
                      <div className="compass-persistent-asset-actions">
                        <button
                          type="button"
                          aria-pressed={selected}
                          onClick={() => selectLegacyReference(item)}
                        >
                          {selected ? "Selected" : "Select"}
                        </button>
                        <button
                          className="danger"
                          type="button"
                          disabled={deletingLegacyReferenceId === item.id}
                          aria-label={`Delete reference image ${item.title}`}
                          onClick={() => void deleteLegacyReference(item)}
                        >
                          <Trash aria-hidden="true" size={13} weight="bold" />
                          {deletingLegacyReferenceId === item.id
                            ? "Deleting…"
                            : "Delete"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          ) : null}
          {showAssetSkeletons ? (
            <div
              className="compass-persistent-asset-grid compass-asset-loading-grid"
              role="status"
              aria-label="Loading images"
            >
              <span className="sr-only">Loading images</span>
              {Array.from({ length: 3 }, (_, index) => (
                <article aria-hidden="true" key={index}>
                  <span className="compass-asset-preview-skeleton" />
                  <span className="compass-asset-line-skeleton" />
                </article>
              ))}
            </div>
          ) : null}
          {!assetLibraryPending &&
          !uploadError &&
          !visibleAssetFolders.length &&
          !visibleAssetImages.length &&
          !visibleLegacyReferences.length ? (
            <div className="compass-drive-empty">
              <b>This folder is empty.</b>
              <span>Upload images, create a folder, or add a Drive folder.</span>
            </div>
          ) : null}
          {uploadError ? (
            <div className="compass-google-reconnect-error" role="alert">
              <span>{uploadError}</span>
              {googleReconnectRequired && auth?.enabled ? (
                <button
                  className="btn secondary small"
                  type="button"
                  disabled={googleReconnectPending}
                  onClick={() => void reconnectGoogle()}
                >
                  {googleReconnectPending
                    ? "Connecting…"
                    : "Reconnect Google"}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="compass-creative-material-upload-row">
        <span>
          {assetKind === "material"
            ? `${selectedMaterials.length}/8 materials selected`
            : `${state.referenceImages.length} references selected`}
        </span>
      </div>
      <p className="compass-creative-material-helper">
        {assetKind === "material"
          ? "Only materials you mark Selected are sent to the Hook Agent and Image Agent."
          : "Only references you mark Selected are used as style and composition context."}
      </p>
      {assetKind === "material" && state.uploadedMaterials.length ? (
        <section className="compass-selected-materials">
          <header>
            <b>Selected for this brief</b>
            <span>Set each image role before generation.</span>
          </header>
          <div className="compass-creative-material-grid">
            {state.uploadedMaterials.map((material) => (
            <article
              className={`compass-creative-material-card ${
                material.selected !== false ? "selected" : ""
              }`}
              key={material.id}
            >
              <img src={material.url} alt={material.name} />
              <div className="compass-creative-material-fields">
                <div className="compass-creative-material-name">
                  <b>{material.name}</b>
                  <button
                    type="button"
                    aria-label={`Remove ${material.name}`}
                    onClick={() =>
                      dispatch({
                        type: "remove-uploaded-material",
                        id: material.id
                      })
                    }
                  >
                    ×
                  </button>
                </div>
                <button
                  className="compass-material-select"
                  type="button"
                  aria-pressed={material.selected !== false}
                  onClick={() => toggleMaterial(material)}
                >
                  {material.selected !== false ? "Selected" : "Select"}
                </button>
                <label>
                  Use as
                  <select
                    value={material.role}
                    onChange={(event) =>
                      dispatch({
                        type: "update-uploaded-material",
                        id: material.id,
                        changes: {
                          role: event.target.value as CreativeMaterialRole
                        }
                      })
                    }
                  >
                    {creativeMaterialRoles.map((role) => (
                      <option value={role} key={role}>
                        {creativeMaterialRoleLabels[role]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Usage note <span>(optional)</span>
                  <input
                    value={material.description}
                    placeholder="e.g. Keep this bottle as the hero object"
                    onChange={(event) =>
                      dispatch({
                        type: "update-uploaded-material",
                        id: material.id,
                        changes: {
                          description: event.target.value
                        }
                      })
                    }
                  />
                </label>
              </div>
            </article>
            ))}
          </div>
        </section>
      ) : null}
      {editingAssetFolder ? (
        <LibraryEditModal
          title={`Edit ${editingAssetFolder.name}`}
          description="Rename this folder or permanently delete it with every nested folder and image inside."
          busy={folderMutationPending}
          onClose={() => setEditingAssetFolder(null)}
        >
          <div className="memory-form compass-asset-folder-edit-form">
            <label>
              Folder name
              <input
                aria-label="Folder name"
                value={editingAssetFolderName}
                maxLength={120}
                disabled={folderMutationPending}
                onChange={(event) =>
                  setEditingAssetFolderName(event.target.value)
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void renameAssetFolder();
                  }
                }}
              />
            </label>
            <div className="compass-asset-folder-edit-actions">
              <button
                className="btn danger"
                type="button"
                disabled={folderMutationPending}
                onClick={() => void deleteAssetFolder()}
              >
                <Trash aria-hidden="true" size={15} weight="bold" />
                Delete folder
              </button>
              <button
                className="btn primary"
                type="button"
                disabled={
                  folderMutationPending ||
                  !editingAssetFolderName.trim() ||
                  editingAssetFolderName.trim() === editingAssetFolder.name
                }
                onClick={() => void renameAssetFolder()}
              >
                {folderMutationPending ? "Saving…" : "Save name"}
              </button>
            </div>
          </div>
        </LibraryEditModal>
      ) : null}
    </div>
  );
}

function mergeBrandAssetFolders(
  current: readonly BrandAssetFolder[],
  incoming: readonly BrandAssetFolder[]
): readonly BrandAssetFolder[] {
  const byId = new Map(current.map((folder) => [folder.id, folder]));
  incoming.forEach((folder) => byId.set(folder.id, folder));
  return [...byId.values()];
}

function mergeBrandAssetImages(
  current: readonly BrandAssetImage[],
  incoming: readonly BrandAssetImage[]
): readonly BrandAssetImage[] {
  const byId = new Map(current.map((image) => [image.id, image]));
  incoming.forEach((image) => byId.set(image.id, image));
  return [...byId.values()];
}

function brandAssetFolderPath(
  folder: BrandAssetFolder,
  folders: readonly BrandAssetFolder[]
): string {
  const names = [folder.name];
  let current = folder;
  while (current.parentId) {
    const parent = folders.find((candidate) => candidate.id === current.parentId);
    if (!parent) break;
    names.unshift(parent.name);
    current = parent;
  }
  return names.join(" / ");
}

function brandAssetFolderSubtreeIds(
  rootId: string,
  folders: readonly BrandAssetFolder[]
): ReadonlySet<string> {
  const ids = new Set([rootId]);
  let foundDescendant = true;
  while (foundDescendant) {
    foundDescendant = false;
    folders.forEach((folder) => {
      if (
        folder.parentId &&
        ids.has(folder.parentId) &&
        !ids.has(folder.id)
      ) {
        ids.add(folder.id);
        foundDescendant = true;
      }
    });
  }
  return ids;
}

export function BriefStage({ state, dispatch }: StageProps) {
  const brandMemoryRepository = useBrandMemoryRepository();
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const materialsInitialCategory: ReferenceLibraryCategory | null = null;
  const [referenceUploadPending, setReferenceUploadPending] = useState(false);
  const [referenceUploadError, setReferenceUploadError] = useState<
    string | null
  >(null);
  const backAction: WorkflowAction = { type: "set-stage", stage: "start" };
  const generateBlocked = workflowActionBlockReason(state, {
    type: "generate-directions",
    directions: []
  });
  const { generate, loading, error } = useGenerateHooks(state, dispatch);
  const activeProducts = selectedBrandProducts(state);
  const presentedWorkingSignals = (state.brand?.memory.working ?? [])
    .map((value) => presentBrandMemoryText(value).text)
    .filter(Boolean);
  const audienceTension =
    briefSignalValue(state.brief, [
      "Audience",
      "Audience tension",
      "กลุ่มเป้าหมาย",
      "Pain point"
    ]) ??
    state.brand?.onboardingQuestionnaire?.extractedFields?.find((field) =>
      /audience|customer|buyer|pain|problem|กลุ่มเป้าหมาย|ลูกค้า|ปัญหา/i.test(
        `${field.key} ${field.label}`
      )
    )?.value ??
    "Add the audience tension to the working brief.";
  const brandProof =
    activeProducts.find((product) => product.description.trim())?.description ??
    presentedWorkingSignals[1] ??
    presentedWorkingSignals[0] ??
    "Select product information to surface the strongest brand proof.";
  const pastWinner =
    presentedWorkingSignals[0] ??
    state.brand?.library.docs.find((item) =>
      /past|winner|performance|learning/i.test(item.title)
    )?.description ??
    "No approved creative learning has been captured yet.";

  async function saveReferenceImage(file: File) {
    const clientId = state.brand?.id;
    if (!clientId) return;

    const saved = await brandMemoryRepository.createReferenceImage({
      clientId,
      file
    });
    dispatch({
      type: "sync-brand-references",
      items: [
        saved,
        ...(state.brand?.library.refs ?? []).filter(
          (reference) => reference.id !== saved.id
        )
      ]
    });

    const selectedReference = libraryItemsWithImages([saved], "style")[0];
    if (
      selectedReference &&
      !state.referenceImages.some(
        (reference) => reference.id === selectedReference.id
      )
    ) {
      dispatch({ type: "toggle-reference-image", item: selectedReference });
    }
  }

  async function handleReferenceUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setReferenceUploadPending(true);
    setReferenceUploadError(null);
    try {
      await saveReferenceImage(file);
    } catch (caught) {
      setReferenceUploadError(
        caught instanceof Error
          ? caught.message
          : "Could not upload the reference."
      );
    } finally {
      setReferenceUploadPending(false);
    }
  }

  const mixItems = creativeMixItems(state);
  const totalDeliverables = totalCreativeMixQuantity(state);
  const selectedImageReferences = state.referenceImages.filter(
    (reference) => inferredReferenceImageRole(reference) !== "logo"
  );
  const fixedMixItems = briefServiceTypes
    .map(
      (service) =>
        mixItems.find((item) => item.service === service) ?? {
          id: `creative-mix-${service}`,
          service,
          quantity: 0
        }
    );
  const confirmationReferences = [
    ...libraryItemsWithImages(state.brand?.library.refs ?? [], "style"),
    ...selectedImageReferences.filter(
      (selected) =>
        !(state.brand?.library.refs ?? []).some(
          (reference) => `library-${reference.id}` === selected.id
        )
    )
  ];
  useEffect(() => {
    if (
      state.referenceImages.some(
        (reference) => inferredReferenceImageRole(reference) === "logo"
      )
    ) {
      dispatch({ type: "sync-brand-logo-reference", item: null });
    }
  }, [dispatch, state.brand?.id, state.referenceImages]);

  return (
    <DecisionCard
      eyebrow="02 / Brief"
      title="Shape the creative problem."
      helper="Set the mix, define the objective, and choose the one metric this creative set should move."
      status={state.brand ? `${state.brand.name} context ready` : "Context waiting"}
      statusClass="green"
      className="compass-stage-brief"
      actions={
        <>
          <button
            className="btn ghost"
            type="button"
            onClick={() => dispatch(backAction)}
          >
            ← Back to signal
          </button>
          <div className="compass-brief-generate-actions">
            <HookIdeaModeSelect
              disabled={loading}
              state={state}
              dispatch={dispatch}
            />
            <HookGenerationModelSelect
              disabled={loading}
              state={state}
              dispatch={dispatch}
            />
            <button
              className="btn orange"
              type="button"
              disabled={Boolean(generateBlocked) || loading}
              title={generateBlocked ?? undefined}
              onClick={() => setConfirmationOpen(true)}
            >
              {loading ? <Spinner /> : null}
              {loading ? "Generating angles…" : "Review & continue →"}
            </button>
          </div>
        </>
      }
    >
      <BriefConfirmationModal
        open={confirmationOpen}
        state={state}
        dispatch={dispatch}
        references={confirmationReferences}
        uploadPending={referenceUploadPending}
        uploadError={referenceUploadError}
        onUploadReference={handleReferenceUpload}
        referenceBrowser={
          <CreativeMaterialsEditor
            state={{
              ...state,
              referenceImages: selectedImageReferences
            }}
            dispatch={dispatch}
            kind="reference"
            legacyReferences={state.brand?.library.refs ?? []}
          />
        }
        materialBrowser={
          <CreativeMaterialsEditor
            state={state}
            dispatch={dispatch}
            kind="material"
          />
        }
        onBack={() => setConfirmationOpen(false)}
        onConfirm={() => {
          setConfirmationOpen(false);
          generate();
        }}
      />
      {error ? <p className="repository-message error">{error}</p> : null}
      <div className="brief-grid compass-brief-layout">
        <div className="brief-main">
          <section className="compass-workflow-module brief-setup-module">
            <div className="compass-module-head">
              <div>
                <h3>Creative mix</h3>
                <p>
                  {totalDeliverables} deliverables planned · max 50 per content
                  type
                </p>
              </div>
              <button
                className="btn secondary small"
                type="button"
                onClick={() => dispatch({ type: "apply-monthly-quota" })}
              >
                Use monthly quota
              </button>
            </div>
            <div className="compass-plan-rows">
              {fixedMixItems.map((item) => {
                const label = briefServiceLabel(item.service);
                return (
                  <div className="compass-plan-row" key={item.id}>
                    <span className="compass-type-icon" aria-hidden="true">
                      {briefServiceIcons[item.service]}
                    </span>
                    <div className="compass-plan-copy">
                      <b>{label}</b>
                      <p>{serviceDescriptions[item.service]}</p>
                    </div>
                    <div className="compass-mix-row-controls">
                      <div className="qty">
                        <button
                          type="button"
                          aria-label={`Decrease ${label} quantity`}
                          disabled={item.quantity <= 0}
                          onClick={() =>
                            dispatch({
                              type: "set-creative-mix-quantity",
                              id: item.id,
                              service: item.service,
                              quantity: item.quantity - 1
                            })
                          }
                        >
                          −
                        </button>
                        <input
                          aria-label={`${label} quantity`}
                          type="number"
                          min={QUANTITY_LIMITS.minimum}
                          max={QUANTITY_LIMITS.maximum}
                          value={item.quantity}
                          onChange={(event) =>
                            dispatch({
                              type: "set-creative-mix-quantity",
                              id: item.id,
                              service: item.service,
                              quantity: Number(event.target.value)
                            })
                          }
                        />
                        <button
                          type="button"
                          aria-label={`Increase ${label} quantity`}
                          disabled={item.quantity >= QUANTITY_LIMITS.maximum}
                          onClick={() =>
                            dispatch({
                              type: "set-creative-mix-quantity",
                              id: item.id,
                              service: item.service,
                              quantity: item.quantity + 1
                            })
                          }
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
          <section className="compass-workflow-module brief-editor-module">
            <div className="compass-module-head">
              <div>
                <h3>Creative brief</h3>
                <p>One clear problem. One clear outcome.</p>
              </div>
            </div>
            <div className="textarea-wrap">
              <label className="compass-brief-field-label" htmlFor="brief">
                <span>Working brief</span>
                <span className="compass-brief-char-count">
                  {state.brief.length} chars
                </span>
              </label>
              <textarea
                id="brief"
                value={state.brief}
                onChange={(event) =>
                  dispatch({ type: "set-brief", brief: event.target.value })
                }
              />
            </div>
          </section>
        </div>
        <aside className="compass-context-stack">
          <section className="compass-context-card">
            <h3>Signal stack</h3>
            <div className="compass-signal-list">
              <SignalStackItem
                title="Audience tension"
                value={audienceTension}
              />
              <SignalStackItem title="Brand proof" value={brandProof} />
              <SignalStackItem title="Past winner" value={pastWinner} />
            </div>
          </section>
          <section className="compass-context-card">
            <h3>Primary success metric</h3>
            <div
              className="compass-metric-choice"
              role="group"
              aria-label="Primary success metric"
            >
              {successMetricOptions.map((metric) => (
                <button
                  className={
                    state.successMetric === metric.value ? "active" : ""
                  }
                  type="button"
                  aria-pressed={state.successMetric === metric.value}
                  key={metric.value}
                  onClick={() =>
                    dispatch({
                      type: "set-success-metric",
                      metric: metric.value
                    })
                  }
                >
                  <b>{metric.value}</b>
                  <span>{metric.description}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="compass-context-card compass-principle-card">
            <h3>Creative principle</h3>
            <p>
              Distinctive beats decorative. Each idea should be recognizable in
              one second and arguable in one sentence.
            </p>
          </section>
        </aside>
      </div>
      {materialsOpen ? (
        <div
          className="output-modal-backdrop compass-library-backdrop"
          onClick={() => setMaterialsOpen(false)}
        >
          <section
            className="output-modal compass-material-manager-modal compass-brief-material-manager"
            role="dialog"
            aria-modal="true"
            aria-labelledby="brief-materials-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="compass-material-manager-head">
              <div>
                <h3 id="brief-materials-title">Brief materials</h3>
                <p>
                  Choose visual references, source materials, and supporting
                  files for this brief.
                </p>
              </div>
              <button
                className="compass-material-close"
                type="button"
                aria-label="Close brief materials"
                onClick={() => setMaterialsOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="compass-material-manager-toolbar">
              <div>
                <b>{state.brand?.name ?? "Current brief"}</b>
                <span>Materials included with creative generation</span>
              </div>
              <div
                className="compass-brief-material-totals"
                aria-label="Brief material counts"
              >
                <span>
                  <b>{selectedImageReferences.length}</b> references
                </span>
                <span>
                  <b>
                    {selectedUploadedMaterials(state).length}
                  </b>{" "}
                  materials
                </span>
                <span>
                  <b>{state.attachments.length}</b> brief files
                </span>
              </div>
            </div>
            <div className="compass-brief-materials-workspace">
              <section
                className="compass-brief-material-section compass-brief-library-section"
                aria-labelledby="brief-library-title"
              >
                <header className="compass-brief-material-section-head">
                  <div>
                    <h4 id="brief-library-title">Use from library</h4>
                    <p>Select approved brand assets and visual references.</p>
                  </div>
                  <span>Brand library</span>
                </header>
                <div className="compass-brief-material-section-body">
                  <ReferenceLibraryPicker
                    state={state}
                    dispatch={dispatch}
                    initialOpenCategory={materialsInitialCategory}
                    onUploadReferenceImage={saveReferenceImage}
                  />
                </div>
              </section>
              <div className="compass-brief-materials-side">
                <section
                  className="compass-brief-material-section compass-brief-selected-section"
                  aria-labelledby="brief-selected-references-title"
                >
                  <header className="compass-brief-material-section-head">
                    <div>
                      <h4 id="brief-selected-references-title">
                        References in Brief materials
                      </h4>
                      <p>
                        These guide style and composition; they are not source
                        objects.
                      </p>
                    </div>
                    <div className="compass-brief-section-head-actions">
                      <span>{selectedImageReferences.length} selected</span>
                      <label
                        className={`btn small secondary compass-reference-upload ${
                          referenceUploadPending ? "disabled" : ""
                        }`}
                      >
                        {referenceUploadPending
                          ? "Uploading…"
                          : "Upload reference"}
                        <input
                          className="file-input"
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          aria-label="Upload reference"
                          disabled={referenceUploadPending}
                          onChange={handleReferenceUpload}
                        />
                      </label>
                    </div>
                  </header>
                  <div className="compass-brief-material-section-body">
                    {referenceUploadError ? (
                      <p className="error-text" role="alert">
                        {referenceUploadError}
                      </p>
                    ) : null}
                    {selectedImageReferences.length ? (
                      <div className="compass-selected-reference-grid">
                        {selectedImageReferences.map((reference) => (
                          <article
                            className="compass-selected-reference"
                            key={reference.id}
                          >
                            <img src={reference.url} alt={reference.label} />
                            <div>
                              <b>{reference.label}</b>
                              <span>Included in generation</span>
                            </div>
                            <button
                              type="button"
                              aria-label={`Remove ${reference.label} from brief`}
                              onClick={() =>
                                dispatch({
                                  type: "toggle-reference-image",
                                  item: reference
                                })
                              }
                            >
                              Remove
                            </button>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="compass-brief-material-empty">
                        <b>No references selected.</b>
                        <span>
                          Choose an image from the library to add it here.
                        </span>
                      </div>
                    )}
                  </div>
                </section>

                <section
                  className="compass-brief-material-section compass-brief-uploaded-section"
                  aria-labelledby="brief-uploaded-materials-title"
                >
                  <header className="compass-brief-material-section-head">
                    <div>
                      <h4 id="brief-uploaded-materials-title">
                        Materials
                      </h4>
                      <p>
                        Upload the exact products, people, or objects you want
                        used in the artwork.
                      </p>
                    </div>
                    <span>
                      {selectedUploadedMaterials(state).length} selected ·{" "}
                      {state.uploadedMaterials.length} in library
                    </span>
                  </header>
                  <div className="compass-brief-material-section-body">
                    <div className="compass-brief-material-modal-body">
                      <CreativeMaterialsEditor
                        state={state}
                        dispatch={dispatch}
                      />
                      <div className="compass-brief-files-block">
                        <div>
                          <b>Brief files</b>
                          <span>
                            Documents support the brief but are not used as
                            visual source materials.
                          </span>
                        </div>
                        <label className="compass-brief-document-upload">
                          Attach documents
                          <input
                            className="file-input"
                            type="file"
                            multiple
                            onChange={(event) =>
                              dispatch({
                                type: "attach-files",
                                names: getFileNames(event.target.files)
                              })
                            }
                          />
                        </label>
                      </div>
                      {state.attachments.length ? (
                        <div className="chips compass-attachment-chips">
                          {state.attachments.map((name) => (
                            <span className="chip" key={name}>
                              {name}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </DecisionCard>
  );
}

type ReferenceLibraryCategory =
  | "guideline"
  | "logo"
  | "product"
  | "material"
  | "reference";

const REFERENCE_LIBRARY_CATEGORIES: readonly [
  ReferenceLibraryCategory,
  string
][] = [
  ["guideline", "Brand guideline"],
  ["logo", "Logo / CI assets"],
  ["product", "Product truth"],
  ["material", "Materials"],
  ["reference", "Reference board"]
];

function libraryItemsWithImages(
  items: readonly LibraryItem[],
  role?: ReferenceImageRole
): ReferenceImageSelection[] {
  return items
    .filter((item) => item.assetUrl)
    .map((item) => ({
      id: `library-${item.id}`,
      url: item.assetUrl as string,
      label: item.title || "Untitled",
      ...(role ? { role } : {})
    }));
}

export function findRuleByTitle(
  rules: readonly LibraryItem[],
  title: string
): LibraryItem | undefined {
  return rules.find(
    (rule) => rule.title.trim().toLowerCase() === title.toLowerCase()
  );
}

export function extractColorSwatches(rule: LibraryItem | undefined): readonly string[] {
  if (!rule) return [];
  return rule.description
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter((value) => HEX_COLOR_PATTERN.test(value));
}

function ReferenceLibraryPicker({
  state,
  dispatch,
  initialOpenCategory = null,
  onUploadReferenceImage
}: {
  state: WorkflowState;
  dispatch: Dispatch<WorkflowAction>;
  initialOpenCategory?: ReferenceLibraryCategory | null;
  onUploadReferenceImage: (file: File) => Promise<void>;
}) {
  const repository = useBrandMemoryRepository();
  const [brandRules, setBrandRules] = useState<readonly LibraryItem[]>([]);
  const [products, setProducts] = useState<readonly BrandProduct[]>([]);
  const [pastWork, setPastWork] = useState<readonly BrandPastWorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [openCategory, setOpenCategory] =
    useState<ReferenceLibraryCategory | null>(initialOpenCategory);
  const clientId = state.brand?.id;
  const brand = state.brand;

  function toggleExpanded(key: ReferenceLibraryCategory) {
    setOpenCategory((current) => (current === key ? null : key));
  }

  useEffect(() => {
    if (!clientId) {
      setBrandRules([]);
      setProducts([]);
      setPastWork([]);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    void Promise.all([
      repository.listBrandRules(clientId),
      repository.listProducts(clientId),
      repository.listPastWork(clientId)
    ])
      .then(([rules, brandProducts, past]) => {
        if (!active) return;
        setBrandRules(rules);
        setProducts(brandProducts);
        setPastWork(past);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, repository]);

  function upsertBrandRule(saved: LibraryItem) {
    const nextRules = brandRules.some((rule) => rule.id === saved.id)
      ? brandRules.map((rule) => (rule.id === saved.id ? saved : rule))
      : [...brandRules, saved];
    setBrandRules(nextRules);
    dispatch({ type: "sync-brand-rules", items: nextRules });
  }

  function saveLatestLogoReference(saved: LibraryItem) {
    upsertBrandRule(saved);
    dispatch({ type: "sync-brand-logo-reference", item: null });
  }

  async function addColor(hex: string) {
    const trimmed = hex.trim();
    if (!HEX_COLOR_PATTERN.test(trimmed)) {
      throw new Error("Enter a valid hex color, e.g. #1D1D1F.");
    }
    if (!clientId) return;

    const colorsRule = findRuleByTitle(brandRules, "Colors");
    const nextDescription = colorsRule?.description
      ? `${colorsRule.description}, ${trimmed}`
      : trimmed;
    const saved = colorsRule
      ? await repository.updateBrandRule({
          id: colorsRule.id,
          title: "Colors",
          description: nextDescription
        })
      : await repository.createBrandRule({
          clientId,
          title: "Colors",
          description: nextDescription
        });
    upsertBrandRule(saved);
  }

  async function addProduct(name: string) {
    if (!clientId) return;
    const saved = await repository.createProduct({
      clientId,
      name: name.trim(),
      description: "",
      offer: "",
      keyBenefit: "",
      audience: "",
      claimNotes: ""
    });
    setProducts((current) => [...current, saved]);
    const savedLibraryItem: LibraryItem = {
      id: saved.id,
      title: saved.name,
      description: saved.description
    };
    dispatch({
      type: "sync-brand-products",
      items: [
        ...(brand?.library.products ?? []).filter(
          (item) => item.id !== saved.id
        ),
        savedLibraryItem
      ]
    });
    if (state.selectedProductIds !== undefined) {
      dispatch({ type: "toggle-product-context", id: saved.id });
    }
  }

  const logoRule = findRuleByTitle(brandRules, "Logo");

  const candidatesByCategory: Record<
    ReferenceLibraryCategory,
    (ReferenceImageSelection & { displayLabel?: string })[]
  > = {
    guideline: libraryItemsWithImages(brand?.library.docs ?? [], "content"),
    logo: [],
    product: [],
    material: [],
    reference: [
      ...libraryItemsWithImages(brand?.library.refs ?? [], "style"),
      ...pastWork
        .filter(
          (item): item is BrandPastWorkItem & { imageUrl: string } =>
            Boolean(item.imageUrl)
        )
        .map((item) => ({
          id: `past-work-${item.id}`,
          url: item.imageUrl,
          label: `Past work style reference — ${item.title || "Untitled"}`,
          role: "style" as const,
          displayLabel: item.title || "Past work"
        }))
    ]
  };

  const toneAndStyleRule = findRuleByTitle(brandRules, "Tone & Style");
  const colorSwatches = extractColorSwatches(findRuleByTitle(brandRules, "Colors"));
  const secondaryColorSwatches = extractColorSwatches(
    findRuleByTitle(brandRules, "Secondary colors")
  );

  function renderCategoryBody(key: ReferenceLibraryCategory) {
    if (key === "product") {
      return (
        <div className="reference-category-body">
          {products.length ? (
            <div className="product-name-list">
              {products.map((productItem) => (
                <span className="memory-tag" key={productItem.id}>
                  {productItem.name}
                </span>
              ))}
            </div>
          ) : !loading ? (
            <p className="repository-message">
              No products added yet for this brand.
            </p>
          ) : null}
          <InlineAddForm
            placeholder="Product name"
            actionLabel="Add product"
            onAdd={addProduct}
          />
        </div>
      );
    }

    if (key === "material") {
      return (
        <div className="reference-category-body">
          {state.uploadedMaterials.length ? (
            <div className="reference-grid">
              {state.uploadedMaterials.map((material) => (
                <article
                  className="reference-item checked compass-library-material-item"
                  key={material.id}
                >
                  <img src={material.url} alt={material.name} />
                  <span>{material.name}</span>
                </article>
              ))}
            </div>
          ) : (
            <p className="repository-message">
              No materials added to this brief yet. Add product, person, or
              object images in the Materials panel.
            </p>
          )}
        </div>
      );
    }

    const candidates = candidatesByCategory[key];
    const hasToneAndStyle = key === "guideline" && Boolean(toneAndStyleRule);

    return (
      <div className="reference-category-body">
        {key === "guideline" && toneAndStyleRule ? (
          <div className="reference-tone-style">
            <b>Tone & Style</b>
            <p>{toneAndStyleRule.description}</p>
            <span className="reference-tone-style-note">
              Sent automatically as brand context with every generation.
            </span>
          </div>
        ) : null}

        {loading ? (
          <p className="repository-message">Loading library...</p>
        ) : candidates.length ? (
          <div className="reference-grid">
            {candidates.map((candidate) => {
              const checked = state.referenceImages.some(
                (item) => item.id === candidate.id
              );
              return (
                <label
                  className={`reference-item ${checked ? "checked" : ""}`}
                  key={candidate.id}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      dispatch({
                        type: "toggle-reference-image",
                        item: {
                          id: candidate.id,
                          url: candidate.url,
                          label: candidate.label,
                          role: candidate.role
                        }
                      })
                    }
                  />
                  <img src={candidate.url} alt={candidate.label} />
                  <span>{candidate.displayLabel ?? candidate.label}</span>
                </label>
              );
            })}
          </div>
        ) : !hasToneAndStyle && key !== "logo" ? (
          <p className="repository-message">
            No{" "}
            {REFERENCE_LIBRARY_CATEGORIES.find(
              ([id]) => id === key
            )?.[1].toLowerCase()}{" "}
            images available yet for this brand.
          </p>
        ) : null}

        {key === "logo" && clientId ? (
          <>
            {colorSwatches.length || secondaryColorSwatches.length ? (
              <div className="reference-color-groups">
                {colorSwatches.length ? (
                  <div className="reference-color-group">
                    <span className="reference-color-group-label">
                      Primary
                    </span>
                    <div className="memory-tags">
                      {colorSwatches.map((hex) => (
                        <BrandKitTag key={hex} value={hex} />
                      ))}
                    </div>
                  </div>
                ) : null}
                {secondaryColorSwatches.length ? (
                  <div className="reference-color-group">
                    <span className="reference-color-group-label">
                      Secondary
                    </span>
                    <div className="memory-tags">
                      {secondaryColorSwatches.map((hex) => (
                        <BrandKitTag key={hex} value={hex} />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            <BrandLogoCard
              clientId={clientId}
              logoItem={logoRule}
              onSaved={saveLatestLogoReference}
            />
            <InlineAddForm
              placeholder="#1D1D1F"
              actionLabel="Add color"
              onAdd={addColor}
            />
          </>
        ) : null}

        {key === "reference" && clientId ? (
          <InlineUploadForm
            actionLabel="Upload reference image"
            onUpload={onUploadReferenceImage}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="source-checks">
      <div className="reference-accordion">
        {REFERENCE_LIBRARY_CATEGORIES.map(([key, label]) => (
          <div className="reference-accordion-row" key={key}>
            <button
              className="reference-accordion-toggle"
              type="button"
              aria-expanded={openCategory === key}
              onClick={() => toggleExpanded(key)}
            >
              <b>{label}</b>
              <span
                className={`reference-toggle-icon ${openCategory === key ? "open" : ""}`}
                aria-hidden="true"
              >
                ⌄
              </span>
            </button>
            {openCategory === key ? renderCategoryBody(key) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function InlineAddForm({
  placeholder,
  actionLabel,
  onAdd
}: {
  placeholder: string;
  actionLabel: string;
  onAdd: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!value.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onAdd(value);
      setValue("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="inline-add-form">
      <input
        value={value}
        placeholder={placeholder}
        disabled={saving}
        onChange={(event) => setValue(event.target.value)}
      />
      <button
        type="button"
        className="btn secondary small"
        disabled={saving}
        onClick={() => void submit()}
      >
        {saving ? "Adding…" : actionLabel}
      </button>
      {error ? <p className="memory-error">{error}</p> : null}
    </div>
  );
}

function InlineUploadForm({
  actionLabel,
  onUpload
}: {
  actionLabel: string;
  onUpload: (file: File) => Promise<void>;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      await onUpload(file);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not upload image."
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="inline-add-form">
      <label
        className={`btn secondary small upload-inline ${uploading ? "disabled" : ""}`}
      >
        {uploading ? "Uploading…" : actionLabel}
        <input
          className="file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label={actionLabel}
          disabled={uploading}
          onChange={(event) => void handleUpload(event)}
        />
      </label>
      {error ? <p className="memory-error">{error}</p> : null}
    </div>
  );
}
