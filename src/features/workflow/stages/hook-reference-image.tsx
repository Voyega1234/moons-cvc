import { ImageSquare, Trash, UploadSimple } from "@phosphor-icons/react";
import { useId, useState, type ChangeEvent, type Dispatch } from "react";
import { MAX_HOOK_REFERENCE_IMAGES } from "../../../domain/creative-run";
import { uploadCreativeMaterial } from "../../../services/creative-materials/upload-creative-material";
import type { WorkflowAction, WorkflowState } from "../model";

export function HookReferenceImage({
  run,
  direction,
  dispatch,
  disabled = false
}: {
  run: Pick<WorkflowState, "id" | "brand">;
  direction: WorkflowState["directions"][number];
  dispatch: Dispatch<WorkflowAction>;
  disabled?: boolean;
}) {
  const inputId = useId();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <label className="hook-reference-image-upload" htmlFor={inputId}>
          <UploadSimple aria-hidden="true" size={15} />
          {uploading
            ? "Uploading…"
            : references.length
              ? "Add supporting references"
              : "Add reference images"}
        </label>
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
