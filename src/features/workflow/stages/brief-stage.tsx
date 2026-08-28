import { useEffect, useId, useRef, useState, type ChangeEvent, type Dispatch, type DragEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, FolderSimple, ImageBroken, PencilSimple, Trash, UploadSimple } from "@phosphor-icons/react";
import { type LibraryItem } from "../../../domain/brand";
import { env } from "../../../config/env";
import { type BrandAssetFolder, type BrandAssetImage, type BrandAssetKind, type BrandPastWorkItem, type BrandProduct } from "../../../domain/brand-memory";
import { creativeMaterialRoles, inferredReferenceImageRole, MAX_HOOK_MATERIALS, MAX_HOOK_REFERENCE_IMAGES, referenceBoardRoleOptions, referenceHoldingRole, referenceImageRoleLabels, type CreativeMaterialRole, type UploadedCreativeMaterial, type ReferenceImageRole, type ReferenceImageSelection, type ServiceType } from "../../../domain/creative-run";
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
  eyebrow = "Manage library",
  busy,
  onClose,
  children,
  className
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
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
        className={`output-modal compass-library-edit-modal ${className ?? ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="output-modal-head compass-library-edit-head">
          <div>
            <p className="eyebrow">{eyebrow}</p>
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
const ASSET_IMAGE_PAGE_SIZE = 15;

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

export const creativeMaterialRoleLabels: Record<CreativeMaterialRole, string> = {
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

type AssetContextMenuState =
  | { type: "background"; x: number; y: number }
  | {
      type: "folder";
      x: number;
      y: number;
      folder: BrandAssetFolder;
      selection: AssetDragSelection;
    }
  | {
      type: "image";
      x: number;
      y: number;
      image: BrandAssetImage;
      selection: AssetDragSelection;
    };

const ASSET_SELECTION_DATA_TYPE = "application/x-brand-asset-selection";

function isAssetOrganizerDrag(dataTransfer: DataTransfer): boolean {
  return (
    dataTransfer.types.includes(ASSET_SELECTION_DATA_TYPE) ||
    dataTransfer.types.includes("application/x-brand-asset-image") ||
    dataTransfer.types.includes("application/x-brand-asset-folder")
  );
}

function assetSelectionKey(
  type: "folder" | "image",
  id: string
): string {
  return `${type}:${id}`;
}

interface AssetDragSelection {
  folderIds: readonly string[];
  imageIds: readonly string[];
}

interface AssetMoveUndo {
  label: string;
  folders: readonly { id: string; parentId: string | null }[];
  images: readonly { id: string; folderId: string | null }[];
}

function AssetContextMenu({
  menu,
  onClose,
  onNewFolder,
  onUploadFiles,
  onUploadFolder,
  onOpenFolder,
  onMoveSelection,
  onRenameFolder,
  onDeleteFolder
}: {
  menu: AssetContextMenuState;
  onClose: () => void;
  onNewFolder: () => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
  onOpenFolder: (folder: BrandAssetFolder) => void;
  onMoveSelection: (selection: AssetDragSelection) => void;
  onRenameFolder: (folder: BrandAssetFolder) => void;
  onDeleteFolder: (folder: BrandAssetFolder) => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    menuRef.current?.querySelector("button")?.focus();
  }, []);

  if (typeof document === "undefined") return null;
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - 188));
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - 132));

  function runAndClose(action: () => void) {
    action();
    onClose();
  }

  return createPortal(
    <div
      ref={menuRef}
      className="compass-asset-context-menu"
      role="menu"
      style={{ top, left }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {menu.type === "background" ? (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => runAndClose(onNewFolder)}
          >
            <FolderSimple aria-hidden="true" size={15} weight="bold" />
            New folder
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runAndClose(onUploadFiles)}
          >
            <UploadSimple aria-hidden="true" size={15} weight="bold" />
            Upload files
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runAndClose(onUploadFolder)}
          >
            <UploadSimple aria-hidden="true" size={15} weight="bold" />
            Upload folder
          </button>
        </>
      ) : menu.type === "folder" ? (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => runAndClose(() => onOpenFolder(menu.folder))}
          >
            <FolderSimple aria-hidden="true" size={15} weight="bold" />
            Open
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              runAndClose(() => onMoveSelection(menu.selection))
            }
          >
            <FolderSimple aria-hidden="true" size={15} weight="bold" />
            Move to…
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runAndClose(() => onRenameFolder(menu.folder))}
          >
            <PencilSimple aria-hidden="true" size={15} weight="bold" />
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => runAndClose(() => onDeleteFolder(menu.folder))}
          >
            <Trash aria-hidden="true" size={15} weight="bold" />
            Delete
          </button>
        </>
      ) : (
        <button
          type="button"
          role="menuitem"
          onClick={() => runAndClose(() => onMoveSelection(menu.selection))}
        >
          <FolderSimple aria-hidden="true" size={15} weight="bold" />
          Move to…
        </button>
      )}
    </div>,
    document.body
  );
}

export function CreativeMaterialsEditor({
  state,
  dispatch,
  kind = "material",
  legacyReferences = [],
  onAssetCountChange,
  targetDirectionId
}: StageProps & {
  kind?: BrandAssetKind;
  /** When set, selections attach to this Hook's own referenceImages/
   * uploadedMaterials instead of the shared brief-level board. */
  targetDirectionId?: string;
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
  const targetReferenceImages = targetDirectionId
    ? (state.directions.find((direction) => direction.id === targetDirectionId)
        ?.referenceImages ?? [])
    : state.referenceImages;
  const targetUploadedMaterials = targetDirectionId
    ? (state.directions.find((direction) => direction.id === targetDirectionId)
        ?.uploadedMaterials ?? [])
    : undefined;

  function toggleMaterialSelection(material: UploadedCreativeMaterial) {
    if (!targetDirectionId || !targetUploadedMaterials) return;
    const exists = targetUploadedMaterials.some(
      (existing) => existing.id === material.id || existing.url === material.url
    );
    if (!exists && targetUploadedMaterials.length >= MAX_HOOK_MATERIALS) {
      setUploadError(
        `Up to ${MAX_HOOK_MATERIALS} materials per hook — remove one to add another.`
      );
      return;
    }
    setUploadError(null);
    dispatch({
      type: "set-direction-uploaded-materials",
      id: targetDirectionId,
      materials: exists
        ? targetUploadedMaterials.filter(
            (existing) =>
              existing.id !== material.id && existing.url !== material.url
          )
        : [...targetUploadedMaterials, material]
    });
  }

  function isReferenceSelected(id: string, url?: string): boolean {
    return targetReferenceImages.some(
      (item) => item.id === id || (url !== undefined && item.url === url)
    );
  }

  function toggleReferenceSelection(item: ReferenceImageSelection) {
    if (targetDirectionId) {
      const exists = targetReferenceImages.some(
        (existing) => existing.id === item.id || existing.url === item.url
      );
      if (!exists && targetReferenceImages.length >= MAX_HOOK_REFERENCE_IMAGES) {
        setUploadError(
          `Up to ${MAX_HOOK_REFERENCE_IMAGES} references per hook — remove one to add another.`
        );
        return;
      }
      setUploadError(null);
      dispatch({
        type: "set-direction-reference-images",
        id: targetDirectionId,
        images: exists
          ? targetReferenceImages.filter(
              (existing) => existing.id !== item.id && existing.url !== item.url
            )
          : [...targetReferenceImages, item]
      });
      return;
    }
    dispatch({ type: "toggle-reference-image", item });
  }

  const [assetFolders, setAssetFolders] = useState<readonly BrandAssetFolder[]>(
    []
  );
  const [assetImages, setAssetImages] = useState<readonly BrandAssetImage[]>([]);
  const [currentAssetFolderId, setCurrentAssetFolderId] = useState<string | null>(
    null
  );
  const [selectedSortSnapshot, setSelectedSortSnapshot] = useState<
    ReadonlySet<string>
  >(new Set());
  const [visibleImageCount, setVisibleImageCount] = useState(
    ASSET_IMAGE_PAGE_SIZE
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
  const hiddenFileInputRef = useRef<HTMLInputElement | null>(null);
  const hiddenFolderInputRef = useRef<HTMLInputElement | null>(null);
  const [assetContextMenu, setAssetContextMenu] =
    useState<AssetContextMenuState | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(
    null
  );
  const [dragOverBreadcrumbKey, setDragOverBreadcrumbKey] = useState<
    string | null
  >(null);
  const [draggingAssetKeys, setDraggingAssetKeys] = useState<
    ReadonlySet<string>
  >(new Set());
  const [assetMoveUndo, setAssetMoveUndo] = useState<AssetMoveUndo | null>(null);
  const [moveDialogSelection, setMoveDialogSelection] =
    useState<AssetDragSelection | null>(null);
  const [assetMovePending, setAssetMovePending] = useState(false);
  const assetBrowserRef = useRef<HTMLDivElement | null>(null);
  const marqueeStartRef = useRef<{
    x: number;
    y: number;
    additive: boolean;
    initialSelection: ReadonlySet<string>;
  } | null>(null);
  const [assetOrganizerSelection, setAssetOrganizerSelection] = useState<
    ReadonlySet<string>
  >(new Set());
  const [marqueeRect, setMarqueeRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const selectedMaterials = selectedUploadedMaterials(state);
  const selectedReferenceImagesForRoleEditor = targetReferenceImages.filter(
    (reference) => inferredReferenceImageRole(reference) !== "logo"
  );
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
    setVisibleImageCount(ASSET_IMAGE_PAGE_SIZE);
    setAssetOrganizerSelection(new Set());
  }, [assetKind, currentAssetFolderId]);

  useEffect(() => {
    setSelectedSortSnapshot(
      new Set(
        assetImages
          .filter((image) =>
            image.kind === "material"
              ? isBrandAssetSelected(image, state, targetDirectionId)
              : isReferenceSelected(`brand-asset-${image.id}`, image.url)
          )
          .map((image) => image.id)
      )
    );
    // Freezes the "selected first" sort order to whatever was selected when
    // this list was (re)fetched or the folder changed, so clicking Select on
    // an image doesn't reshuffle the whole grid under the user mid-click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetImages, assetKind, currentAssetFolderId]);

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

  useEffect(() => {
    if (!assetContextMenu) return;
    function close() {
      setAssetContextMenu(null);
    }
    function closeFromOutside(event: globalThis.MouseEvent) {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(".compass-asset-context-menu")
      ) {
        return;
      }
      close();
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("mousedown", closeFromOutside);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeFromOutside);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [assetContextMenu]);

  useEffect(() => {
    if (!assetMoveUndo) return;
    const timeout = window.setTimeout(() => setAssetMoveUndo(null), 7000);
    return () => window.clearTimeout(timeout);
  }, [assetMoveUndo]);

  useEffect(() => {
    function updateMarquee(event: globalThis.MouseEvent): void {
      const start = marqueeStartRef.current;
      if (!start) return;
      const left = Math.min(start.x, event.clientX);
      const top = Math.min(start.y, event.clientY);
      const right = Math.max(start.x, event.clientX);
      const bottom = Math.max(start.y, event.clientY);
      setMarqueeRect({
        left,
        top,
        width: right - left,
        height: bottom - top
      });

      const next = new Set(start.additive ? start.initialSelection : []);
      assetBrowserRef.current
        ?.querySelectorAll<HTMLElement>("[data-asset-selection-key]")
        .forEach((element) => {
          const key = element.dataset.assetSelectionKey;
          if (!key) return;
          const bounds = element.getBoundingClientRect();
          if (
            bounds.right >= left &&
            bounds.left <= right &&
            bounds.bottom >= top &&
            bounds.top <= bottom
          ) {
            next.add(key);
          }
        });
      setAssetOrganizerSelection(next);
    }

    function finishMarquee(): void {
      if (!marqueeStartRef.current) return;
      marqueeStartRef.current = null;
      setMarqueeRect(null);
    }

    window.addEventListener("mousemove", updateMarquee);
    window.addEventListener("mouseup", finishMarquee);
    return () => {
      window.removeEventListener("mousemove", updateMarquee);
      window.removeEventListener("mouseup", finishMarquee);
    };
  }, []);

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
        if (targetDirectionId && targetUploadedMaterials) {
          dispatch({
            type: "set-direction-uploaded-materials",
            id: targetDirectionId,
            materials: [...targetUploadedMaterials, ...items]
          });
        } else {
          dispatch({ type: "add-uploaded-materials", items });
        }
      }
    } catch (caught) {
      setUploadError(
        caught instanceof Error ? caught.message : "Could not upload the image."
      );
    } finally {
      setUploadPending(false);
    }
  }

  async function handleFolderUpload(event: ChangeEvent<HTMLInputElement>) {
    const allFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!allFiles.length) return;
    const files = allFiles.filter((file) =>
      /^image\/(png|jpeg|webp)$/.test(file.type)
    );
    if (!files.length) {
      setUploadError("No supported images (PNG, JPEG, WebP) found in that folder.");
      return;
    }
    if (files.length > 200) {
      setUploadError("Upload up to 200 images at a time.");
      return;
    }
    const clientId = state.brand?.id;
    if (!clientId) {
      setUploadError("Choose a brand before uploading a folder.");
      return;
    }

    setUploadPending(true);
    setUploadError(null);
    try {
      const relativePathOf = (file: File) =>
        (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
        file.name;
      const dirPaths = new Set<string>();
      files.forEach((file) => {
        const segments = relativePathOf(file).split("/").slice(0, -1);
        for (let depth = 1; depth <= segments.length; depth += 1) {
          dirPaths.add(segments.slice(0, depth).join("/"));
        }
      });
      const orderedPaths = [...dirPaths].sort(
        (a, b) => a.split("/").length - b.split("/").length
      );
      const folderIdByPath = new Map<string, string>();
      const newFolders: BrandAssetFolder[] = [];
      for (const path of orderedPaths) {
        const segments = path.split("/");
        const parentPath = segments.slice(0, -1).join("/");
        const parentId = parentPath
          ? folderIdByPath.get(parentPath)
          : (currentAssetFolderId ?? undefined);
        const folder = await brandMemoryRepository.createAssetFolder({
          clientId,
          kind: assetKind,
          name: segments[segments.length - 1] ?? path,
          parentId
        });
        folderIdByPath.set(path, folder.id);
        newFolders.push(folder);
      }
      setAssetFolders((folders) => mergeBrandAssetFolders(folders, newFolders));

      const newImages = await Promise.all(
        files.map((file) => {
          const dirPath = relativePathOf(file).split("/").slice(0, -1).join("/");
          const folderId = dirPath
            ? folderIdByPath.get(dirPath)
            : (currentAssetFolderId ?? undefined);
          return brandMemoryRepository.createAssetImage({
            clientId,
            kind: assetKind,
            folderId,
            file
          });
        })
      );
      setAssetImages((current) => mergeBrandAssetImages(current, newImages));
    } catch (caught) {
      setUploadError(
        caught instanceof Error ? caught.message : "Could not upload the folder."
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
      if (targetDirectionId && targetUploadedMaterials) {
        const material = targetUploadedMaterials.find(
          (item) => item.id === selectionId
        );
        if (material) toggleMaterialSelection(material);
        return;
      }
      if (state.uploadedMaterials.some((item) => item.id === selectionId)) {
        dispatch({ type: "remove-uploaded-material", id: selectionId });
      }
      return;
    }
    const reference = targetReferenceImages.find(
      (item) => item.id === selectionId
    );
    if (reference) {
      toggleReferenceSelection(reference);
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

  async function performDeleteAssetFolder(
    folder: BrandAssetFolder
  ): Promise<void> {
    if (folderMutationPending) return;
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
      const deletedImageIds = new Set(deletedImages.map((image) => image.id));
      setAssetOrganizerSelection(
        (selection) =>
          new Set(
            [...selection].filter((key) => {
              if (key.startsWith("folder:")) {
                return !deletedFolderIds.has(key.slice("folder:".length));
              }
              return !deletedImageIds.has(key.slice("image:".length));
            })
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

  async function deleteAssetFolder(): Promise<void> {
    if (!editingAssetFolder) return;
    await performDeleteAssetFolder(editingAssetFolder);
  }

  async function moveImageToFolder(
    asset: BrandAssetImage,
    folderId: string | null
  ): Promise<boolean> {
    if (asset.folderId === folderId) return false;
    setUploadError(null);
    try {
      const updated = await brandMemoryRepository.moveAssetImage({
        id: asset.id,
        folderId
      });
      setAssetImages((images) => mergeBrandAssetImages(images, [updated]));
      return true;
    } catch (caught) {
      setUploadError(
        caught instanceof Error ? caught.message : "Could not move the image."
      );
      return false;
    }
  }

  async function moveFolderToFolder(
    folder: BrandAssetFolder,
    parentId: string | null
  ): Promise<boolean> {
    if (folder.id === parentId || folder.parentId === parentId) return false;
    const descendantIds = brandAssetFolderSubtreeIds(folder.id, assetFolders);
    if (parentId && descendantIds.has(parentId)) {
      setUploadError("Can't move a folder into its own subfolder.");
      return false;
    }
    setUploadError(null);
    try {
      const updated = await brandMemoryRepository.moveAssetFolder({
        id: folder.id,
        parentId
      });
      setAssetFolders((folders) => mergeBrandAssetFolders(folders, [updated]));
      return true;
    } catch (caught) {
      setUploadError(
        caught instanceof Error ? caught.message : "Could not move the folder."
      );
      return false;
    }
  }

  function assetDragSelectionFromKeys(
    keys: ReadonlySet<string>
  ): AssetDragSelection {
    return {
      folderIds: [...keys].flatMap((key) =>
        key.startsWith("folder:") ? [key.slice("folder:".length)] : []
      ),
      imageIds: [...keys].flatMap((key) =>
        key.startsWith("image:") ? [key.slice("image:".length)] : []
      )
    };
  }

  function selectedAssetsForDrag(
    type: "folder" | "image",
    id: string
  ): AssetDragSelection {
    const draggedKey = assetSelectionKey(type, id);
    const keys = assetOrganizerSelection.has(draggedKey)
      ? assetOrganizerSelection
      : new Set([draggedKey]);
    if (!assetOrganizerSelection.has(draggedKey)) {
      setAssetOrganizerSelection(keys);
    }
    return assetDragSelectionFromKeys(keys);
  }

  function prepareAssetDrag(
    event: DragEvent<HTMLElement>,
    type: "folder" | "image",
    id: string
  ): void {
    const selection = selectedAssetsForDrag(type, id);
    setDraggingAssetKeys(
      new Set([
        ...selection.folderIds.map((folderId) =>
          assetSelectionKey("folder", folderId)
        ),
        ...selection.imageIds.map((imageId) =>
          assetSelectionKey("image", imageId)
        )
      ])
    );
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      ASSET_SELECTION_DATA_TYPE,
      JSON.stringify(selection)
    );
    event.dataTransfer.setData(
      type === "folder"
        ? "application/x-brand-asset-folder"
        : "application/x-brand-asset-image",
      id
    );
    if (typeof event.dataTransfer.setDragImage === "function") {
      const source = event.currentTarget;
      const preview = source.cloneNode(true) as HTMLElement;
      const itemCount = selection.folderIds.length + selection.imageIds.length;
      const sourceWidth = source.getBoundingClientRect().width;
      preview.classList.remove("compass-asset-organizer-selected");
      preview.classList.add("compass-asset-drag-preview");
      preview.removeAttribute("data-asset-selection-key");
      preview.style.width = `${Math.max(160, Math.min(sourceWidth || 210, 240))}px`;
      preview.setAttribute("aria-hidden", "true");
      if (itemCount > 1) {
        const count = document.createElement("span");
        count.className = "compass-asset-drag-preview-count";
        count.textContent = String(itemCount);
        preview.appendChild(count);
      }
      (source.closest(".compass-app") ?? document.body).appendChild(preview);
      event.dataTransfer.setDragImage(preview, 24, 24);
      window.setTimeout(() => preview.remove(), 0);
    }
  }

  function readAssetDragSelection(dataTransfer: DataTransfer): AssetDragSelection {
    const serialized = dataTransfer.getData(ASSET_SELECTION_DATA_TYPE);
    if (serialized) {
      try {
        const parsed = JSON.parse(serialized) as Partial<AssetDragSelection>;
        return {
          folderIds: Array.isArray(parsed.folderIds)
            ? parsed.folderIds.filter(
                (id): id is string => typeof id === "string"
              )
            : [],
          imageIds: Array.isArray(parsed.imageIds)
            ? parsed.imageIds.filter(
                (id): id is string => typeof id === "string"
              )
            : []
        };
      } catch {
        // Fall through to the single-item drag formats used by older clients.
      }
    }
    const imageId = dataTransfer.getData("application/x-brand-asset-image");
    const folderId = dataTransfer.getData("application/x-brand-asset-folder");
    return {
      folderIds: folderId ? [folderId] : [],
      imageIds: imageId ? [imageId] : []
    };
  }

  async function moveAssetSelectionToFolder(
    selection: AssetDragSelection,
    targetFolderId: string | null
  ): Promise<boolean> {
    if (assetMovePending) return false;
    const images = selection.imageIds.flatMap((id) => {
      const image = assetImages.find((candidate) => candidate.id === id);
      return image && image.folderId !== targetFolderId ? [image] : [];
    });
    const folders = selection.folderIds.flatMap((id) => {
      if (id === targetFolderId) return [];
      const folder = assetFolders.find((candidate) => candidate.id === id);
      return folder && folder.parentId !== targetFolderId ? [folder] : [];
    });
    if (!images.length && !folders.length) return false;

    setAssetMovePending(true);
    try {
      const [movedImages, movedFolders] = await Promise.all([
        Promise.all(
          images.map((image) => moveImageToFolder(image, targetFolderId))
        ),
        Promise.all(
          folders.map((folder) => moveFolderToFolder(folder, targetFolderId))
        )
      ]);
      const undoImages = images
        .filter((_, index) => movedImages[index])
        .map((image) => ({ id: image.id, folderId: image.folderId }));
      const undoFolders = folders
        .filter((_, index) => movedFolders[index])
        .map((folder) => ({ id: folder.id, parentId: folder.parentId }));
      const movedCount = undoImages.length + undoFolders.length;
      if (movedCount) {
        const targetName = targetFolderId
          ? (assetFolders.find((folder) => folder.id === targetFolderId)?.name ??
            "folder")
          : "Root";
        setAssetMoveUndo({
          label: `Moved ${movedCount} ${pluralize(movedCount, "item")} to ${targetName}`,
          images: undoImages,
          folders: undoFolders
        });
      }
      setAssetOrganizerSelection(new Set());
      return movedCount > 0;
    } finally {
      setAssetMovePending(false);
    }
  }

  async function undoLastAssetMove(): Promise<void> {
    const undo = assetMoveUndo;
    if (!undo || assetMovePending) return;
    setAssetMovePending(true);
    try {
      await Promise.all([
        ...undo.images.map(async ({ id, folderId }) => {
          const image = assetImages.find((candidate) => candidate.id === id);
          if (image) await moveImageToFolder(image, folderId);
        }),
        ...undo.folders.map(async ({ id, parentId }) => {
          const folder = assetFolders.find((candidate) => candidate.id === id);
          if (folder) await moveFolderToFolder(folder, parentId);
        })
      ]);
      setAssetMoveUndo(null);
    } finally {
      setAssetMovePending(false);
    }
  }

  function clearAssetDragTargets(): void {
    setDragOverFolderId(null);
    setDragOverBreadcrumbKey(null);
    setDraggingAssetKeys(new Set());
  }

  function markAssetFolderDropTarget(
    event: DragEvent<HTMLElement>,
    folder: BrandAssetFolder
  ): void {
    const selection = readAssetDragSelection(event.dataTransfer);
    const invalidTarget = selection.folderIds.some((folderId) =>
      brandAssetFolderSubtreeIds(folderId, assetFolders).has(folder.id)
    );
    setDragOverFolderId(invalidTarget ? null : folder.id);
  }

  function handleAssetDrop(
    event: DragEvent<HTMLElement>,
    targetFolderId: string | null
  ): void {
    event.preventDefault();
    event.stopPropagation();
    clearAssetDragTargets();
    void moveAssetSelectionToFolder(
      readAssetDragSelection(event.dataTransfer),
      targetFolderId
    );
  }

  function handleAssetBrowserMouseDown(
    event: ReactMouseEvent<HTMLDivElement>
  ): void {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, label, form, [role='menu']")) return;
    const item = target.closest<HTMLElement>("[data-asset-selection-key]");
    if (item?.dataset.assetSelectionKey) {
      const key = item.dataset.assetSelectionKey;
      setAssetOrganizerSelection((current) => {
        if (event.metaKey || event.ctrlKey) {
          const next = new Set(current);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        }
        return current.has(key) ? current : new Set([key]);
      });
      return;
    }
    if (target.closest("article")) return;
    const additive = event.metaKey || event.ctrlKey;
    marqueeStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      additive,
      initialSelection: assetOrganizerSelection
    };
    if (!additive) setAssetOrganizerSelection(new Set());
    setMarqueeRect({
      left: event.clientX,
      top: event.clientY,
      width: 0,
      height: 0
    });
    event.preventDefault();
  }

  function openAssetContextMenu(
    event: ReactMouseEvent<HTMLDivElement>
  ): void {
    event.preventDefault();
    event.stopPropagation();
    const target = event.target;
    const folderId =
      target instanceof Element
        ? target.closest<HTMLElement>("[data-asset-folder-id]")?.dataset
            .assetFolderId
        : undefined;
    const imageId =
      target instanceof Element
        ? target.closest<HTMLElement>("[data-asset-image-id]")?.dataset
            .assetImageId
        : undefined;
    const folder = folderId
      ? assetFolders.find((candidate) => candidate.id === folderId)
      : undefined;
    const image = imageId
      ? assetImages.find((candidate) => candidate.id === imageId)
      : undefined;
    if (folder) {
      const key = assetSelectionKey("folder", folder.id);
      const keys = assetOrganizerSelection.has(key)
        ? assetOrganizerSelection
        : new Set([key]);
      if (!assetOrganizerSelection.has(key)) setAssetOrganizerSelection(keys);
      setAssetContextMenu({
        type: "folder",
        x: event.clientX,
        y: event.clientY,
        folder,
        selection: assetDragSelectionFromKeys(keys)
      });
      return;
    }
    if (image) {
      const key = assetSelectionKey("image", image.id);
      const keys = assetOrganizerSelection.has(key)
        ? assetOrganizerSelection
        : new Set([key]);
      if (!assetOrganizerSelection.has(key)) setAssetOrganizerSelection(keys);
      setAssetContextMenu({
        type: "image",
        x: event.clientX,
        y: event.clientY,
        image,
        selection: assetDragSelectionFromKeys(keys)
      });
      return;
    }
    setAssetOrganizerSelection(new Set());
    setAssetContextMenu({
      type: "background",
      x: event.clientX,
      y: event.clientY
    });
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
      setAssetOrganizerSelection((selection) => {
        const next = new Set(selection);
        next.delete(assetSelectionKey("image", asset.id));
        return next;
      });
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
      toggleReferenceSelection(item);
      return;
    }
    const id = `brand-asset-${asset.id}`;
    if (targetDirectionId) {
      toggleMaterialSelection({
        id,
        name: asset.name,
        mediaType: asset.mimeType,
        role: "main-object",
        description: "",
        url: asset.url,
        storagePath: asset.storagePath,
        storageBucket: env.brandAssetsBucket
      });
      return;
    }
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
    toggleReferenceSelection({
      id: `brand-library-${item.id}`,
      url: item.assetUrl,
      label: item.title,
      role: "style"
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
  const currentAssetFolderTrail = currentAssetFolder
    ? brandAssetFolderTrail(currentAssetFolder, assetFolders)
    : [];
  const parentDropKey = currentAssetFolder?.parentId
    ? `folder:${currentAssetFolder.parentId}`
    : "root";
  const visibleAssetFolders = assetFolders.filter(
    (folder) =>
      folder.kind === assetKind &&
      folder.parentId === (currentAssetFolder?.id ?? null)
  );
  const visibleAssetImages = assetImages
    .filter(
      (image) =>
        image.kind === assetKind &&
        image.folderId === (currentAssetFolder?.id ?? null)
    )
    .sort(
      (a, b) =>
        Number(selectedSortSnapshot.has(b.id)) -
        Number(selectedSortSnapshot.has(a.id))
    );
  const pagedAssetImages = visibleAssetImages.slice(0, visibleImageCount);
  const hasMoreAssetImages = visibleAssetImages.length > visibleImageCount;
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
  const dragDestinationLabel = dragOverFolderId
    ? assetFolders.find((folder) => folder.id === dragOverFolderId)?.name
    : dragOverBreadcrumbKey === "root"
      ? "Root"
      : dragOverBreadcrumbKey?.startsWith("folder:")
        ? assetFolders.find(
            (folder) =>
              folder.id === dragOverBreadcrumbKey.slice("folder:".length)
          )?.name
        : undefined;
  const invalidMoveTargetIds = new Set<string>();
  moveDialogSelection?.folderIds.forEach((folderId) => {
    brandAssetFolderSubtreeIds(folderId, assetFolders).forEach((id) =>
      invalidMoveTargetIds.add(id)
    );
  });
  const moveDialogTargets = assetFolders
    .filter(
      (folder) =>
        folder.kind === assetKind && !invalidMoveTargetIds.has(folder.id)
    )
    .slice()
    .sort((left, right) =>
      brandAssetFolderPath(left, assetFolders).localeCompare(
        brandAssetFolderPath(right, assetFolders)
      )
    );

  return (
    <div className="compass-creative-material-editor">
      {state.brand ? (
        <div
          ref={assetBrowserRef}
          className="compass-asset-library-browser"
          onMouseDown={handleAssetBrowserMouseDown}
          onContextMenuCapture={openAssetContextMenu}
          onDragOver={(event) => {
            if (!isAssetOrganizerDrag(event.dataTransfer)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            const target = event.target;
            if (
              target instanceof Element &&
              target.closest(
                "[data-asset-folder-id], .compass-asset-breadcrumbs, .compass-asset-parent-folder"
              )
            ) {
              return;
            }
            setDragOverBreadcrumbKey(
              currentAssetFolder ? `folder:${currentAssetFolder.id}` : "root"
            );
          }}
          onDrop={(event) => {
            if (!isAssetOrganizerDrag(event.dataTransfer)) return;
            handleAssetDrop(event, currentAssetFolder?.id ?? null);
          }}
        >
          <input
            ref={hiddenFileInputRef}
            className="file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            aria-hidden="true"
            tabIndex={-1}
            style={{ display: "none" }}
            onChange={handleUpload}
          />
          <input
            ref={hiddenFolderInputRef}
            className="file-input"
            type="file"
            multiple
            aria-hidden="true"
            tabIndex={-1}
            style={{ display: "none" }}
            onChange={handleFolderUpload}
            {...({ webkitdirectory: "", directory: "" } as Record<
              string,
              string
            >)}
          />
          <nav aria-label={`${assetKind} library folder path`}>
            <button
              className={`compass-asset-parent-folder${
                dragOverBreadcrumbKey === parentDropKey
                  ? " compass-asset-parent-drop-target"
                  : ""
              }`}
              type="button"
              aria-label="Go to parent folder"
              title={
                currentAssetFolder
                  ? "Drop here to move the selection out of this folder"
                  : undefined
              }
              disabled={!currentAssetFolder}
              onClick={() =>
                setCurrentAssetFolderId(currentAssetFolder?.parentId ?? null)
              }
              onDragOver={(event) => {
                if (!currentAssetFolder) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDragEnter={() => {
                if (currentAssetFolder) {
                  setDragOverBreadcrumbKey(parentDropKey);
                }
              }}
              onDragLeave={() => setDragOverBreadcrumbKey(null)}
              onDrop={(event) => {
                if (!currentAssetFolder) return;
                handleAssetDrop(event, currentAssetFolder.parentId);
              }}
            >
              <ArrowLeft aria-hidden="true" size={15} weight="bold" />
              <span>
                {dragOverBreadcrumbKey === parentDropKey ? "Move out" : "Back"}
              </span>
            </button>
            <div className="compass-asset-breadcrumbs">
              <button
                className={
                  dragOverBreadcrumbKey === "root"
                    ? "compass-asset-breadcrumb-drop-target"
                    : undefined
                }
                type="button"
                aria-label={`Open ${assetKind} library root`}
                aria-current={!currentAssetFolder ? "page" : undefined}
                onClick={() => setCurrentAssetFolderId(null)}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDragEnter={() => setDragOverBreadcrumbKey("root")}
                onDragLeave={() => setDragOverBreadcrumbKey(null)}
                onDrop={(event) => handleAssetDrop(event, null)}
              >
                {state.brand.name} /{" "}
                {assetKind === "material" ? "Materials" : "References"}
              </button>
              {currentAssetFolderTrail.map((folder) => {
                const dropKey = `folder:${folder.id}`;
                return (
                  <span key={folder.id}>
                    <i aria-hidden="true">/</i>
                    <button
                      className={
                        dragOverBreadcrumbKey === dropKey
                          ? "compass-asset-breadcrumb-drop-target"
                          : undefined
                      }
                      type="button"
                      aria-label={`Open folder ${folder.name}`}
                      aria-current={
                        folder.id === currentAssetFolder?.id ? "page" : undefined
                      }
                      onClick={() => setCurrentAssetFolderId(folder.id)}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }}
                      onDragEnter={() => setDragOverBreadcrumbKey(dropKey)}
                      onDragLeave={() => setDragOverBreadcrumbKey(null)}
                      onDrop={(event) => handleAssetDrop(event, folder.id)}
                    >
                      {folder.name}
                    </button>
                  </span>
                );
              })}
            </div>
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
          {assetOrganizerSelection.size ? (
            <div className="compass-asset-organizer-selection" role="status">
              <b>
                {assetOrganizerSelection.size}{" "}
                {pluralize(assetOrganizerSelection.size, "item")} selected
              </b>
              <span>
                {dragDestinationLabel
                  ? `Release to move to ${dragDestinationLabel}`
                  : "Drag onto a folder or breadcrumb to move the selection."}
              </span>
              <button
                type="button"
                onClick={() => setAssetOrganizerSelection(new Set())}
              >
                Clear selection
              </button>
            </div>
          ) : null}
          {assetMoveUndo ? (
            <div className="compass-asset-move-undo" role="status">
              <span>{assetMoveUndo.label}</span>
              <button
                type="button"
                disabled={assetMovePending}
                onClick={() => void undoLastAssetMove()}
              >
                Undo
              </button>
            </div>
          ) : null}
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
                  <article
                    key={folder.id}
                    className={[
                      dragOverFolderId === folder.id
                        ? "compass-asset-drop-target"
                        : "",
                      assetOrganizerSelection.has(
                        assetSelectionKey("folder", folder.id)
                      )
                        ? "compass-asset-organizer-selected"
                        : "",
                      draggingAssetKeys.has(
                        assetSelectionKey("folder", folder.id)
                      )
                        ? "compass-asset-drag-source"
                        : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    data-asset-selection-key={assetSelectionKey(
                      "folder",
                      folder.id
                    )}
                    data-asset-folder-id={folder.id}
                    aria-selected={assetOrganizerSelection.has(
                      assetSelectionKey("folder", folder.id)
                    )}
                    draggable
                    onDragStart={(event) => {
                      prepareAssetDrag(event, "folder", folder.id);
                    }}
                    onDragEnd={clearAssetDragTargets}
                    onDragOver={(event) => {
                      if (isAssetOrganizerDrag(event.dataTransfer)) {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }
                    }}
                    onDragEnter={(event) =>
                      markAssetFolderDropTarget(event, folder)
                    }
                    onDragLeave={(event) => {
                      const nextTarget = event.relatedTarget;
                      if (
                        nextTarget instanceof Node &&
                        event.currentTarget.contains(nextTarget)
                      ) {
                        return;
                      }
                      setDragOverFolderId((current) =>
                        current === folder.id ? null : current
                      );
                    }}
                    onDrop={(event) => handleAssetDrop(event, folder.id)}
                  >
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
                {pagedAssetImages.map((asset) => {
                  const selected =
                    asset.kind === "material"
                      ? isBrandAssetSelected(asset, state, targetDirectionId)
                      : isReferenceSelected(`brand-asset-${asset.id}`, asset.url);
                  return (
                    <article
                      key={asset.id}
                      className={[
                        assetOrganizerSelection.has(
                          assetSelectionKey("image", asset.id)
                        )
                          ? "compass-asset-organizer-selected"
                          : "",
                        draggingAssetKeys.has(
                          assetSelectionKey("image", asset.id)
                        )
                          ? "compass-asset-drag-source"
                          : ""
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      data-asset-selection-key={assetSelectionKey(
                        "image",
                        asset.id
                      )}
                      data-asset-image-id={asset.id}
                      aria-selected={assetOrganizerSelection.has(
                        assetSelectionKey("image", asset.id)
                      )}
                      draggable
                      onDragStart={(event) => {
                        prepareAssetDrag(event, "image", asset.id);
                      }}
                      onDragEnd={clearAssetDragTargets}
                    >
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
                  const selected = isReferenceSelected(
                    `brand-library-${item.id}`,
                    item.assetUrl
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
              {hasMoreAssetImages ? (
                <button
                  className="btn secondary small compass-asset-see-more"
                  type="button"
                  onClick={() =>
                    setVisibleImageCount(
                      (count) => count + ASSET_IMAGE_PAGE_SIZE
                    )
                  }
                >
                  See more ({visibleAssetImages.length - pagedAssetImages.length}{" "}
                  more)
                </button>
              ) : null}
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
            ? targetDirectionId && targetUploadedMaterials
              ? `${targetUploadedMaterials.length}/${MAX_HOOK_MATERIALS} materials selected`
              : `${selectedMaterials.length}/8 materials selected`
            : `${targetReferenceImages.length}/${MAX_HOOK_REFERENCE_IMAGES} references selected`}
        </span>
      </div>
      <p className="compass-creative-material-helper">
        {assetKind === "material"
          ? "Only materials you mark Selected are sent to the Hook Agent and Image Agent."
          : "Only references you mark Selected are used as style and composition context."}
      </p>
      {assetKind === "material" &&
      (targetDirectionId
        ? (targetUploadedMaterials?.length ?? 0)
        : state.uploadedMaterials.length) ? (
        <section className="compass-selected-materials">
          <header>
            <b>Selected for this brief</b>
            <span>Set each image role before generation.</span>
          </header>
          <div className="compass-creative-material-grid">
            {(targetDirectionId
              ? (targetUploadedMaterials ?? [])
              : state.uploadedMaterials
            ).map((material) => (
            <article
              className={`compass-creative-material-card ${
                targetDirectionId || material.selected !== false
                  ? "selected"
                  : ""
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
                      targetDirectionId
                        ? toggleMaterialSelection(material)
                        : dispatch({
                            type: "remove-uploaded-material",
                            id: material.id
                          })
                    }
                  >
                    ×
                  </button>
                </div>
                {targetDirectionId ? null : (
                  <button
                    className="compass-material-select"
                    type="button"
                    aria-pressed={material.selected !== false}
                    onClick={() => toggleMaterial(material)}
                  >
                    {material.selected !== false ? "Selected" : "Select"}
                  </button>
                )}
                <label>
                  Use as
                  <select
                    value={material.role}
                    onChange={(event) => {
                      const role = event.target.value as CreativeMaterialRole;
                      if (targetDirectionId && targetUploadedMaterials) {
                        dispatch({
                          type: "set-direction-uploaded-materials",
                          id: targetDirectionId,
                          materials: targetUploadedMaterials.map((item) =>
                            item.id === material.id ? { ...item, role } : item
                          )
                        });
                        return;
                      }
                      dispatch({
                        type: "update-uploaded-material",
                        id: material.id,
                        changes: { role }
                      });
                    }}
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
                    onChange={(event) => {
                      const description = event.target.value;
                      if (targetDirectionId && targetUploadedMaterials) {
                        dispatch({
                          type: "set-direction-uploaded-materials",
                          id: targetDirectionId,
                          materials: targetUploadedMaterials.map((item) =>
                            item.id === material.id
                              ? { ...item, description }
                              : item
                          )
                        });
                        return;
                      }
                      dispatch({
                        type: "update-uploaded-material",
                        id: material.id,
                        changes: { description }
                      });
                    }}
                  />
                </label>
              </div>
            </article>
            ))}
          </div>
        </section>
      ) : null}
      {assetKind === "reference" && selectedReferenceImagesForRoleEditor.length ? (
        <section className="compass-selected-materials">
          <header>
            <b>Selected for this brief</b>
            <span>Set what each reference is for before generation.</span>
          </header>
          <div className="compass-creative-material-grid">
            {selectedReferenceImagesForRoleEditor.map((reference) => {
              return (
                <article className="compass-creative-material-card selected" key={reference.id}>
                  <img src={reference.url} alt={reference.label} />
                  <div className="compass-creative-material-fields">
                    <div className="compass-creative-material-name">
                      <b>{reference.label}</b>
                      <button
                        type="button"
                        aria-label={`Remove ${reference.label}`}
                        onClick={() => toggleReferenceSelection(reference)}
                      >
                        ×
                      </button>
                    </div>
                    <label>
                      Use for
                      <select
                        value={inferredReferenceImageRole(reference)}
                        onChange={(event) => {
                          const nextRole = event.target.value as ReferenceImageRole;
                          const previousRole = inferredReferenceImageRole(reference);
                          const swapWith = referenceHoldingRole(
                            selectedReferenceImagesForRoleEditor,
                            reference.id,
                            nextRole
                          );
                          if (targetDirectionId) {
                            dispatch({
                              type: "set-direction-reference-images",
                              id: targetDirectionId,
                              images: selectedReferenceImagesForRoleEditor.map(
                                (item) => {
                                  if (item.id === reference.id) {
                                    return { ...item, role: nextRole };
                                  }
                                  if (swapWith && item.id === swapWith.id) {
                                    return { ...item, role: previousRole };
                                  }
                                  return item;
                                }
                              )
                            });
                            return;
                          }
                          dispatch({
                            type: "set-reference-image-role",
                            id: reference.id,
                            role: nextRole
                          });
                          if (swapWith) {
                            dispatch({
                              type: "set-reference-image-role",
                              id: swapWith.id,
                              role: previousRole
                            });
                          }
                        }}
                      >
                        {referenceBoardRoleOptions.map((role) => (
                          <option value={role} key={role}>
                            {referenceImageRoleLabels[role]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </article>
              );
            })}
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
      {moveDialogSelection ? (
        <LibraryEditModal
          title="Move to…"
          description="Choose Root or another folder. Folders cannot be moved into themselves or their descendants."
          busy={assetMovePending}
          onClose={() => setMoveDialogSelection(null)}
          className="compass-asset-move-dialog"
        >
          <div className="compass-asset-move-destinations">
            <button
              type="button"
              disabled={assetMovePending}
              onClick={() => {
                void moveAssetSelectionToFolder(moveDialogSelection, null).then(
                  (moved) => {
                    if (moved) setMoveDialogSelection(null);
                  }
                );
              }}
            >
              <FolderSimple aria-hidden="true" size={17} weight="duotone" />
              <span>
                <b>Root</b>
                <small>
                  {state.brand?.name} /{" "}
                  {assetKind === "material" ? "Materials" : "References"}
                </small>
              </span>
            </button>
            {moveDialogTargets.map((folder) => (
              <button
                key={folder.id}
                type="button"
                disabled={assetMovePending}
                onClick={() => {
                  void moveAssetSelectionToFolder(
                    moveDialogSelection,
                    folder.id
                  ).then((moved) => {
                    if (moved) setMoveDialogSelection(null);
                  });
                }}
              >
                <FolderSimple aria-hidden="true" size={17} weight="duotone" />
                <span>
                  <b>{folder.name}</b>
                  <small>{brandAssetFolderPath(folder, assetFolders)}</small>
                </span>
              </button>
            ))}
          </div>
        </LibraryEditModal>
      ) : null}
      {assetContextMenu ? (
        <AssetContextMenu
          menu={assetContextMenu}
          onClose={() => setAssetContextMenu(null)}
          onNewFolder={() => setAssetActionPopup("folder")}
          onUploadFiles={() => hiddenFileInputRef.current?.click()}
          onUploadFolder={() => hiddenFolderInputRef.current?.click()}
          onOpenFolder={(folder) => void openSavedAssetFolder(folder)}
          onMoveSelection={setMoveDialogSelection}
          onRenameFolder={openAssetFolderEditor}
          onDeleteFolder={(folder) => void performDeleteAssetFolder(folder)}
        />
      ) : null}
      {marqueeRect ? (
        <div
          className="compass-asset-selection-marquee"
          aria-hidden="true"
          style={marqueeRect}
        />
      ) : null}
    </div>
  );
}

function isBrandAssetSelected(
  asset: BrandAssetImage,
  state: WorkflowState,
  targetDirectionId?: string
): boolean {
  if (asset.kind === "material") {
    if (targetDirectionId) {
      const direction = state.directions.find(
        (candidate) => candidate.id === targetDirectionId
      );
      return (direction?.uploadedMaterials ?? []).some(
        (item) => item.id === `brand-asset-${asset.id}` || item.url === asset.url
      );
    }
    return state.uploadedMaterials.some(
      (item) => item.id === `brand-asset-${asset.id}` && item.selected !== false
    );
  }
  return state.referenceImages.some(
    (item) => item.id === `brand-asset-${asset.id}`
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
  const currentIds = new Set(current.map((image) => image.id));
  const newlyUploaded = incoming.filter((image) => !currentIds.has(image.id));
  const updatedExisting = current.map(
    (image) => incoming.find((item) => item.id === image.id) ?? image
  );
  return [...newlyUploaded, ...updatedExisting];
}

function brandAssetFolderPath(
  folder: BrandAssetFolder,
  folders: readonly BrandAssetFolder[]
): string {
  return brandAssetFolderTrail(folder, folders)
    .map((item) => item.name)
    .join(" / ");
}

function brandAssetFolderTrail(
  folder: BrandAssetFolder,
  folders: readonly BrandAssetFolder[]
): readonly BrandAssetFolder[] {
  const trail = [folder];
  let current = folder;
  while (current.parentId) {
    const parent = folders.find((candidate) => candidate.id === current.parentId);
    if (!parent) break;
    trail.unshift(parent);
    current = parent;
  }
  return trail;
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
        uploadPending={referenceUploadPending}
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
