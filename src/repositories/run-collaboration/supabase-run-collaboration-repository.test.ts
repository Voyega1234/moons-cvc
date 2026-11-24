import { beforeEach, expect, it, vi } from "vitest";
import { getSupabaseClient } from "../../lib/supabase/client";
import { SupabaseRunCollaborationRepository } from "./supabase-run-collaboration-repository";
vi.mock("../../lib/supabase/client", () => ({ getSupabaseClient: vi.fn() }));
const query = vi.fn();
beforeEach(() => {
  query.mockReset();
  vi.mocked(getSupabaseClient).mockReturnValue({ schema: () => ({ from: () => ({ select: () => ({ in: query }) }) }) } as unknown as ReturnType<typeof getSupabaseClient>);
});
it("loads all 677 project owners in bounded queries and deduplicates IDs", async () => {
  const ids = Array.from({ length: 677 }, (_, index) => `run-${index}`);
  query.mockImplementation(async (_column, batch: string[]) => {
    if (batch.length > 100) throw new Error("Bad Request: URL too long");
    return { data: batch.map(id => ({ workspace_run_id: id, current_owner_user_id: `owner-${id}`, version: 1, status: "active", updated_at: "2026-11-24" })), error: null };
  });
  const result = await new SupabaseRunCollaborationRepository().listOwnerships([...ids, ids[0]!]);
  expect(query).toHaveBeenCalledTimes(7);
  expect(result.map(row => row.workspaceRunId)).toEqual(ids);
  expect(result.at(-1)?.currentOwnerUserId).toBe("owner-run-676");
});
it("rejects incomplete ownership when any batch fails", async () => {
  query.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: null, error: new Error("Ownership request failed") });
  await expect(new SupabaseRunCollaborationRepository().listOwnerships(Array.from({ length: 101 }, (_, i) => `run-${i}`))).rejects.toThrow("Ownership request failed");
});
it("does not query ownership for an empty workspace", async () => {
  expect(await new SupabaseRunCollaborationRepository().listOwnerships([])).toEqual([]);
  expect(query).not.toHaveBeenCalled();
});
