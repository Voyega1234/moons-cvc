# Moons production setup

## Current production backbone

The app can now switch from mock/local persistence to Supabase-backed auth,
brand loading, and workspace persistence.

This first production slice intentionally stores the active workspace as a
versioned snapshot in `moons.workspaces`. The normalized `runs`, `outputs`,
and `activity_log` tables are created now so later slices can move one feature
at a time without changing the UI contract.

## Required environment

Copy `.env.example` to `.env.local` and set:

```bash
VITE_DATA_SOURCE=supabase
VITE_SUPABASE_URL=<project-url>
VITE_SUPABASE_ANON_KEY=<anon-key>
```

The local desktop setup also accepts `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
Only those two public Supabase values are mapped into the Vite client build.

Do not expose the Supabase service role key in Vite/client env.

Backend/worker-only secrets for client ingestion:

```bash
SUPABASE_URL=<project-url>
APIFY_TOKEN=<apify-token>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
OPENAI_API_KEY=<openai-api-key>
OPENAI_BRAND_ANALYSIS_MODEL=gpt-5.6-terra
GEMINI_API_KEY=<gemini-api-key>
GEMINI_GROUNDING_MODEL=gemini-3.5-flash
CLIENT_INGESTION_WORKER_TOKEN=<long-random-secret>
```

These must stay outside `VITE_*` env and must not be imported by browser code.
`CLIENT_INGESTION_WORKER_TOKEN` protects the worker HTTP endpoint. It may be
left empty only during isolated local development; set it before deployment.

The server-side ingestion adapters live under `src/server/client-ingestion`.
They expect a backend-created Supabase client that uses
`SUPABASE_SERVICE_ROLE_KEY`; the Vite browser app must never import or
instantiate that client.

Visual brand analysis is handled by `OpenAiBrandVisualAnalyzer` in the backend
runtime. It reads mirrored Supabase signed image URLs and returns structured
Brand Memory guidance; do not call OpenAI from the frontend.

Facebook fallback search is handled by `GeminiGroundingSearchFallback` when
`GEMINI_API_KEY` is present. It uses Gemini grounding with Google Search from
the backend runtime; do not call Gemini from the frontend.

## Client ingestion worker

The deployable serverless entrypoint is:

```text
api/client-ingestion-worker.ts
```

Invoke it with:

```http
POST /api/client-ingestion-worker
Authorization: Bearer <CLIENT_INGESTION_WORKER_TOKEN>
```

One request atomically claims and processes at most one queued ingestion job.
After deployment, call this endpoint from a scheduler or n8n until no queued
jobs remain. Never send the service-role, Apify, OpenAI, or Gemini secrets to
the browser.

The worker uses a Supabase `service_role` client. Apply the service-role
migration below before running it because custom-schema tables require explicit
PostgreSQL grants.

The client picker also loads the published mapping Google Sheet CSV. Override
the default only when needed:

```bash
VITE_MAPPING_CLIENTS_CSV_URL=<published-google-sheet-csv-url>
```

Local desktop setup also accepts `MAPPING_CLIENTS_CSV_URL`.

Artwork generation is routed through a backend endpoint so `OPENAI_API_KEY`
stays server-side:

```bash
VITE_ARTWORK_GENERATION_ENDPOINT=<backend-artwork-endpoint>
OPENAI_IMAGE_PROMPT_MODEL=gpt-5.6-terra
```

`OPENAI_IMAGE_PROMPT_MODEL` is the model used by the image prompt agent that
writes the actual `gpt-image-2` prompt from the hook/brief/brand context —
see `docs/FEATURE_ARTWORK_GENERATION.md` for the request/response contract.

Brand kit's "Upload guideline" button analyzes an uploaded PDF or image for
mood/tone/style and a hex color palette:

```bash
OPENAI_GUIDELINE_ANALYSIS_MODEL=gpt-5.6-terra
```

See `docs/FEATURE_BRAND_MEMORY.md` for how the result gets written back into
Brand kit.

Hook generation can run through either the existing n8n webhook or the backend
harness agent:

```bash
VITE_HOOK_GENERATION_MODE=n8n
VITE_HOOK_GENERATION_MODE=harness
VITE_HOOK_GENERATION_HARNESS_ENDPOINT=/api/hook-generation-harness
OPENAI_HOOK_GENERATION_MODEL=gpt-5.6-terra
```

Harness mode uses `OPENAI_API_KEY` on the backend only. When backend
`SUPABASE_URL` and `SUPABASE_ANON_KEY` are set, the endpoint verifies the
incoming Supabase access token and only allows Convert Cake users. It performs
a research/search step before generating and ranking six hooks. See
`docs/FEATURE_HOOK_GENERATION.md`.

## Database setup

Apply:

```text
supabase/migrations/202606240001_production_backbone.sql
supabase/migrations/202606240003_normalized_workflow.sql
supabase/migrations/202606240004_brand_memory.sql
supabase/migrations/202606240005_brand_asset_storage.sql
supabase/migrations/202606240006_brand_document_types.sql
supabase/migrations/202606240007_brand_library_writes.sql
supabase/migrations/202606260008_creative_asset_storage.sql
supabase/migrations/202607090009_client_ingestion.sql
supabase/migrations/202607090010_claim_client_ingestion_job.sql
supabase/migrations/202607090011_queue_brand_ingestion.sql
supabase/migrations/202607090012_client_ingestion_service_role.sql
supabase/migrations/202607090013_brand_products_worker_access.sql
```

The migration creates:

- `moons.clients`
- `moons.brand_library`
- `moons.brand_learning`
- `moons.workspaces`
- `moons.runs`
- `moons.outputs`
- `moons.activity_log`
- `moons.jobs`
- `moons.creative_directions`
- `moons.qa_results`
- `moons.internal_reviews`
- `moons.client_review_links`
- `moons.client_review_items`
- `moons.exports`
- `moons.brand_products`
- `moons.brand_documents`
- `moons.brand_references`
- private Supabase Storage bucket `brand-assets`
- private Supabase Storage bucket `brand-source-assets`
- service-role RPC `moons.claim_next_brand_analysis_job()`
- authenticated RPC `moons.queue_brand_analysis(client_id, facebook_url)`
- service-role access to ingestion and Brand Memory tables used by the worker
- service-role access to extracted product defaults

RLS is enabled. Access is limited by `moons.is_convert_cake_user()`, currently
defined as:

- authenticated user, and
- `app_metadata.organization = "convert_cake"` or email ending in
  `@convertcake.com`

If Convert Cake uses a different email domain or SSO metadata claim, update
only that SQL function.

In Supabase Dashboard, expose the `moons` schema to the API before testing the
frontend: Project Settings → API → Exposed schemas → add `moons`.

Existing clients start with `ingestion_status = 'not_started'`. They remain
locked in Start until a user clicks **Set up brand**, supplies a Facebook URL,
and the ingestion worker finishes with `ready` or `needs_review`.

## Minimum seed data

Before switching production on, seed at least:

1. one row in `clients`
2. optional rows in `brand_library`
3. optional rows in `brand_learning`

The UI can load clients with empty library/learning, but the first production
test should include representative rows so Start and Brand memory can be
verified.

For the current prototype data, run:

```text
supabase/seed/202606240002_seed_mock_clients.sql
```

This seed is idempotent and can be run again after editing the prototype client
list.

## First production acceptance

- Supabase mode shows the sign-in gate.
- A Convert Cake user can sign in.
- Client list loads from `moons.clients`.
- A run can be created and edited.
- Refresh restores the same workspace from `moons.workspaces`.
- Two open runs remain isolated after refresh.
- Mock mode still works without Supabase env.
