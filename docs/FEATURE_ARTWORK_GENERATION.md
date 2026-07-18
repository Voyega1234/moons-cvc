# Artwork generation contract

Status: implemented. Text-to-image generation, reference-image edits,
click-to-regenerate with a custom prompt, an AI prompt-writing agent, and
AI vision quality-check are all live — see "What's actually implemented"
below for the parts of this originally-aspirational spec that turned out
different in practice.

## Purpose

When the user clicks `Create selected hooks`, Moons should generate artwork for
the hooks selected in the Hook step.

The frontend supports two generation modes: the configured OpenAI backend
endpoint (which keeps `OPENAI_API_KEY` server-side) or an n8n webhook.

## Per-run artwork modes

The Hook stage has a separate creative-mode selector. This does not replace or
reconfigure the OpenAI/n8n provider choice above:

1. `standard` — default; uses `agent_prompt/agent_image.md` as the image-agent
   instruction and appends the run's compact campaign input.
   For `album-post`, Standard mode generates one 2048×2048 master artboard with
   a fixed landscape-first 2×2 composition: panel 1 spans the top row, while
   panels 2 and 3 occupy the bottom-left and bottom-right squares. The three
   format beats map to cover/hook, mechanism/proof, and offer/CTA. Essential
   content stays inside each crop; only non-essential background flow may cross
   seams. The backend stores the master for debugging, then deterministically
   returns one 1920×960 image and two 960×960 images. Other modes and Standard
   non-album services retain their existing generation path.
2. `design-system` — loads
   `graphic-ad-design-system/03_MASTER_CREATIVE_DIRECTOR_AGENT.md` and applies
   its brief diagnosis, reference forensics, internal execution-route
   selection, art-direction blueprint, fidelity rules, and QA discipline before
   returning the final GPT Image prompt. In Moons this mode always requests a
   fully composed, publication-ready ad because there is no downstream text,
   CTA, or logo compositor. Selected campaign references are authoritative for
   visual medium and design grammar, so photographic/editorial work must not
   collapse into generic isometric 3D or SaaS illustration.
3. `reference-library` — loads
   `agent_prompt/agent_artwork_reference.md`, a catalog distilled from the
   verified specs and reconstruction prompts in `agent_prompt/Images/output`.
   Before selection, a GPT Luna (`gpt-5.6-luna`) strategy-enrichment step reads
   the approved direction, Brand Memory, and Brand Library snapshot. It chooses
   the commercial style, visible selling mechanism, and preferred catalog
   mode/layout/hero. Offer, proof, and differentiator fields carry a source of
   `verified`, `creative-placeholder`, or `none`. Verified excerpts must resolve
   to verbatim supplied evidence; creative placeholders may complete temporary
   dates, prices, discounts, reviews, ratings, metrics, or supporting details
   and set `requiresTextReview: true`. Placeholders are never written to Brand
   Memory as facts. It then
   scores all 72 human-reviewed artworks using that strategy plus runtime
   brand/category, brief, concept, format, canvas ratio, layout, and typography
   metadata, and selects two compatible references from the private Supabase
   bucket `artwork-reference-library`. The first contributes abstract layout
   grammar and visual medium; the second contributes compatible typography, lighting,
   materials, and finish without introducing another layout. The prompt-writing
   model inspects both signed URLs directly. The internal artworks are not sent
   to GPT Image 2 as edit-source images because that creates unwanted pressure
   to preserve their hero and background. Instead, the prompt writer translates
   the useful abstract lessons into self-contained art direction; GPT Image 2
   receives only real client assets such as logo, product, or uploaded source
   objects. Main
   visual, visual metaphor, subject, camera angle, background, props, and scene
   logic must be newly invented from the approved idea; recognizable reference
   content or arrangement cannot be reskinned. Typography transfers
   only when compatible with the runtime brand and approved mood; otherwise
   only hierarchy and rhythm carry forward. It does not copy the source
   artwork's brand, product, copy, characters, or scene.

   Before returning `finalPrompt`, the Reference Library prompt writer silently
   resolves a 12-principle design blueprint covering hierarchy, balance,
   contrast, alignment, proximity, repetition, emphasis, white space, scale,
   rhythm, unity, and grid/composition. The returned prompt must translate that
   blueprint into concrete margins, zones, scale relationships, grouping,
   focal point, balance strategy, and eye path rather than naming abstract
   principles. A final visual-coherence pass replaces vague aesthetic labels
   with observable visual facts, resolves contradictory media or lighting
   directions, writes the result as bounded layout sections, and adds
   artifact-specific negative constraints only when the selected subject or
   reference boundary creates that risk.

