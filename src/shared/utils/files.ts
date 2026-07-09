export function getFileNames(files: FileList | null): readonly string[] {
  return Array.from(files ?? [], (file) => file.name);
}
