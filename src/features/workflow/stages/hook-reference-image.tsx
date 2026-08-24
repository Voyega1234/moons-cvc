import { ImageSquare, Trash, UploadSimple } from "@phosphor-icons/react";
import { useId, useState, type ChangeEvent, type Dispatch } from "react";
import {
  inferredReferenceImageRole,
  MAX_HOOK_REFERENCE_IMAGES,
  referenceBoardRoleOptions,
  referenceHoldingRole,
  referenceImageRoleLabels,
  type ReferenceImageRole
} from "../../../domain/creative-run";
import { uploadCreativeMaterial } from "../../../services/creative-materials/upload-creative-material";
import type { WorkflowAction, WorkflowState } from "../model";
import { CreativeMaterialsEditor, LibraryEditModal } from "./brief-stage";

export function HookReferenceImage({
  run,
  direction,
  dispatch,
  disabled = false
}: {
  run: WorkflowState;
  direction: WorkflowState["directions"][number];
  dispatch: Dispatch<WorkflowAction>;
  disabled?: boolean;
}) {
  const inputId = useId();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

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
        <small>{references.length}/{MAX_HOOK_REFERENCE_IMAGES} references</small>
      </div>
      {references.length ? (
        <div className="hook-reference-image-grid">
          {references.map((reference) => {
            return (
            <article className="hook-reference-image-preview" key={reference.id}>
              <div className="hook-reference-image-thumb">
                <img src={reference.url} alt={reference.label} />
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
              </div>
              <div className="hook-reference-image-meta">
                <span
                  className="hook-reference-image-filename"
                  title={reference.label}
                >
                  {reference.label}
                </span>
                <select
                  className="hook-reference-image-role"
                  aria-label={`Use ${reference.label} for`}
                  value={inferredReferenceImageRole(reference)}
                  disabled={disabled || uploading}
                  onChange={(event) => {
                    const nextRole = event.target.value as ReferenceImageRole;
                    const previousRole = inferredReferenceImageRole(reference);
                    const swapWith = referenceHoldingRole(
                      references,
                      reference.id,
                      nextRole
                    );
                    dispatch({
                      type: "set-direction-reference-images",
                      id: direction.id,
                      images: references.map((item) => {
                        if (item.id === reference.id) {
                          return { ...item, role: nextRole };
                        }
                        if (swapWith && item.id === swapWith.id) {
                          return { ...item, role: previousRole };
                        }
                        return item;
                      })
                    });
                  }}
                >
                  {referenceBoardRoleOptions.map((role) => (
                    <option value={role} key={role}>
                      {referenceImageRoleLabels[role]}
                    </option>
                  ))}
                </select>
              </div>
            </article>
            );
          })}
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
          <button
            className="hook-reference-image-library-toggle"
            type="button"
            disabled={disabled || uploading}
            onClick={() => setPickerOpen(true)}
          >
            Pick from library
          </button>
        </div>
      ) : null}
      {pickerOpen ? (
        <LibraryEditModal
          title={`Reference for "${direction.hook}"`}
          description="Browse or upload an image and select it to attach it to this Hook."
          eyebrow="Hook reference"
          busy={false}
          onClose={() => setPickerOpen(false)}
          className="compass-hook-reference-picker-modal"
        >
          <CreativeMaterialsEditor
            state={run}
            dispatch={dispatch}
            kind="reference"
            targetDirectionId={direction.id}
            legacyReferences={run.brand?.library.refs ?? []}
          />
        </LibraryEditModal>
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
