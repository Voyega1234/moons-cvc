import {
  resolveAlbumFormat,
  type AlbumFormat,
  type ApprovalRole,
  type CreativeOutput
} from "../../../domain/creative-run";
import { isBuildQualityCheckOutput } from "../rules";
import { currentApprovalRole } from "../rules";
import type { WorkflowState } from "../model";

export function isUgcOutput(output: CreativeOutput): boolean {
  return output.format.toUpperCase().includes("UGC");
}

export function isAlbumOutput(output: CreativeOutput): boolean {
  return output.format.trim().toLowerCase() === "album post";
}

export function qcContentTypeLabel(
  output: CreativeOutput
): "Static" | "UGC" | "ALBUM" {
  if (isUgcOutput(output)) return "UGC";
  if (isAlbumOutput(output)) return "ALBUM";
  return "Static";
}

function albumPanelIndex(output: CreativeOutput): number {
  const match = output.id.match(/-album-(\d+)-v\d+$/i);
  return match ? Number(match[1]) - 1 : Number.MAX_SAFE_INTEGER;
}

export function sortAlbumOutputs(
  outputs: readonly CreativeOutput[]
): readonly CreativeOutput[] {
  return [...outputs].sort(
    (left, right) => albumPanelIndex(left) - albumPanelIndex(right)
  );
}

export function groupOutputsForReview(
  outputs: readonly CreativeOutput[]
): readonly (readonly CreativeOutput[])[] {
  if (!outputs.some(isAlbumOutput)) return outputs.map((output) => [output]);

  const albumGroups = new Map<string, CreativeOutput[]>();
  outputs.forEach((output) => {
    const group = albumGroups.get(output.directionId) ?? [];
    group.push(output);
    albumGroups.set(output.directionId, group);
  });
  return Array.from(albumGroups.values(), sortAlbumOutputs);
}

export function reviewCreativeGroups(
  outputs: readonly CreativeOutput[]
): readonly (readonly CreativeOutput[])[] {
  const formatGroups = new Map<string, CreativeOutput[]>();
  outputs.forEach((output) => {
    const group = formatGroups.get(output.format) ?? [];
    group.push(output);
    formatGroups.set(output.format, group);
  });
  return Array.from(formatGroups.values()).flatMap((group) =>
    groupOutputsForReview(group)
  );
}

export function outputNeedsGuidedImprovement(
  output: CreativeOutput
): boolean {
  return (
    isBuildQualityCheckOutput(output) && output.status === "needs-revision"
  );
}

export function reviewCreativeCount(
  outputs: readonly CreativeOutput[]
): number {
  return reviewCreativeGroups(outputs).length;
}

export function reviewGroupIsApprovedForRole(
  outputs: readonly CreativeOutput[],
  role: ApprovalRole
): boolean {
  return outputs.every((output) => output.approval[role] === "approved");
}

export function reviewGroupIsWaitingForRole(
  outputs: readonly CreativeOutput[],
  role: ApprovalRole
): boolean {
  return outputs.some((output) => currentApprovalRole(output) === role);
}

export function reviewGuidedImprovementCount(
  outputs: readonly CreativeOutput[]
): number {
  return reviewCreativeGroups(outputs).filter((group) =>
    group.some(outputNeedsGuidedImprovement)
  ).length;
}

export function outputFormatSortRank(format: string): number {
  const normalized = format.trim().toLowerCase();
  if (normalized === "1:1 static") return 0;
  if (normalized === "album post") return 1;
  if (normalized === "9:16 ugc") return 2;
  return 3;
}

export function outputSectionTitle(format: string): string {
  const normalized = format.trim().toLowerCase();
  if (normalized === "1:1 static") return "Static creatives";
  if (normalized === "album post") return "Album creatives";
  if (normalized === "9:16 ugc") return "UGC creatives";
  return format;
}

export function resolvedAlbumFormatForDirection(
  preference: WorkflowState["albumFormat"],
  direction: WorkflowState["directions"][number] | undefined
): AlbumFormat {
  return resolveAlbumFormat(preference, direction?.albumFormat);
}
