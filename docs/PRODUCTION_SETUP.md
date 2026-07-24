# Moons production setup

## Current production backbone

The app can now switch from mock/local persistence to Supabase-backed auth,
brand loading, and workspace persistence.

This first production slice intentionally stores the active workspace as a
versioned snapshot in `moons.workspaces`. The normalized `runs`, `outputs`,
and `activity_log` tables are created now so later slices can move one feature
at a time without changing the UI contract.

## Required environment

In Vercel → Project Settings → General, set **Node.js Version** to `22.x`.
The serverless handlers use the Node.js runtime; `24.x` is not supported by
the current Vercel build pipeline for this project.

Copy `.env.example` to `.env.local` and set:

```bash
VITE_DATA_SOURCE=supabase
VITE_SUPABASE_URL=<project-url>
VITE_SUPABASE_ANON_KEY=<anon-key>
```

For local full-stack development, run `npm run dev:full`. It uses `vercel dev`
on port `3000` so same-origin `/api/*` requests execute the local Vercel
Functions. The regular `npm run dev` command is frontend-only; API-backed
actions such as brand ingestion will not work under the standalone Vite server.

The local desktop setup also accepts `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
Only those two public Supabase values are mapped into the Vite client build.

In Supabase Auth → URL Configuration, set the Site URL and add these redirect
URLs:

```text
https://moons-cvc.vercel.app/
http://localhost:3000
```

Creative Compass uses Supabase Google OAuth instead of email magic links. Set
up the Google Cloud and Supabase providers as follows:

1. Use a Google Cloud project owned by the Convert Cake Google Workspace
   organization.
2. In Google Auth Platform → Audience, choose **Internal** so only Workspace
   organization accounts can authorize the app.
3. Enable the **Google Drive API** and **Google Sheets API**.
4. In Google Auth Platform → Data Access, configure:

   ```text
   openid
   https://www.googleapis.com/auth/userinfo.email
   https://www.googleapis.com/auth/userinfo.profile
   https://www.googleapis.com/auth/drive.file
   https://www.googleapis.com/auth/spreadsheets.readonly
   ```

5. Create a **Web application** OAuth client. Add the production origin and
   `http://localhost:3000` as authorized JavaScript origins.
6. Add the callback URL shown in Supabase Auth → Providers → Google as the
   Google client's authorized redirect URI. It has this shape:

   ```text
   https://<supabase-project-ref>.supabase.co/auth/v1/callback
   ```

7. In Supabase Auth → Providers → Google, enable the provider and enter that
   OAuth client ID and secret.
8. Apply `202607240001_google_auth_domain_hook.sql`. Then open Supabase
   Authentication → Hooks and select
   `public.hook_restrict_creative_compass_signup` for **Before User Created**.
   This rejects non-Google and non-`@convertcake.com` signups before an
   `auth.users` record is created.
9. After Google login is verified in Production, disable the Supabase Email
   provider to prevent new magic-link sign-ins.

The app also sends `hd=convertcake.com` to improve Google's account chooser,
then verifies the returned Supabase user's email again in the browser and in
every protected server endpoint. The `hd` parameter is not treated as an
authorization boundary.

Google's provider access token is kept in browser storage for at most 55
minutes and cleared on sign out. No Google refresh token is persisted. When
Google access expires, sign out and sign in again to grant a fresh token.

The same Google grant is used for:

- converting generated PowerPoint files into Google Slides with
  `drive.file`;
- reading the private `1. Questionnaire` tab with
  `spreadsheets.readonly`.

Questionnaire Sheets no longer need **Anyone with the link**. The signed-in
`@convertcake.com` user must have read access to the Sheet.

Do not expose the Supabase service role key in Vite/client env.

Backend/worker-only secrets for client ingestion:

```bash
SUPABASE_URL=<project-url>
SUPABASE_ANON_KEY=<anon-key>
APIFY_TOKEN=<apify-token>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
OPENAI_API_KEY=<openai-api-key>
OPENAI_BRAND_ANALYSIS_MODEL=gpt-5.6-terra
GEMINI_API_KEY=<gemini-api-key>
GEMINI_GROUNDING_MODEL=gemini-3.5-flash
CLIENT_INGESTION_WORKER_TOKEN=<long-random-secret>
```

These must stay outside `VITE_*` env and must not be imported by browser code.
`SUPABASE_ANON_KEY` is required server-side by the authenticated immediate
trigger. `CLIENT_INGESTION_WORKER_TOKEN` protects the separate manual recovery
endpoint. It may be left empty only during isolated local development; set it
before deployment.

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

The normal short-term Vercel-only flow is:

1. The browser queues the Supabase ingestion job.
2. The signed-in Convert Cake user's access token is sent to
   `POST /api/trigger-client-ingestion`.
3. The trigger verifies that user with Supabase, validates all worker secrets,
   schedules one worker cycle with Vercel `waitUntil`, and returns `202`.
4. The existing polling/mailbox flow reports completion, review, or failure.