The selection is stored on the run, is included in new-generation and
regeneration requests, and survives workspace reloads. Older saved runs without
the field load as `standard`.

## Frontend env

```text
VITE_ARTWORK_GENERATION_MODE=openai
VITE_ARTWORK_GENERATION_ENDPOINT=
VITE_N8N_ARTWORK_WEBHOOK_URL=
```

`openai` is the default. If `VITE_ARTWORK_GENERATION_MODE=n8n`, Moons posts
directly to `VITE_N8N_ARTWORK_WEBHOOK_URL`; otherwise it posts to
`VITE_ARTWORK_GENERATION_ENDPOINT`. With neither OpenAI endpoint configured
nor n8n mode selected, the app keeps the prototype flow working by creating
draft output cards without generated assets.

When Supabase auth is available, the frontend sends the current Supabase access
token as `Authorization: Bearer <token>` so the backend can write storage/DB
through normal user-scoped policies or verify the user before using a service
role.

### n8n request additions

n8n receives every field in `ArtworkGenerationRequest`, plus:

```ts
{
  logoUrl: string | null;
  referenceImageUrls: { url: string; label?: string }[];
}
```

`logoUrl` is taken automatically from the current brand's `Logo` asset when
one exists. `referenceImageUrls` contains every image selected in **Use from
library**. The webhook must return the same `{ outputs: [...] }` response
shape documented below.

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
  artworkMode: "standard" | "design-system" | "reference-library";
  imagePromptModel: "gpt-5.6-terra" | "anthropic/claude-sonnet-4.6";
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
    why: string;
    visual: string;
    cta: string;
    caption: string;
  }[];
  textInputs: string[];
  referenceImages: (
    | { kind: "url"; url: string; label?: string; mediaType?: string }
    | { kind: "base64"; data: string; mediaType: string; label?: string }
    | { kind: "openai_file"; fileId: string; label?: string }
  )[];
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

