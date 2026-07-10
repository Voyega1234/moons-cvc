# Artwork generation contract

Status: implemented. Text-to-image generation, reference-image edits,
click-to-regenerate with a custom prompt, an AI prompt-writing agent, and
AI vision quality-check are all live — see "What's actually implemented"
below for the parts of this originally-aspirational spec that turned out
different in practice.

## Purpose

When the user clicks `Create selected hooks`, Moons should generate artwork for
the hooks selected in the Hook step.

The frontend must not call OpenAI directly because `OPENAI_API_KEY` must stay on
the backend. The frontend calls the configured backend endpoint instead.

## Frontend env

```text
VITE_ARTWORK_GENERATION_ENDPOINT=
```

If this value is empty, the app keeps the prototype flow working by creating
draft output cards without generated assets.

When Supabase auth is available, the frontend sends the current Supabase access
token as `Authorization: Bearer <token>` so the backend can write storage/DB
through normal user-scoped policies or verify the user before using a service
role.

## Backend model

Use OpenAI image model:

```text
gpt-image-2
```

Official guide:

```text
https://developers.openai.com/api/docs/guides/image-generation#generate-images
```

## Request shape

Frontend sends:

```ts
type ArtworkGenerationRequest = {
  model: "gpt-image-2";
  runId: string;
  brand: {
    id: string;
    name: string;
    category: string;
  } | null;
  service: "single-static" | "album-post" | "motion-static" | "resize" | "ugc-video";
  quantity: number;
  brief: string;
  selectedHooks: {
    id: string;
    hook: string;
    concept: string;
    visual: string;
    caption: string;
  }[];
  textInputs: string[];
  referenceImages: (
    | { kind: "url"; url: string; label?: string; mediaType?: string }
    | { kind: "base64"; data: string; mediaType: string; label?: string }
    | { kind: "openai_file"; fileId: string; label?: string }
  )[];
  brandMemory: { working: string[]; avoid: string[] };
  brandLibrary: {
    brand: { title: string; description: string }[];
    products: { title: string; description: string }[];
    docs: { title: string; description: string }[];
    refs: { title: string; description: string }[];
  };
  output: {
    size: "1024x1024";
    format: "png";
  };
};
```

`brandMemory`/`brandLibrary` mirror the shape hook generation already sends
(see `docs/FEATURE_HOOK_GENERATION.md`) and feed the image prompt agent
below — the endpoint parses them leniently (defaults to empty arrays if
absent) so this stayed backward compatible when it was added.

## Response shape

Backend must return:

```ts
type ArtworkGenerationResponse = {
  outputs: {
    id: string;
    directionId: string;
    format: string;
    status: "draft" | "needs-revision" | "ready" | "fixed";
    clientStatus: "queued" | "sent" | "revision" | "approved";
    assetUrl?: string;
    assetStoragePath?: string;
    assetBucket?: "creative-assets";
    provider?: "openai";
    model?: "gpt-image-2";
    revisionCount: number;
  }[];
};
```

`assetUrl` must point to a persisted image URL, preferably a signed Supabase
Storage URL. Do not return a temporary base64 image to the frontend as the final
asset. Also return `assetStoragePath` and `assetBucket` so Moons can refresh
signed URLs later without regenerating images.

## Storage and database persistence

Use the private Supabase Storage bucket:

```text
creative-assets
```

Recommended object path:

```text
{clientId}/{runId}/outputs/{directionId}-{version}.png
```

Backend flow (as implemented in
`src/server/artwork-generation/artwork-generation-endpoint.ts`):

1. Receive selected hooks and brief from the frontend.
2. For each selected hook, call the image prompt agent
   (`src/server/artwork-generation/image-prompt-agent.ts`) to write a real
   production-ready image prompt — see "Image prompt agent" below. Falls
   back to a deterministic templated prompt if that call fails.
3. Call OpenAI `gpt-image-2` — `generateImage()` (text-only) or `editImage()`
   (when `referenceImages` is non-empty, via `/v1/images/edits` multipart
   form) in `src/server/artwork-generation/openai-images-client.ts`, using
   the prompt from step 2.
