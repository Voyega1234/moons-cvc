import { ImageSquare, Trash, UploadSimple } from "@phosphor-icons/react";
import { useId, useState, type ChangeEvent, type Dispatch } from "react";
import {
  creativeMaterialRoles,
  MAX_HOOK_MATERIALS,
  type CreativeMaterialRole
} from "../../../domain/creative-run";
import { uploadCreativeMaterial } from "../../../services/creative-materials/upload-creative-material";
import type { WorkflowAction, WorkflowState } from "../model";
import {
  CreativeMaterialsEditor,
  LibraryEditModal,
  creativeMaterialRoleLabels
} from "./brief-stage";

export function HookMaterialImage({
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
      MAX_HOOK_MATERIALS - (direction.uploadedMaterials?.length ?? 0)
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
        type: "set-direction-uploaded-materials",
        id: direction.id,
        materials: [...(direction.uploadedMaterials ?? []), ...uploaded]
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not upload the image."
      );
    } finally {
      setUploading(false);
    }
  }

  const materials = direction.uploadedMaterials ?? [];
  const canAdd = materials.length < MAX_HOOK_MATERIALS;

  return (
    <section
      className={`hook-reference-image ${materials.length ? "has-image" : ""}`}
      aria-label={`Materials for ${direction.hook}`}
    >
      <div className="hook-reference-image-head">
        <span>
          <ImageSquare aria-hidden="true" size={15} />
          Materials
        </span>
        <small>{materials.length}/{MAX_HOOK_MATERIALS} materials</small>
      </div>
      {materials.length ? (
        <div className="hook-reference-image-grid">
          {materials.map((material) => (
            <article className="hook-reference-image-preview" key={material.id}>
              <div className="hook-reference-image-thumb">
                <img src={material.url} alt={material.name} />
                <button
                  className="hook-reference-image-action remove"
                  type="button"
                  disabled={disabled || uploading}
                  onClick={() =>
                    dispatch({
                      type: "set-direction-uploaded-materials",
                      id: direction.id,
                      materials: materials.filter(
                        (item) => item.id !== material.id
                      )
                    })
                  }
                  aria-label={`Remove ${material.name}`}
                >
                  <Trash aria-hidden="true" size={13} />
                </button>
              </div>
              <div className="hook-reference-image-meta">
                <span
                  className="hook-reference-image-filename"
                  title={material.name}
                >
                  {material.name}
                </span>
                <select
                  className="hook-reference-image-role"
                  aria-label={`Use ${material.name} as`}
                  value={material.role}
                  disabled={disabled || uploading}
                  onChange={(event) =>
                    dispatch({
                      type: "set-direction-uploaded-materials",
                      id: direction.id,
                      materials: materials.map((item) =>
                        item.id === material.id
                          ? {
                              ...item,
                              role: event.target.value as CreativeMaterialRole
                            }
                          : item
                      )
                    })
                  }
                >
                  {creativeMaterialRoles.map((role) => (
                    <option value={role} key={role}>
                      {creativeMaterialRoleLabels[role]}
                    </option>
                  ))}
                </select>
              </div>
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
              : materials.length
                ? "Add more materials"
                : "Add material images"}
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
          title={`Materials for "${direction.hook}"`}
          description="Browse or upload an image and select it to attach it to this Hook."
          eyebrow="Hook materials"
          busy={false}
          onClose={() => setPickerOpen(false)}
          className="compass-hook-reference-picker-modal"
        >
          <CreativeMaterialsEditor
            state={run}
            dispatch={dispatch}
            kind="material"
            targetDirectionId={direction.id}
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