`brandLibrary` feeds GPT Luna's upstream strategy enrichment and Design System
mode. Reference Library mode does not forward raw Brand Analysis, document, or
reference-note descriptions to the prompt writer or GPT Image 2; it forwards
only Luna's compact actionable strategy plus the approved brief, hook, visual
direction, CTA, Brand Kit, and attached images.

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
   production-ready image prompt using the run's selected `artworkMode` — see
   "Image prompt agent" below. If that call fails, stop the artwork request and
   return the provider error; do not silently substitute another prompt.
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
supabase/migrations/202607160001_artwork_reference_library.sql
```

The second migration creates the private, read-only runtime reference bucket.
Build the deployment catalog and seed or refresh all 72 inspected artwork
objects with the service-role key:

```bash
npm run references:upload
```

The build step distills `agent_prompt/Images/output/library_index.json` and the
human-written reconstruction prompts into
`artwork-reference-catalog.generated.ts`. The uploader sources all 72 original
images from `agent_prompt/Images`, creates the bucket if necessary, and upserts
stable `artworks/*` object paths. Source images are not included in the Vercel
artwork function; production generation reads them only from Supabase.

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

Status: implemented 2026-07-10 and corrected 2026-07-14. Previously
`buildImagePrompt()` was pure deterministic string concatenation of the
hook/concept/visual/caption/brief fields — no model call and no real art
direction. That fallback has been removed so a prompt-agent failure cannot
quietly generate artwork from the wrong instructions.

`resolveImagePrompt()` in `artwork-generation-endpoint.ts` calls
`generateImagePrompt()` (`image-prompt-agent.ts`) once per selected hook,
before image generation. The agent's returned prompt is what actually gets
sent to `gpt-image-2`, not the old deterministic template.

The three modes intentionally use different input strategies:

- `standard` loads the complete `agent_prompt/agent_image.md` as the
  authoritative image-agent instruction. It then appends one
  `AUTHORITATIVE COMPACT CAMPAIGN INPUT` JSON object assembled in
  `image-prompt-agent.ts`. That runtime object includes only brand
  name/category/personality/colors/avoid rules, objective, Angle, exact
  on-image copy, hero visual, compact reference roles, and output density. It
  does not append the full campaign Brief, Caption, product library, or
  repeated runtime blocks. Regeneration adds one optional
  `revisionInstructions` array only when the user entered instructions. The
  required response field is `finalPrompt`.
- `design-system` reads
  `graphic-ad-design-system/03_MASTER_CREATIVE_DIRECTOR_AGENT.md` and retains
  its `prompt` response field.
- `reference-library` reads `agent_prompt/agent_artwork_reference.md`, appends
  a compact runtime input that deliberately excludes raw Brand Library and
  Brand Analysis prose, and returns `finalPrompt`. It attaches the two selected
  private Supabase objects as high-detail signed URLs so the prompt agent can
  inspect the actual artwork.
  Attached client references remain authoritative for brand and product
  fidelity; the primary internal pattern supplies composition and visual
  medium, while the secondary supplies compatible craft and finish. Only the
  actionable GPT Luna strategy fields are forwarded, not its catalog-search
  rationale or the source Brand Analysis blob.

All three prompt Markdown files are bundled into the Vercel function. Artwork
source image files are not bundled; they are loaded from Supabase Storage.
Standard-mode reference files are still attached as image inputs, while their
text metadata is reduced to `{ id, role, fidelity }`. The design-system mode
retains its full authoritative runtime block and keeps the approved Hook fixed
while evaluating distinct visual executions internally.

If the prompt-agent call fails or times out, the endpoint fails closed before
calling `gpt-image-2`. A sanitized provider response detail is recorded in the
debug trace and returned as the request error. There is no deterministic or
hidden fallback prompt.

The user chooses the image prompt writer in Angles, and the choice persists on
the creative run:

- `gpt-5.6-terra` is the default and calls the OpenAI Responses API using
  `OPENAI_API_KEY`. `OPENAI_IMAGE_PROMPT_MODEL` can override the deployed
  OpenAI model.
- `anthropic/claude-sonnet-4.6` calls OpenRouter's OpenAI-compatible Responses
  API using `OPENROUTER_API_KEY`. `OPENROUTER_IMAGE_PROMPT_MODEL` can override
  the deployed OpenRouter model while the UI remains the fixed Claude Sonnet
  4.6 choice.

This selection changes only the model that writes the production prompt. Final
artwork still uses OpenAI `gpt-image-2`. Older saved workspaces and older API
requests without `imagePromptModel` default to `gpt-5.6-terra`.

Reference Library strategy enrichment always uses OpenAI `gpt-5.6-luna` through
the existing `OPENAI_API_KEY`. `OPENAI_CREATIVE_STRATEGY_MODEL` can override the
deployed support model without adding another user-facing model selector.

### Prompt and image request debug logs

Set `ARTWORK_GENERATION_DEBUG_LOG_DIR` (for example,
`logs/artwork-generation`) to retain the exact generation inputs and viewable
image artifacts for each selected hook. Reference Library hooks write four
sanitized JSON
files:

- `*-strategy-agent.json` records the GPT Luna input, selected commercial
  style/mechanism, catalog preferences, verified or creative-placeholder
  offer/proof/differentiator copy, evidence status, text-review flag, and
  missing evidence.
- `*-image-agent.json` records the prompt-writer request to `/v1/responses` or
  OpenRouter `/api/v1/responses`: provider, model, artwork mode,
  success/failure status, the complete rendered
  `input_text`, reference labels/MIME types/byte counts, the JSON response
  format, and the returned production prompt or readable error.
- The existing `*.json` file records the final request sent to
  `/v1/images/generations` or `/v1/images/edits`, including the final prompt
  after runtime constraints are appended. For edit requests, its image entries
  link to local `*-input-01.jpg`, `*-input-02.png`, and similar files containing
  the exact reference bytes sent to the model.
- `*-image-output.json` records the returned MIME type and byte count plus the
  Supabase bucket/path. Its `localFile` points to the exact generated
  `*-output.png` saved beside the logs.

The JSON logs never persist OpenAI or OpenRouter authorization headers, API
keys, signed Supabase URLs, or base64 image bodies. Reference and output images
are deliberately saved as separate local files only when this opt-in variable
is set. Prompt-agent failures are logged and stop final image generation.
Logging is best-effort: a filesystem error emits a warning but does not fail
the run. The default `logs/` directory is ignored by Git.

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
For each output with a real `assetUrl`, the frontend sends the image inline
alongside the full creative context: Hook, Subheadline, Concept, visual
direction, CTA, Caption, Brief, brand/category, Brand kit, products, client
documents, brand-memory working/avoid rules, selected reference images, Brand
kit image references, and any existing GD/CS/PM revision comments. Duplicate
reference URLs are removed before the request.

The agent evaluates two independent gates using the shared constants in
`src/domain/quality-check.ts` so the runtime prompt and Internal QC UI cannot
drift.

GD Checklist:

- ความสวยงาม องค์ประกอบ และจุดนำสายตา
- งาน Final ต้องพัฒนาจาก Mockup ไม่แบนหรือดูเหมือน Template เกินไป
- ภาพ Gen AI ต้องเก็บให้สมูธ ไม่ลอยหรือดูตัดแปะ
- ตรวจ Logo, Brand CI, ชื่อแบรนด์/สินค้า และข้อความใน Artwork ให้ถูกต้อง

CS Checklist:

- Key Message ชัด และตรง Brief / Objective
- Visual กับ Caption สื่อสารไปในทิศทางเดียวกัน
- ข้อมูล ราคา โปรโมชัน คำสะกด และรายละเอียดต่าง ๆ ถูกต้อง
- งานตรง Client Context หรือ Revision Feedback ถ้าเป็นงานแก้

The structured model response is
`{ outputId, gdPassed, gdReason, csPassed, csReason }`. The endpoint derives
the existing compatibility result (`passed = gdPassed && csPassed`) and saves
a two-line GD/CS reason in the output QA note. The agent may only compare facts
against supplied evidence: missing Mockup/reference data or absent revision
feedback cannot by itself fail a creative.

The `run-qa` action now carries these results
(`{ type: "run-qa"; results: readonly QaResult[] }` in `model.ts`) instead of
being a bare trigger. The reducer sets each output's `status` to `"ready"`
or `"needs-revision"` per its real result and stores the model's reasoning
in a new `CreativeOutput.qaNote?: string` field, shown inline on the card
(`.output-qa-note`, preserving the GD/CS line break) when a creative is flagged.
`qaComplete` still just
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
- `agent_prompt/agent_image.md` — authoritative Standard-mode prompt.
- `agent_prompt/agent_artwork_reference.md` — 72-artwork retrieval and
  conditional typography contract loaded only in Reference Library mode.
- `src/server/artwork-generation/artwork-reference-catalog.generated.ts` —
  deployment-safe metadata distilled from all human-reviewed specs.
- `graphic-ad-design-system/03_MASTER_CREATIVE_DIRECTOR_AGENT.md` — runtime
  source prompt loaded only in Design System mode.
