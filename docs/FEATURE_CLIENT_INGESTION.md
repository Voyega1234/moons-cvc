# Client ingestion harness contract

## Goal

Add a client with a required Facebook URL, collect public Facebook signals,
mirror source images into Supabase Storage, analyze brand/visual signals, and
write reusable Brand Memory.

This is a backend harness feature. The frontend must not call Apify, Gemini, or
OpenAI directly.

## Required frontend input

- client name
- Facebook URL
- optional category
- optional notes

Create the client as a draft first:

```text
moons.clients.ingestion_status = 'draft'
```

Current frontend slice:

- Step 1 Start has an `Add new client` panel.
- Facebook URL is required and validated client-side.
- Submit creates a client draft and a queued `brand_analysis_jobs` row.
- Draft/queued/in-progress/failed clients are visible in the picker but disabled
  until ingestion reaches a usable status.
- Existing manual clients with `not_started` remain selectable for backward
  compatibility.

Current frontend/repository files:

- `src/features/workflow/stages.tsx`
- `src/domain/client-ingestion.ts`
- `src/ports/client-intake-repository.ts`
- `src/repositories/client-intake/supabase-client-intake-repository.ts`
- `src/repositories/client-intake/mock-client-intake-repository.ts`
- `src/app/providers/client-intake-provider.tsx`

Current backend harness core:

- `src/server/client-ingestion/apify-client.ts`
- `src/server/client-ingestion/client-ingestion-harness.ts`
- `src/server/client-ingestion/client-ingestion-runner.ts`
- `src/server/client-ingestion/openai-brand-visual-analyzer.ts`
- `src/server/client-ingestion/gemini-grounding-search-fallback.ts`
- `src/server/client-ingestion/client-ingestion-worker.ts`
- `src/server/client-ingestion/client-ingestion-worker-endpoint.ts`
- `src/server/client-ingestion/client-ingestion-trigger-endpoint.ts`
- `api/client-ingestion-worker.ts`
- `api/trigger-client-ingestion.ts`
- `src/server/client-ingestion/supabase-brand-memory-writer.ts`
- `src/server/client-ingestion/supabase-client-ingestion-store.ts`
- `src/server/client-ingestion/supabase-image-mirror.ts`
- `src/server/client-ingestion/client-ingestion-harness.test.ts`

These files are not imported by the browser app. They are intended for a
server/worker runtime that owns backend secrets.

## Backend harness steps

Recommended controlled agent flow:

1. Validate Facebook URL.
2. Create `moons.brand_analysis_jobs`.
3. Run Apify Facebook posts scraper.
4. Run Apify Facebook Ads Library scraper.
5. If Facebook sources are inaccessible, use Gemini grounding search fallback.
6. Normalize post/ad records.
7. Extract image-only visual candidates.
8. Download each candidate image immediately.
9. Upload mirrored images to Supabase Storage bucket `brand-source-assets`.
10. Save normalized records and visual assets.
11. Analyze visual mood/style from mirrored Supabase images.
12. Analyze brand signals.
13. Write Brand kit, Products, and Brand learning.
14. Mark client `ready`, `needs_review`, or `failed`.

## Source collection

### Facebook posts

Use Apify actor:

```text
apify~facebook-posts-scraper
```

Expected source type:

```text
facebook_posts
```

### Facebook Ads Library

Use Apify actor:

```text
curious_coder~facebook-ads-library-scraper
```

Expected source type:

```text
facebook_ads_library
```

This actor has a different input contract from the Posts actor:

```json
{
  "urls": [{ "url": "https://www.facebook.com/example" }],
  "limitPerSource": 30,
  "scrapeAdDetails": true,
  "scrapePageAds.activeStatus": "all",
  "scrapePageAds.countryCode": "ALL"
}
```

Do not put Apify token in frontend env or query params. Use a backend secret and
send:

```http
Authorization: Bearer <APIFY_TOKEN>
```

Server-only env:

```text
APIFY_TOKEN=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
OPENAI_BRAND_ANALYSIS_MODEL=gpt-5.6-terra
GEMINI_API_KEY=
GEMINI_GROUNDING_MODEL=gemini-3.5-flash
CLIENT_INGESTION_WORKER_TOKEN=
```

Do not expose these as `VITE_*`.

## Image-only v1

Do not load or analyze full videos in v1.

For Facebook posts, visual candidates may come from:

- `media[].image.uri`
- `media[].preferred_thumbnail.image.uri`
- `media[].thumbnailImage.uri`
- `media[].thumbnail`

For Ads Library, visual candidates may come from:

- `snapshot.images[].original_image_url`
- `snapshot.images[].resized_image_url`
- `snapshot.videos[].video_preview_image_url`
- `snapshot.extra_images[].original_image_url`
- `snapshot.extra_images[].resized_image_url`

Video URLs such as `browser_native_hd_url`, `video_hd_url`, DASH manifests, or
MP4 URLs must not be sent to the visual analyzer in v1.

