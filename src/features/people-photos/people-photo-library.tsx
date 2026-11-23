import { useEffect, useRef, useState } from "react";
import { listPeoplePhotos, removePeoplePhoto, uploadPeoplePhoto, analyzeStoredPeoplePhoto, type PeoplePhoto } from "../../services/people-photos/people-photo-library";
import { unknownPeopleCasting } from "../../domain/people-photos";
import "./people-photo-library.css";

export function PeoplePhotoLibrary({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [photos, setPhotos] = useState<readonly PeoplePhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    void listPeoplePhotos().then((items) => { if (active) setPhotos(items); }, (caught) => { if (active) setError(caught.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function upload(files: readonly File[]) {
    if (!files.length) return;
    if (files.length > 20) { setError("Upload up to 20 photos at a time."); return; }
    setBusy(true); setError("");
    try {
      const warnings: string[] = [];
      for (const [index, file] of files.entries()) {
        setProgress(`Uploading and labeling ${index + 1}/${files.length}…`);
        const result = await uploadPeoplePhoto(file, "", unknownPeopleCasting);
        if (result?.warning) warnings.push(result.warning);
      }
      if (warnings.length) setError(warnings.join("\n"));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Upload failed."); }
    finally {
      try { setPhotos(await listPeoplePhotos()); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not refresh photos."); }
      setBusy(false);
      setProgress("");
    }
  }
  async function remove(photo: PeoplePhoto) {
    if (!window.confirm(`Remove "${photo.title}" from the shared library?`)) return;
    setBusy(true); setError("");
    try { await removePeoplePhoto(photo.path); setPhotos((items) => items.filter((item) => item.path !== photo.path)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not remove photo."); }
    finally { setBusy(false); }
  }
  async function analyze(photo: PeoplePhoto) {
    setBusy(true); setError(""); setProgress(`Reading ${photo.title}…`);
    try { await analyzeStoredPeoplePhoto(photo); setPhotos(await listPeoplePhotos()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not analyze photo."); }
    finally { setBusy(false); setProgress(""); }
  }
  return <dialog ref={dialog} className="people-photo-library" aria-labelledby="people-library-title" onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }}>
    <header><h2 id="people-library-title">People photos</h2>
      <div className="people-library-toolbar">
        <label className="btn secondary people-library-file-button">{busy ? "Working…" : "Upload photos"}<input aria-label="Upload people photos" type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy || loading} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void upload(files); }} /></label>
        <button className="btn secondary" type="button" disabled={busy} onClick={onClose}>Close</button>
      </div>
    </header>
    {progress ? <p role="status">{progress}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {loading ? <p role="status">Loading photos…</p> : !photos.length && !error ? <p>No people photos yet. Upload the team's real photos to make them available during artwork generation.</p> : null}
    <div className="people-library-grid">{photos.map((photo) => <article key={photo.path}>
      <img src={photo.url} alt={photo.analysis?.description || photo.title} loading="lazy" />
      <div className="people-library-card-actions">
        {!photo.analysis ? <button type="button" disabled={busy} aria-label={`Retry labeling ${photo.title}`} title="Retry labeling" onClick={() => void analyze(photo)}>↻</button> : null}
        <button type="button" disabled={busy} aria-label={`Remove ${photo.title}`} title="Remove photo" onClick={() => void remove(photo)}>×</button>
      </div>
    </article>)}</div>
  </dialog>;
}
