# Moons database contract

## Current production status

Production Supabase is active under the `moons` schema.

The app currently uses two persistence layers:

1. `moons.workspaces.snapshot` is the active UI persistence safety net.
2. Normalized workflow tables exist for the next adapter slices, but the UI is
   not fully wired to them yet.

Do not remove the workspace snapshot until every workflow slice has a
normalized read/write path and migration tests.

## Schema

All app tables live in:

```text
moons
```

The frontend queries this schema explicitly via:

```ts
client.schema("moons").from(...)
```

Supabase Dashboard must expose `moons` in Project Settings → API → Exposed
schemas.

## Auth and RLS

Access is controlled by:

```sql
moons.is_convert_cake_user()
```

Current rule:

- user is authenticated, and
- `app_metadata.organization = "convert_cake"` or email ends with
  `@convertcake.com`

If production uses another domain or SSO metadata claim, update this function
instead of scattering auth conditions through policies.

## Tables already used by the app

### `moons.clients`

Source for the Start brand picker.

The visible picker is merged with the domain-restricted mapping Google Sheet.
The sheet is read by the backend through keyless Workspace delegation. Clients
that exist in `moons.clients` are selectable. Clients that exist only in the
mapping sheet are displayed as grey/disabled rows so operators can see demand
without accidentally starting a run that has no brand memory.

Client ingestion adds:

- `facebook_url`
- `ingestion_status`
- `ingestion_error`
- `last_ingested_at`

New clients should start as draft until the backend harness has collected
sources, mirrored source images, analyzed brand signals, and written Brand
Memory.

The current UI creates draft clients and queued `brand_analysis_jobs`; Apify,
Gemini/Search, visual analysis, and memory write-back are backend harness
responsibilities.

### Client ingestion tables

Prepared by:

```text
supabase/migrations/202607090009_client_ingestion.sql
supabase/migrations/202607090010_claim_client_ingestion_job.sql
```

Use:

- `moons.brand_analysis_jobs` for harness progress and traces.
- `moons.brand_sources` for raw Apify/Gemini/manual source payloads.
- `moons.brand_social_posts` for normalized organic Facebook posts.
- `moons.brand_ad_library_items` for normalized Facebook Ads Library ads.
- `moons.brand_visual_assets` for mirrored image-only assets and visual
analysis results.

The required user-entered onboarding questionnaire is stored in
`moons.brand_sources` with `source_type='manual_input'` and
`raw_payload.kind='onboarding_questionnaire'`. Brand reads load the newest
matching source so Hook Agent keeps the onboarding context after refresh.

Facebook CDN URLs are temporary. Durable source images belong in private
Supabase Storage bucket `brand-source-assets`; store the object path in
`brand_visual_assets.asset_storage_path`.

Workers should claim queued ingestion jobs through:

```sql
select * from moons.claim_next_brand_analysis_job();
```

The function claims exactly one queued job atomically with
`FOR UPDATE SKIP LOCKED` and is intended for service-role backend runtimes, not
browser code.

### `moons.brand_library`

Source for Brand memory library sections:

- `brand`
- `products`
- `docs`
- `refs`

`section='brand'` is writable from the Brand kit panel for voice, CI, claim
rules, approved wording, banned wording, and brand guideline summaries.
`asset_url` also holds the brand logo — the Brand kit panel treats the row
titled `Logo` as a special upload slot, everything else renders as a plain
rule or, when the description is a short delimited list with no sentence
punctuation, as tag/color-swatch chips.

Write access (insert/update/delete for `authenticated`, gated by
`moons.is_convert_cake_user()`) was added by
`supabase/migrations/202606240007_brand_library_writes.sql`. The base
migration only ever granted `select`, so this file must be applied to any new
project before Brand kit edits or logo upload will work — a `42501 permission
denied` error on `brand_library` means it's missing.

### `moons.brand_learning`

Source for Brand memory learning:

- `working`
- `avoid`

Future AI generation must cite these rows or their source rows when they affect
output.

Client ingestion Brand Memory write-back currently appends source references as
text (`Source: brand_analysis_jobs/{id}`) because this table does not yet have a
dedicated ingestion citation column.

Insert access (`authenticated`, gated by `moons.is_convert_cake_user()`) was
added by `supabase/migrations/202607091014_brand_learning_writes.sql`. The
base migration only granted `select`. This is what the Learning suggestions
agent (see `docs/FEATURE_BRAND_LEARNING.md`) writes to once a person approves
a suggestion — `source_run_id` is set to the run the suggestion came from.
No update/delete grant exists; suggestions are append-only.

### `moons.workspaces`

Stores the versioned UI state snapshot per authenticated user.

This remains the private refresh/login safety net. After
`202607160002_single_owner_handoffs.sql` is applied, shared creative state is
loaded from per-run snapshots in `moons.runs`; the private workspace is kept
as a migration fallback and for each user's local view preference.

### `moons.runs` collaboration fields

Each shared run has one current owner. Assigned client members can view it,
but only `current_owner_user_id` can update it. `version` is checked on every
save so an old browser cannot overwrite newer data. `workspace_run_id` maps
the existing `run-<uuid>` application id to the database UUID, and `snapshot`
holds the validated workflow state while the remaining normalized adapters
are connected.

Handoffs use `moons.handoff_run(...)`, which locks the run, verifies the
expected version, changes the owner, increments the version, and inserts one
append-only `moons.run_handoffs` audit record in the same transaction.

