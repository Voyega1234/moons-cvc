type FetchLike = typeof fetch;

export interface ArtworkRevisionLogEntry {
  clientId: string | null;
  workspaceRunId: string;
  directionId: string;
  outputId: string;
  isAlbum: boolean;
  affectedOutputIds: readonly string[];
  instructions: string;
  previousAssetUrl: string | null;
  newAssetUrl: string | null;
}

export async function persistArtworkRevisionLog({
  fetchImpl,
  supabaseUrl,
  supabaseAnonKey,
  accessToken,
  ownerUserId,
  entry
}: {
  fetchImpl: FetchLike;
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessToken: string | null;
  ownerUserId: string | null;
  entry: ArtworkRevisionLogEntry;
}): Promise<void> {
  if (!accessToken || !ownerUserId) return;

  const url = supabaseUrl.trim().replace(/\/$/, "");
  const response = await fetchImpl(`${url}/rest/v1/artwork_revision_log`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Content-Profile": "moons",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({
      owner_user_id: ownerUserId,
      client_id: entry.clientId,
      workspace_run_id: entry.workspaceRunId,
      direction_id: entry.directionId,
      output_id: entry.outputId,
      is_album: entry.isAlbum,
      affected_output_ids: entry.affectedOutputIds,
      instructions: entry.instructions,
      previous_asset_url: entry.previousAssetUrl,
      new_asset_url: entry.newAssetUrl
    })
  });
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(
      `Artwork revision log persistence failed: ${response.status}${detail ? ` — ${detail}` : ""}`
    );
  }
}