## Storage rule

Facebook CDN URLs are temporary and must not be the durable image source.

Backend must:

1. Download candidate image URL.
2. Upload image to private bucket:

```text
brand-source-assets
```

3. Save the durable Supabase object key in:

```text
moons.brand_visual_assets.asset_storage_path
```

Recommended path:

```text
{clientId}/{jobId}/{sourceType}/{sourceItemId}-{index}.jpg
```

Use signed URLs only for delivery/model calls. Do not store base64 images as
final assets.

## Database tables

Migration:

```text
supabase/migrations/202607090009_client_ingestion.sql
supabase/migrations/202607090010_claim_client_ingestion_job.sql
```

Tables/columns:

- `moons.clients.facebook_url`
- `moons.clients.ingestion_status`
- `moons.clients.ingestion_error`
- `moons.clients.last_ingested_at`
- `moons.brand_analysis_jobs`
- `moons.brand_sources`
- `moons.brand_social_posts`
- `moons.brand_ad_library_items`
- `moons.brand_visual_assets`

Server/worker RPC:

- `moons.claim_next_brand_analysis_job()` atomically claims one queued job with
  `FOR UPDATE SKIP LOCKED`.
- Execute permission is granted to `service_role`; do not call this from the
  browser.

## Normalizer code

Frontend-safe pure normalizers live in:

```text
src/services/client-ingestion/facebook-source-normalizers.ts
```

These normalizers:

- accept raw Apify payloads;
- return normalized post/ad records;
- return image-only visual asset candidates;
- do not return video URLs as visual candidates.

Backend harness can reuse or port this logic.

The current harness already:

- composes server-only worker dependencies through `client-ingestion-worker.ts`;
- exposes a POST-only worker endpoint handler through
  `client-ingestion-worker-endpoint.ts`;
- provides a Vercel-style serverless wrapper at `api/client-ingestion-worker.ts`;
- exposes an authenticated immediate trigger through
  `client-ingestion-trigger-endpoint.ts` and
  `api/trigger-client-ingestion.ts`;
- claims one queued job through `SupabaseClientIngestionJobQueue`;
- runs the claimed job through `runNextClientIngestionJob()`;
- runs posts and Ads Library Apify tools through injected `ApifyClient`;
- normalizes source payloads;
- extracts image-only visual candidates;
- persists source images through `SupabaseImageMirror`;
- writes raw source, normalized post/ad records, and visual asset records through
  `SupabaseClientIngestionStore`;
- can run injected visual analysis and write Brand Memory through
  `OpenAiBrandVisualAnalyzer` + `SupabaseBrandMemoryWriter`;
- can run injected Gemini grounding search fallback through
  `GeminiGroundingSearchFallback` when `GEMINI_API_KEY` is present;
- marks the client `failed` with `เข้าถึงลิงก์ Facebook นี้ไม่ได้` when both
  Facebook sources fail and no fallback is provided;
- marks the client `ready` after Brand Memory write-back when analysis does not
  require review;
- leaves the job in `needs_review` after mirroring images when no visual
  analyzer/writer is provided yet.

Still needed:

- runtime smoke test with real Supabase/Apify/OpenAI credentials;
- runtime smoke test with real Supabase/Apify/OpenAI/Gemini credentials.

To wire a backend worker manually, create a service-role Supabase client in the
worker runtime, then pass it into:

```ts
const queue = new SupabaseClientIngestionJobQueue(serviceRoleSupabase);
const store = new SupabaseClientIngestionStore(serviceRoleSupabase);
const imageMirror = new SupabaseImageMirror({ client: serviceRoleSupabase });
const visualAnalyzer = new OpenAiBrandVisualAnalyzer({
  apiKey: OPENAI_API_KEY,
  model: OPENAI_BRAND_ANALYSIS_MODEL,
});
const brandMemoryWriter = new SupabaseBrandMemoryWriter(serviceRoleSupabase);

await runNextClientIngestionJob({
  queue,
  apify,
  store,
  imageMirror,
  visualAnalyzer,
  brandMemoryWriter,
});
```

Do not create this service-role client in browser code.

The simpler production entrypoint contract is:

```ts
await runClientIngestionWorkerOnce({
  env: {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    APIFY_TOKEN,
    OPENAI_API_KEY,
    OPENAI_BRAND_ANALYSIS_MODEL,
    GEMINI_API_KEY,
    GEMINI_GROUNDING_MODEL,
  },
});
```

`OpenAiBrandVisualAnalyzer` uses OpenAI Responses API image inputs with signed
Supabase `assetUrl` values and Structured Outputs JSON schema. It sets
`store: false`, does not send base64 assets, and does not send Facebook CDN URLs
as durable source references.

`GeminiGroundingSearchFallback` uses Gemini Interactions API with
`tools: [{ type: "google_search" }]`. It is optional: if `GEMINI_API_KEY` is not
provided, inaccessible Facebook sources still fail with
`เข้าถึงลิงก์ Facebook นี้ไม่ได้`.

