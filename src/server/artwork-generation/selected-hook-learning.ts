import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../../lib/supabase/database.types.js";
import type {
  ArtworkGenerationRequest,
  ArtworkGenerationResponse
} from "../../services/artwork-generation/openai-image-generation.js";

type SelectedHook = ArtworkGenerationRequest["selectedHooks"][number];
type ArtworkOutput = ArtworkGenerationResponse["outputs"][number];
type CandidateInsert =
  Database["moons"]["Tables"]["selected_hook_learning_candidates"]["Insert"];

export interface SelectedHookLearningCandidateStore {
  upsertCandidates(candidates: readonly CandidateInsert[]): Promise<void>;
}

export function isSelectedHookLearningCaptureEnabled(
  value: string | undefined
): boolean {
  return value?.trim().toLowerCase() === "true";
}

export function buildSelectedHookLearningCandidates({
  input,
  outputs,
  generatedAt = new Date().toISOString()
}: {
  input: ArtworkGenerationRequest;
  outputs: readonly ArtworkOutput[];
  generatedAt?: string;
}): CandidateInsert[] {
  const clientId = input.brand?.id;
  if (!clientId) return [];

  const hooksById = new Map(input.selectedHooks.map((hook) => [hook.id, hook]));

  return outputs.flatMap((output) => {
    const hook = hooksById.get(output.directionId);
    if (
      !hook ||
      !output.assetUrl ||
      !output.assetBucket ||
      !output.assetStoragePath
    ) {
      return [];
    }

    return [
      {
        client_id: clientId,
        workspace_run_id: input.runId,
        direction_id: hook.id,
        output_id: output.id,
        service: input.service,
        artwork_mode: input.artworkMode,
        hook_text: hook.hook,
        concept: hook.concept,
        rationale: hook.why,
        visual_direction: hook.visual,
        cta: hook.cta,
        caption: hook.caption,
        hook_payload: toHookPayload(hook),
        image_url: output.assetUrl,
        asset_bucket: output.assetBucket,
        asset_storage_path: output.assetStoragePath,
        provider: output.provider ?? null,
        model: output.model ?? null,
        generated_at: generatedAt
      }
    ];
  });
}

export class SupabaseSelectedHookLearningCandidateStore
  implements SelectedHookLearningCandidateStore
{
  constructor(private readonly client: SupabaseClient<Database>) {}

  async upsertCandidates(
    candidates: readonly CandidateInsert[]
  ): Promise<void> {
    if (!candidates.length) return;

    const { error } = await this.client
      .schema("moons")
      .from("selected_hook_learning_candidates")
      .upsert([...candidates], {
        onConflict: "client_id,workspace_run_id,output_id"
      });

    if (error) throw error;
  }
}

function toHookPayload(hook: SelectedHook): Json {
  return {
    id: hook.id,
    hook: hook.hook,
    concept: hook.concept,
    why: hook.why,
    visual: hook.visual,
    cta: hook.cta,
    supportingPoints: [...(hook.supportingPoints ?? [])],
    formatBeats: [...(hook.formatBeats ?? [])],
    ...(hook.ctaActionType ? { ctaActionType: hook.ctaActionType } : {}),
    ...(hook.ctaDestination ? { ctaDestination: hook.ctaDestination } : {}),
    ...(hook.contactLine ? { contactLine: hook.contactLine } : {}),
    caption: hook.caption
  };
}
