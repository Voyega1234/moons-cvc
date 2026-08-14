import type { CreativeOutput } from "../../../domain/creative-run";

function downloadFileName(
  output: CreativeOutput,
  index: number,
  blob: Blob
): string {
  const storedName = output.assetStoragePath?.split("/").pop()?.split("?")[0];
  if (storedName && /\.[a-z0-9]{2,5}$/i.test(storedName)) return storedName;
  const extension =
    blob.type === "image/jpeg"
      ? "jpg"
      : blob.type === "image/webp"
        ? "webp"
        : "png";
  return `compass-creative-${index + 1}.${extension}`;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}

export async function downloadOutputAsset(
  output: CreativeOutput,
  index = 0
): Promise<void> {
  if (!output.assetUrl) {
    throw new Error("This creative has no downloadable artwork.");
  }
  const response = await fetch(output.assetUrl);
  if (!response.ok) {
    throw new Error(`Could not download artwork (${response.status}).`);
  }
  const blob = await response.blob();
  downloadBlob(blob, downloadFileName(output, index, blob));
}

export async function downloadAlbumArchive(
  outputs: readonly CreativeOutput[],
  albumIndex = 0
): Promise<void> {
  const { default: JSZip } = await import("jszip");
  const archive = new JSZip();
  for (const [panelIndex, output] of outputs.entries()) {
    if (!output.assetUrl) {
      throw new Error(
        `Album panel ${panelIndex + 1} has no downloadable artwork.`
      );
    }
    const response = await fetch(output.assetUrl);
    if (!response.ok) {
      throw new Error(
        `Could not download album panel ${panelIndex + 1} (${response.status}).`
      );
    }
    const blob = await response.blob();
    const panelNumber = String(panelIndex + 1).padStart(2, "0");
    archive.file(
      `panel-${panelNumber}-${downloadFileName(output, panelIndex, blob)}`,
      blob
    );
  }
  const blob = await archive.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
  downloadBlob(blob, `compass-album-${albumIndex + 1}.zip`);
}

export async function downloadAllOutputsArchive(
  outputs: readonly CreativeOutput[]
): Promise<void> {
  const downloadableOutputs = outputs.filter((output) => output.assetUrl);
  if (!downloadableOutputs.length) {
    throw new Error("No downloadable artwork is available.");
  }
  const { default: JSZip } = await import("jszip");
  const archive = new JSZip();
  for (const [index, output] of downloadableOutputs.entries()) {
    const response = await fetch(output.assetUrl!);
    if (!response.ok) {
      throw new Error(
        `Could not download creative ${index + 1} (${response.status}).`
      );
    }
    const blob = await response.blob();
    const creativeNumber = String(index + 1).padStart(2, "0");
    archive.file(
      `creative-${creativeNumber}-${downloadFileName(output, index, blob)}`,
      blob
    );
  }
  const blob = await archive.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
  downloadBlob(blob, "compass-create-artwork.zip");
}

export async function downloadAllOutputs(
  outputs: readonly CreativeOutput[]
): Promise<void> {
  for (const [index, output] of outputs.entries()) {
    if (!output.assetUrl) continue;
    await downloadOutputAsset(output, index);
  }
}
