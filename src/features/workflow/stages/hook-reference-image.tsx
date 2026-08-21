import { CaretDown, ImageSquare, Trash, UploadSimple } from "@phosphor-icons/react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch
} from "react";
import {
  inferredReferenceImageRole,
  MAX_HOOK_REFERENCE_IMAGES,
  type ReferenceImageSelection
} from "../../../domain/creative-run";
import { uploadCreativeMaterial } from "../../../services/creative-materials/upload-creative-material";
import type { WorkflowAction, WorkflowState } from "../model";

function availableSharedReferenceImages(
  run: Pick<WorkflowState, "brand" | "referenceImages">
): readonly ReferenceImageSelection[] {
  const nonLogo = run.referenceImages.filter(
    (reference) => inferredReferenceImageRole(reference) !== "logo"
  );
  const libraryRefs = run.brand?.library.refs ?? [];
  const fromLibrary = libraryRefs
    .filter((item) => item.assetUrl)
    .map((item) => {
      const picked = nonLogo.find((reference) => reference.url === item.assetUrl);
      return (
        picked ?? {
          id: `library-${item.id}`,
          url: item.assetUrl as string,
          label: item.title || "Untitled",
          role: "style" as const
        }
      );
    })
    .filter((reference) => inferredReferenceImageRole(reference) !== "logo");
  const adHoc = nonLogo.filter(
    (reference) => !libraryRefs.some((item) => item.assetUrl === reference.url)
  );
  return [...fromLibrary, ...adHoc];
}

export function HookReferenceImage({
  run,
  direction,
  dispatch,
  disabled = false
}: {
  run: Pick<WorkflowState, "id" | "brand" | "referenceImages">;
  direction: WorkflowState["directions"][number];
  dispatch: Dispatch<WorkflowAction>;
  disabled?: boolean;
}) {
  const inputId = useId();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const libraryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!libraryOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!libraryRef.current?.contains(event.target as Node)) {
        setLibraryOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLibraryOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [libraryOpen]);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const available = Math.max(
      0,
      MAX_HOOK_REFERENCE_IMAGES - (direction.referenceImages?.length ?? 0)
    );
    const files = Array.from(event.target.files ?? []).slice(0, available);
    event.target.value = "";
    if (!files.length) return;

    setUploading(true);
    setError(null);
    try {
      const uploaded = await Promise.all(
        files.map((file) =>
          uploadCreativeMaterial({
            runId: run.id,
            brandId: run.brand?.id,
            file
          })
        )
      );
      dispatch({
        type: "set-direction-reference-images",
        id: direction.id,
        images: [
          ...(direction.referenceImages ?? []),
          ...uploaded.map((item) => ({
            id: `hook-reference-${item.id}`,
            url: item.url,
            label: item.name,
            role: "style" as const,
            primary: false
          }))
        ]
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not upload the image."
      );
    } finally {
      setUploading(false);
    }
  }

  const references = direction.referenceImages ?? [];
  const canAdd = references.length < MAX_HOOK_REFERENCE_IMAGES;
  const libraryOptions = availableSharedReferenceImages(run).filter(
    (reference) => !references.some((item) => item.url === reference.url)
  );

  function handlePickFromLibrary(reference: ReferenceImageSelection) {
    dispatch({
      type: "set-direction-reference-images",
      id: direction.id,
      images: [...references, reference]
    });
    setLibraryOpen(false);
  }

  return (
    <section
      className={`hook-reference-image ${references.length ? "has-image" : ""}`}
      aria-label={`Reference Image for ${direction.hook}`}
    >
      <div className="hook-reference-image-head">
        <span>
          <ImageSquare aria-hidden="true" size={15} />
          Reference Image
        </span>
        <small>
          {references.length}/{MAX_HOOK_REFERENCE_IMAGES} · First image is Primary
        </small>
      </div>
      {references.length ? (
        <div className="hook-reference-image-grid">
          {references.map((reference, index) => (
            <article className="hook-reference-image-preview" key={reference.id}>
              <img src={reference.url} alt={reference.label} />
              <div className="hook-reference-image-meta">
                <strong>{index === 0 ? "Primary" : `Supporting ${index}`}</strong>
                <span
                  className="hook-reference-image-filename"
                  title={reference.label}
                >
                  {reference.label}
                </span>
              </div>
              <button
                className="hook-reference-image-action remove"
                type="button"
                disabled={disabled || uploading}
                onClick={() =>
                  dispatch({
                    type: "set-direction-reference-images",
                    id: direction.id,
                    images: references.filter(
                      (item) => item.id !== reference.id
                    )
                  })
                }
                aria-label={`Remove ${reference.label}`}
              >
                <Trash aria-hidden="true" size={13} />
              </button>
            </article>
          ))}
        </div>
      ) : null}
      {canAdd ? (
        <div className="hook-reference-image-add">
          <label className="hook-reference-image-upload" htmlFor={inputId}>
            <UploadSimple aria-hidden="true" size={15} />
            {uploading
              ? "Uploading…"
              : references.length
                ? "Add supporting references"
                : "Add reference images"}
          </label>
          {libraryOptions.length ? (
            <div className="hook-reference-image-library" ref={libraryRef}>
              <button
                className="hook-reference-image-library-toggle"
                type="button"
                disabled={disabled || uploading}
                aria-expanded={libraryOpen}
                onClick={() => setLibraryOpen((open) => !open)}
              >
                Pick from library
                <CaretDown aria-hidden="true" size={11} />
              </button>
              {libraryOpen ? (
                <div className="hook-reference-image-library-menu" role="menu">
                  {libraryOptions.map((reference) => (
                    <button
                      key={reference.id}
                      className="hook-reference-image-library-item"
                      type="button"
                      role="menuitem"
                      onClick={() => handlePickFromLibrary(reference)}
                    >
                      <img src={reference.url} alt="" />
                      <span title={reference.label}>{reference.label}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <input
        id={inputId}
        className="hook-reference-image-input"
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        disabled={disabled || uploading}
        onChange={(event) => void handleUpload(event)}
      />
      {error ? <p className="hook-reference-image-error">{error}</p> : null}
    </section>
  );
}