## Immediate Vercel trigger and recovery endpoint

After either client-intake route queues a job, the browser automatically calls:

```http
POST /api/trigger-client-ingestion
Authorization: Bearer <signed-in-supabase-access-token>
```

The endpoint requires `SUPABASE_URL` and `SUPABASE_ANON_KEY`, verifies that the
access token belongs to Convert Cake, validates the worker secrets, and uses
Vercel `waitUntil` to start one worker cycle before returning `202 Accepted`.
This is the short-term no-external-hosting path. The UI can show its queued
confirmation immediately while the existing polling/mailbox flow observes the
database result.

Both Vercel functions currently declare `maxDuration: 300`. `waitUntil` does
not make work outlive that function limit; a single analysis that takes longer
than 300 seconds can still be terminated and will need manual recovery or a
future resumable queue consumer.

The manual recovery serverless wrapper lives at:

```text
api/client-ingestion-worker.ts
```

Call it with:

```http
POST /api/client-ingestion-worker
Authorization: Bearer <CLIENT_INGESTION_WORKER_TOKEN>
```

The bearer token is enforced only when `CLIENT_INGESTION_WORKER_TOKEN` is set.
Use that token for manual recovery or an optional future scheduler. Each
request claims at most one queued `brand_analysis_jobs` row.

The worker uses a Supabase `service_role` client. Custom-schema tables still
need explicit PostgreSQL grants, so apply
`202607090012_client_ingestion_service_role.sql` before invoking the worker.

## Existing client setup

Clients that existed before this pipeline have
`ingestion_status = 'not_started'` and cannot be selected for a creative run.
The Start client picker shows **Set up brand** for those rows. The user must
provide a Facebook URL; `moons.queue_brand_analysis()` then atomically updates
the client and creates a queued job. Active jobs stay locked, while `ready` and
`needs_review` clients can continue to Brief.

Mapping-sheet-only clients remain visually muted and show
**No Moons data yet** with their mapping/service status. They expose
**Add to Moons**, which prefills the client name and requires a Facebook URL.
Submitting creates the Supabase client and queues the same ingestion pipeline;
the row remains locked until analysis finishes.

## Brand memory write-back

After analysis, write:

- visual direction, voice, positioning, claim guardrails to
  `moons.brand_library section='brand'`;
- product/service defaults to `moons.brand_products`, structured as name,
  description, offer, key benefit, audience, and claim notes;
- working/avoid learnings to `moons.brand_learning`;
- source and image citations through `brand_sources` and `brand_visual_assets`.

Start presents generated-memory evidence as a compact
`AI analysis · N images` citation. Internal job IDs and Supabase storage paths
must not be rendered as user-facing prose. Legacy rows that embedded those
values are cleaned at presentation time; new rows store only a compact source
trace in the text payload.

Brand analysis must use both source families when available:

- Organic Facebook Posts provide normal brand voice, recurring topics, and
  community-facing identity.
- Facebook Ads Library provides offers, benefits, audience signals, CTAs,
  commercial claims, and paid visual patterns.

Text evidence and image evidence are sampled with balanced Posts/Ads quotas so
one source cannot consume the whole model context before the other is seen. If
the two sources conflict, the model must surface uncertainty and request review.

On re-analysis, the new memory is written first. After every write succeeds,
older Brand Kit and observed-signal rows carrying an ingestion-job source marker
are removed. Manually authored rows have no marker and are preserved. Existing
products with the same normalized name are also preserved so user edits are not
overwritten by a later extraction.

Brand Profile → Past work uses saved Facebook posts and mirrored Ads Library
images as default reference work when available. It deduplicates Facebook posts
by post URL and ads by archive ID across ingestion runs, shows at most 12 recent
items from each source, labels them as reference-only, and creates fresh
one-hour signed URLs from the private `brand-source-assets` bucket. Text-only
Facebook posts remain visible even when no image was mirrored. Delivered Moons
outputs remain a separate section. The Start-page **Past work** tab uses the
same data source and switches the right-side library panel directly.

Current `SupabaseBrandMemoryWriter` appends:

- one Brand kit row for each `analysis.brandKitEntries[]`;
- one Brand kit row named `Visual guidance`;
- one Brand learning row for each `analysis.learning[]`.

Because `brand_library` and `brand_learning` do not yet have structured
ingestion citation columns, the writer embeds `Source: brand_analysis_jobs/{id}`
and source asset paths in the text. Add a dedicated citation table/columns later
if this needs to be queryable instead of human-readable.

## Statuses

Client/job statuses:

```text
not_started
draft
queued
validating_source
scraping_facebook_posts
scraping_facebook_ads
searching_fallback
mirroring_images
analyzing_visuals
analyzing_brand
writing_memory
ready
needs_review
failed
```

## Non-goals v1

- no full video analysis
- no video keyframe extraction
- no ad performance judgement
- no frontend Apify/Gemini/OpenAI calls
- no base64 final asset storage