4. Decode the image result server-side.
5. Upload the image file to Supabase Storage bucket `creative-assets`, using
   a client built from the caller's own Supabase access token (not a
   service-role key) — the bucket's RLS already allows any
   `moons.is_convert_cake_user()` login to write.
6. Create a signed URL (7 day expiry) and return it as `assetUrl`.

**Deviates from the original spec here:** step 6 does not insert or upsert
`moons.outputs`. Nothing in this app writes to that table yet — see
`docs/DATABASE_CONTRACT.md`'s note under `moons.outputs`. The generated
output metadata (`assetUrl`, `assetStoragePath`, `status`, `approval`, etc.)
is returned to the frontend and persisted the same way hooks are: as part of
`moons.workspaces.snapshot`, not a normalized row. This matches the existing
`docs/DATABASE_CONTRACT.md` "Next adapter order" — hook generation (#1) was
already snapshot-only before this feature existed, so keeping outputs (#2)
snapshot-only too is consistent, not a regression.

Required migration (apply manually — migrations in this repo are not
auto-applied, see `docs/DATABASE_CONTRACT.md`):

```text
supabase/migrations/202606260008_creative_asset_storage.sql
```

## Input handling

- `brief` is the user's Brief step text.
- `selectedHooks` are the hooks selected in Shortlist hooks.
- `textInputs` is extra prompt context — used both by "Use from library"
  free text (currently unused; the picker only sends `referenceImages`) and
  by the regenerate modal's custom instructions field.
- `referenceImages` supports `url` and `base64` kinds, both implemented via
  `editImage()`. `openai_file` is accepted by the type but the backend
  throws a clear "not supported yet" error if one is ever sent — nothing in
  the app produces an OpenAI file id, so this was left unbuilt rather than
  shipping an untested path.

Image generation uses `generateImage()` (text-only) when `referenceImages`
is empty, `editImage()` otherwise. `quality: "medium"` — `"high"` was tried
first and took long enough (2+ minutes, confirmed by timing) to trip
`vercel dev`'s internal proxy timeout with an unhelpful raw Node
`HeadersTimeoutError`. `medium` completes in ~50s per hook.
`maxDuration: 300` is set on the Vercel function (bumped from `120` when the
prompt agent step was added). Outputs run in a bounded-concurrency batch of
two, preserving the selected-hook order in the response. A full-quantity batch
(`QUANTITY_LIMITS.maximum` = 6) therefore runs in three waves rather than six
serial image calls, materially reducing timeout risk without issuing six costly
image requests at once.

## Image prompt agent

Status: implemented 2026-07-10. Previously `buildImagePrompt()` was pure
deterministic string concatenation of the hook/concept/visual/caption/brief
fields — no model call, no real art direction. It's now a fallback, not the
primary path.

`resolveImagePrompt()` in `artwork-generation-endpoint.ts` calls
`generateImagePrompt()` (`image-prompt-agent.ts`) once per selected hook,
before image generation. That function sends a condensed adaptation of
`agent_prompt/agent_image.md` (a "Senior Creative Director" meta-prompt: pick
one selling mechanism, one creative mode, one energy level, one style from a
20-name performance-ad style library, then run an anti-AI-slop rejection
check) to the OpenAI Responses API with strict `json_schema` output
(`{ prompt: string }`), along with the real hook/brief/brand data and —
newly — the brand's Brand Kit voice/CI (`brandLibrary.brand`), products
(`brandLibrary.products`), and Brand Memory working/avoid notes
(`brandMemory`). The agent's returned prompt is what actually gets sent to
`gpt-image-2`, not the old template.

The full `agent_prompt/agent_image.md` file (1500+ lines) is **not** read at
runtime — its instructions were condensed into `buildAgentPrompt()` in
`image-prompt-agent.ts`, the same "adapt into a TS string, don't read the
file from disk" pattern hook generation already uses for `agent_hook.md`/
`agent_seasonal.md` (see `docs/FEATURE_HOOK_GENERATION.md`). The full
20-style library (names + one-line "best for" hints) and the anti-AI-slop
checklist were kept close to verbatim since they're the most differentiated,
non-obvious part of the source prompt; the more generic sections (lighting,
typography, color theory boilerplate) were compressed, trusting the model's
own knowledge.

If the prompt agent call fails or times out, `resolveImagePrompt()` silently
falls back to the old deterministic `buildImagePrompt()` so image generation
still succeeds — the run won't hard-fail because of this extra step, it just
gets a less art-directed prompt for that one hook.

Model: `OPENAI_IMAGE_PROMPT_MODEL`, defaults to `gpt-5.6-terra` (same tier as
hook generation — both are creative-writing-quality-sensitive steps).

## "Use from library" reference picker

Real, not decorative — this used to be four hardcoded, permanently-checked
checkboxes in the Brief step with no state behind them
(`docs/FEATURE_START.md` predates this). `ReferenceLibraryPicker` in
`stages.tsx` now fetches the brand's actual Logo (via
`BrandMemoryRepository.listBrandRules`, the row titled `Logo`) and Past work
images (`listAdsLibraryPastWork`), renders them as selectable thumbnails, and
stores the selection on the run itself
(`WorkflowState.referenceImages: ReferenceImageSelection[]`, `domain/creative-run.ts`,
toggled via the `toggle-reference-image` action). Both "Create selected
hooks" and the regenerate modal read this same run-level selection and map
it to `{ kind: "url", url, label }` — there's no separate picker per
generation call.

`listAdsLibraryPastWork` returns `[]` in mock mode (`MockBrandMemoryRepository`
never implemented it), so only the Logo half of the picker is exercisable
without real Supabase data.

## Regenerate with a custom prompt

`OutputRegenerateModal` in `stages.tsx` — click any creative's preview in
Create & fix to open it. Shows the current image, an optional "Regeneration
instructions" textarea, and a readonly summary of which reference images
(from "Use from library") will be applied. `regenerateOutputImage()`
(`openai-image-generation.ts`) builds a single-hook request reusing the same
`/api/artwork-generation` endpoint — no separate backend route — passing the
custom instructions through the existing `textInputs` field, which the
server already appends to the image prompt. On success it dispatches
`replace-output-asset` (`docs/FEATURE_INTERNAL_QC.md`), the same action the
manual "Upload replacement" flow uses.

## Quality check ("Recheck quality")

Status: implemented as an AI vision review, not the automated
technical-checks-only or hybrid options that were also considered. Was
previously a complete no-op — `run-qa` just flipped `qaComplete: true` and
marked every output `"ready"` with no actual check.

`POST /api/quality-check` → `src/server/quality-check/quality-check-endpoint.ts`.
For each output with a real `assetUrl`, sends the image inline
(`input_image` content block, same pattern as
`openai-brand-visual-analyzer.ts`) alongside its hook/concept/visual
direction and the run's brief, and asks the model to flag only clearly
identifiable problems: illegible/garbled text baked into the image,
brand-unsafe content, or an obvious mismatch with the visual direction —
explicitly not personal taste. Returns `{ outputId, passed, reason }` per
creative.

The `run-qa` action now carries these results
(`{ type: "run-qa"; results: readonly QaResult[] }` in `model.ts`) instead of
being a bare trigger. The reducer sets each output's `status` to `"ready"`
or `"needs-revision"` per its real result and stores the model's reasoning
in a new `CreativeOutput.qaNote?: string` field, shown inline on the card
(`.output-qa-note`) when a creative is flagged. `qaComplete` still just
means "a check has run," matching the existing rule that outputs can
proceed to Internal QC review with open flags — the check surfaces problems,
it doesn't hard-block.

`maxDuration: 90` is set on the Vercel function since vision review across
several images can take a while.

## Current frontend files

- `src/features/workflow/use-create-selected-hooks.ts`
- `src/features/workflow/use-run-quality-check.ts`
- `src/services/artwork-generation/openai-image-generation.ts`
- `src/services/artwork-generation/replace-output-asset.ts`
- `src/services/quality-check/run-quality-check.ts`
- `src/features/workflow/stages.tsx` — `ReferenceLibraryPicker`,
  `OutputRegenerateModal`, `StudioStage`, `OutputGrid`

## Current backend files

- `src/server/artwork-generation/artwork-generation-endpoint.ts`
- `src/server/artwork-generation/image-prompt-agent.ts`
- `src/server/artwork-generation/openai-images-client.ts`
- `agent_prompt/agent_image.md` — original source prompt, condensed into
  `image-prompt-agent.ts`, not read at runtime
