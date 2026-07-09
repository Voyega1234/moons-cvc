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

The visible picker is merged with the published mapping Google Sheet. Clients
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

### `moons.brand_learning`

Source for Brand memory learning:

- `working`
- `avoid`

Future AI generation must cite these rows or their source rows when they affect
output.

Client ingestion Brand Memory write-back currently appends source references as
text (`Source: brand_analysis_jobs/{id}`) because this table does not yet have a
dedicated ingestion citation column.

### `moons.workspaces`

Stores the versioned UI state snapshot per authenticated user.

This is currently the persistence source of truth for refresh/login restore.

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

Apply in order:

1. `supabase/migrations/202606240001_production_backbone.sql`
2. `supabase/migrations/202606240003_normalized_workflow.sql`

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