No external worker host or scheduler is required for this path. Both
`api/trigger-client-ingestion.ts` and the worker use `maxDuration: 300`. The
background task still shares that Vercel Function duration, so one brand
analysis must finish within 300 seconds. Larger or resumable runs still need a
later queue-consumer architecture.

The manual recovery entrypoint remains:

```text
api/client-ingestion-worker.ts
```

Invoke it with:

```http
POST /api/client-ingestion-worker
Authorization: Bearer <CLIENT_INGESTION_WORKER_TOKEN>
```

One request atomically claims and processes at most one queued ingestion job.
Call this endpoint manually when a queued job needs recovery, or connect a
scheduler later if the immediate 300-second Vercel path is no longer enough.
Never send the service-role, Apify, OpenAI, or Gemini secrets to the browser.

The worker uses a Supabase `service_role` client. Apply the service-role
migration below before running it because custom-schema tables require explicit
PostgreSQL grants.

The client picker reads a normal, domain-restricted Google Sheet URL through
the backend:

```bash
MAPPING_CLIENTS_GOOGLE_SHEET_URL=<normal-google-sheet-url>
GOOGLE_CLOUD_PROJECT_NUMBER=<numeric-project-number>
GOOGLE_WORKLOAD_IDENTITY_POOL=<pool-id>
GOOGLE_WORKLOAD_IDENTITY_PROVIDER=<provider-id>
GOOGLE_SERVICE_ACCOUNT_EMAIL=<service-account-email>
```

Production and Preview use the Vercel OIDC token with Google Workload Identity
Federation. Grant only the matching Vercel project/environment principal
`roles/iam.serviceAccountTokenCreator` on the dedicated service account.
Authorize that service account's numeric OAuth client ID in Google Workspace
Domain-Wide Delegation with only:

```text
https://www.googleapis.com/auth/spreadsheets.readonly
```

For local development, grant the developer or developer group
direct read access to the domain-restricted Sheets and run:

```bash
gcloud auth application-default login \
  --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/spreadsheets.readonly
```

If the local request has no authenticated Supabase email, set
`GOOGLE_WORKSPACE_LOCAL_USER` to the developer's `@convertcake.com` email as a
domain-validation fallback.
Local development uses the user ADC Sheets token directly and does not require
`GOOGLE_SERVICE_ACCOUNT_EMAIL`; that variable is required only in Production
and Preview for OIDC plus Domain-Wide Delegation.
Do not set `GOOGLE_APPLICATION_CREDENTIALS`; service-account JSON keys are
intentionally rejected.

To dry-run an idempotent sync of Sheet rows whose `Status` is exactly `Active`
into missing `moons.clients` records:

```bash
npm run clients:import-mapping
```

Apply the reviewed import with `npm run clients:import-mapping -- --apply`.
Imported clients use `source = 'mapping_import'` and
`ingestion_status = 'not_started'`; this makes them available for **Set up
brand** without automatically creating ingestion jobs. Client-name matching is
case-, spacing-, and punctuation-insensitive, so names such as `A-Klass Auto`
and `A Klass Auto` do not create duplicate clients.

Artwork generation is routed through a backend endpoint so `OPENAI_API_KEY`
stays server-side:

```bash
VITE_ARTWORK_GENERATION_ENDPOINT=<backend-artwork-endpoint>
OPENAI_IMAGE_PROMPT_MODEL=gpt-5.6-terra
OPENROUTER_API_KEY=<server-side-openrouter-key>
OPENROUTER_IMAGE_PROMPT_MODEL=anthropic/claude-sonnet-4.6
```

Alternatively, route artwork generation through n8n. This sends the full
artwork request plus `logoUrl` and selected `referenceImageUrls` to the
webhook, which must return `{ outputs: [...] }`:

```bash
VITE_ARTWORK_GENERATION_MODE=n8n
VITE_N8N_ARTWORK_WEBHOOK_URL=<n8n-artwork-webhook-url>
```

Users select the image prompt writer in Angles. GPT 5.6 is the default and uses
`OPENAI_API_KEY`; Claude Sonnet 4.6 uses `OPENROUTER_API_KEY` through
OpenRouter. Both model environment variables are optional deployment
overrides. The selected prompt writer creates the actual `gpt-image-2` prompt
from the hook, brief, brand context, and references. See
`docs/FEATURE_ARTWORK_GENERATION.md` for the full request contract.

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
supabase/migrations/202607160001_artwork_reference_library.sql
supabase/migrations/202607240001_google_auth_domain_hook.sql
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
- private Supabase Storage bucket `artwork-reference-library`
- service-role RPC `moons.claim_next_brand_analysis_job()`
- authenticated RPC `moons.queue_brand_analysis(client_id, facebook_url)`
- service-role access to ingestion and Brand Memory tables used by the worker
- service-role access to extracted product defaults

The same backend-only `APIFY_TOKEN` is used for the posts, Ads Library, and
`igview-owner~facebook-page-details-scraper` actors. Page-details enrichment is
optional: it supplies a default client category and mirrored Brand Library
logo without replacing values curated by the team.

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