Client visibility is prepared through `moons.client_memberships`. A client
with no membership rows remains visible to every Convert Cake user for the
current rollout. Once memberships are added for that client, only its members
and Compass admins can view it.

## Normalized workflow tables prepared for next slices

## Brand Memory tables prepared for upload/edit slices

### `moons.brand_products`

Structured product/service data for the Products tab.

### `moons.brand_documents`

Uploaded documents and extracted text for the Documents tab. Documents move
through `uploaded`, `processing`, `ready_for_ai`, and `failed`.

Allowed `document_type` values are controlled by the UI and database:

- `brand_guideline`
- `product_factsheet`
- `campaign_brief`
- `claim_support`
- `reference`
- `report`
- `other`

### `moons.brand_references`

Visual/link references for the References tab.

Read `docs/FEATURE_BRAND_MEMORY.md` before wiring uploads or save actions.

### `moons.jobs`

Async job state for hooks, artwork, captions, QA, and export.

Statuses:

- `queued`
- `processing`
- `completed`
- `failed`
- `cancelled`

Use `idempotency_key` to prevent duplicate completions from creating duplicate
outputs.

### `moons.creative_directions`

Stores generated hooks and ranking:

- hook
- concept
- why
- visual
- cta
- caption
- citations
- ranking_score
- selected
- provider/model/generation_version

This should become the source of truth for the Hook step before real AI hooks
are connected.

### `moons.qa_results`

Stores QA checks for outputs.

Statuses:

- `pass`
- `moons_fixed_it`
- `needs_revise`

Use this for the future `runQA()` implementation.

### `moons.outputs`

Stores generated creative output metadata. Generated image bytes should live in
Supabase Storage, not in `payload` or workspace snapshots.

Use:

- `asset_bucket = 'creative-assets'`
- `asset_storage_path` for the durable object key
- `asset_url` for a delivery URL or signed URL
- `provider` and `model` for generation provenance

`payload` can store prompt/version metadata but must not store base64 image
data.

**Not wired yet.** Real image generation, per-creative GD/CS/PM approval, AI
quality-check results, and replacement-upload revisions all exist and work
today (`docs/FEATURE_ARTWORK_GENERATION.md`, `docs/FEATURE_INTERNAL_QC.md`),
but every bit of that state — `approval`, `status`, `qaNote`,
`revisionCount`, `assetUrl` — lives only in `moons.workspaces.snapshot`
(`CreativeOutput` in `src/domain/creative-run.ts`), scoped to whichever
user's login created the run. Nothing writes to `moons.outputs`. This is the
same situation the hook step is in relative to
`moons.creative_directions` — see "Next adapter order" below, item 2 is
still not started despite the features it would back being fully built on
top of the snapshot instead.

### `moons.internal_reviews`

Stores GD/CS/PM review decisions.

Roles:

- `gd`
- `cs`
- `pm`

Use `replacement_asset_url` when GD uploads a corrected image.

### `moons.client_review_links`

Stores run-scoped client review links.

Only hashed tokens belong in the database. Do not store raw public tokens.

### `moons.client_review_items`

Stores per-output client decisions and revision rounds.

Round 1 and 2 are in scope. Round 3 and above should be displayed as out of
scope / extra bill.

### `moons.exports`

Stores CSV/PPTX export attempts and generated file URLs.

## Migration files

Apply in order. None of these run automatically — a migration existing in
this repo does not mean it has been applied to the live project. Twice this
session a feature shipped against a migration that was still unapplied and
only surfaced as a runtime `42501 permission denied` error. Verify against
the actual project (Supabase Dashboard → SQL Editor → run the file) rather
than assuming the repo state matches production.

1. `supabase/migrations/202606240001_production_backbone.sql`
2. `supabase/migrations/202606240003_normalized_workflow.sql`
3. `supabase/migrations/202606240004_brand_memory.sql`
4. `supabase/migrations/202606240005_brand_asset_storage.sql`
5. `supabase/migrations/202606240006_brand_document_types.sql`
6. `supabase/migrations/202606240007_brand_library_writes.sql` — brand kit
   write access (insert/update/delete), missing from the base migration.
7. `supabase/migrations/202606260008_creative_asset_storage.sql` — the
   `creative-assets` storage bucket used by hook/image generation and
   Internal QC replacement uploads.
8. `supabase/migrations/202607090009_client_ingestion.sql`
9. `supabase/migrations/202607090010_claim_client_ingestion_job.sql`
10. `supabase/migrations/202607090011_queue_brand_ingestion.sql`
11. `supabase/migrations/202607090012_client_ingestion_service_role.sql`
12. `supabase/migrations/202607090013_brand_products_worker_access.sql`
13. `supabase/migrations/202607091014_brand_learning_writes.sql` — brand
    learning write access (insert only), used by the Learning suggestions
    agent to persist approved suggestions.
14. `supabase/migrations/202607160002_single_owner_handoffs.sql` — shared run
    snapshots, team profiles, client membership visibility, single-owner RLS,
    optimistic version checks, and atomic handoff history.

Seed prototype clients with:

```text
supabase/seed/202606240002_seed_mock_clients.sql
```

## Next adapter order

Recommended next implementation order:

1. Wire Hook generation to `moons.jobs` + `moons.creative_directions`.
2. Wire output creation to normalized `moons.outputs`.
3. Wire QA to `moons.jobs` + `moons.qa_results`.
4. Wire internal review to `moons.internal_reviews`.
5. Wire client review links/items.
6. Wire exports.

Keep feature code behind ports/repositories. UI should not call Supabase
directly.
