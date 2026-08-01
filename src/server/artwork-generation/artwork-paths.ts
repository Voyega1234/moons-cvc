export function buildStoragePath({
  clientId,
  runId,
  directionId,
  assetVersion = 1
}: {
  clientId: string;
  runId: string;
  directionId: string;
  assetVersion?: number;
}): string {
  return [
    safePathSegment(clientId),
    safePathSegment(runId),
    "outputs",
    `${safePathSegment(directionId)}-v${assetVersion}.png`
  ].join("/");
}

export function safePathSegment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9._-]+/g, "-")
      .replaceAll(/-+/g, "-")
      .replaceAll(/^-|-$/g, "")
      .slice(0, 80) || "unknown"
  );
}


