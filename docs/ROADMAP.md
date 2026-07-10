# Moons production roadmap

## Planning rule

The HTML prototype is the source of truth for v1 behavior and appearance.

Work is divided by dependency:

1. Build now when behavior can be defined and verified inside this repository.
2. Wait when correct implementation requires an external system, credential,
   model, schema owner, or business decision.
3. Defer scale work until the core workflow is operating with real data.

Do not create fake production integrations to make a milestone appear complete.

## Current baseline

Available now:

- React and strict TypeScript application
- Seven visible workflow steps
- Mock end-to-end flow
- Responsive layout
- Shared modules, repository ports, and a Supabase client boundary
- Unit tests and production build

Not production-ready yet:

- Refresh persistence is implemented through `moons.workspaces.snapshot`, but
  most workflow slices still need normalized adapters
- Hooks, artwork generation, reference-image editing, regenerate-with-prompt,
  GD/CS/PM internal review, AI vision quality-check, and learning-suggestion
  write-back are real (see `docs/FEATURE_HOOK_GENERATION.md`,
  `docs/FEATURE_ARTWORK_GENERATION.md`, `docs/FEATURE_INTERNAL_QC.md`,
  `docs/FEATURE_BRAND_LEARNING.md`) — but all of it is scoped to a single
  login's `moons.workspaces` row, not a normalized shared table (see
  `docs/DATABASE_CONTRACT.md` isolation warning). Client review links,
  export, and Slack notification remain mock/unbuilt.
- Visual regression tests are not automated

## Track A: Build now

These milestones do not require Creative Compass, Slack, all-clients, or a
configured production Supabase project.

### A1. Lock the v1 product contract

Status: completed in `docs/V1_WORKFLOW_CONTRACT.md`.

Deliver:

- Document the state and completion rule for every workflow step
- Document allowed back navigation
- Document which steps are locked and why
- Define statuses for runs, jobs, outputs, reviews, and delivery
- Define a single primary action for every step
- Add stable test IDs only where semantic selectors are insufficient

Verify:

- Each step has one completion predicate
- No route can skip an incomplete required step
- Back navigation does not delete completed data
- Visible behavior matches the prototype

### A2. Build the multi-run domain

Status: completed. Persistence and startup restore are implemented in A3.

Deliver:

- Replace the single workflow state with `WorkspaceState`
- Store runs by ID instead of one global run object
- Track `activeRunId`
- Create, switch, close, and restore run snapshots
- Ensure directions, outputs, reviews, files, and progress belong to one run
- Preserve a selected client when starting a related run

Suggested model:

```text
WorkspaceState
  activeRunId
  runOrder[]
  runsById{}

CreativeRun
  id
  clientId
  kind: client | pitching
  stage
  brief
  directions[]
  outputs[]
  reviews
  jobs[]
  createdAt
  updatedAt
```

Verify:

- Create one Album run and one Single run
- Enter different briefs in both
- Switch between them repeatedly
- No field, output, selection, or review state crosses between runs
- Unit tests cover create, switch, close, and restore

### A3. Add a persistence contract

Status: completed for the versioned LocalStorage development adapter. The
Supabase implementation remains blocked by Track B1 inputs.

Deliver:

- Define `WorkspaceRepository` and `RunRepository`
- Add serialization and versioning for stored state
- Add a temporary browser persistence adapter for development
- Restore unfinished runs on application startup
- Keep Supabase implementation behind the same port

The browser adapter is a development implementation, not the final production
database. It exists to verify persistence semantics before connecting remote
data.

Verify:

- Refresh restores all open runs and the active run
- Invalid or old persisted state fails safely
- Migration tests cover persisted schema versions
- UI does not import browser storage or Supabase directly

### A4. Implement workflow guards

Status: synchronous workflow guards completed on 2026-06-24. Async pending,
failure, retry, and duplicate-submission behavior remains in A5 because it
depends on the job domain model.

Deliver:

- Central completion predicates
- Central navigation guard
- Back navigation for all seven steps
- Explicit pending, failure, retry, and completed states in the job model
- Prevent review before QA completion
- Prevent delivery before all required approvals

Verify:

- Guard logic is unit-tested independently of React
- Disabled navigation communicates why it is unavailable
- Reloading during an in-progress step does not unlock later steps

### A5. Define async job behavior

Status: database schema prepared in
`supabase/migrations/202606240003_normalized_workflow.sql`. UI/job adapters
(`moons.jobs`) are still not wired — hooks, artwork, and QA all run as plain
synchronous request/response calls with a loading spinner, not durable jobs
with progress/retry state. The selected-hook artwork flow itself is fully
implemented against `docs/FEATURE_ARTWORK_GENERATION.md`, just not backed by
`moons.jobs`. Add Client ingestion has a backend harness contract in
`docs/FEATURE_CLIENT_INGESTION.md`. Read `docs/DATABASE_CONTRACT.md` before
continuing.

Deliver:

- Job database model for hooks, artwork, QA, and export
- Statuses: queued, processing, completed, failed, cancelled
- Progress and error fields
- UI states such as "Generating hooks..." and "Checking quality..." — spinner
  states exist today (`.spinner` in `src/styles/app.css`) but are driven by a
  synchronous fetch's pending state, not a job status poll
- Retry contract with idempotency key

No n8n implementation is required in this milestone.

Verify:

- UI can render every job state from fixtures
- Repeated completion events do not duplicate outputs
- Failed jobs can retry without corrupting the run

### A6. Implement revision rules

Deliver:

- Revision count per output
- Rounds 1 and 2 marked in scope
- Round 3 and above marked out of scope / extra bill
- Revision events stored as immutable history
- Reviewer, source, comment, and timestamp fields

Verify:

- Counts are calculated from events, not manually edited totals
- Two outputs can have different revision counts
- Re-uploading an image does not reset revision history

### A7. Implement replace-image behavior locally

Deliver:

- Select replacement file
- Validate file type and size
- Preview before applying
- Replace the active artwork reference
- Keep the previous asset in history
- Mark the output as requiring QA again

Remote file upload waits for storage configuration.

Verify:

- Replacement affects only the selected output
- Previous asset metadata remains recoverable
- QA status is invalidated after replacement

### A8. Define pitching behavior

Deliver:

- Pitching runs remain temporary by default
- Explicit Save action requires a name
- Saved title follows `Pitching - [SaveName]`
- Add `expiresAt` and retention state
- Define the 30-day cleanup contract

Actual scheduled deletion waits for production persistence.

Verify:

- Unsaved pitching is clearly marked temporary
- Saving without a name is rejected
- Expiry date calculation is tested
- Normal client runs never receive pitching retention rules

### A9. Build export contracts

Deliver now:

- Stable export data model
- CSV generation and download
- Tests for commas, quotes, newlines, Unicode, and Thai text

Prepare but do not finalize:

- PPTX service interface
- Slide layout contract
- Image and caption placement rules

PPTX compatibility testing should happen after production output assets and
formats are stable.

Verify:

- CSV opens with correct columns and row counts
- Export is scoped to one run
- Export does not mix archived or parallel run data

### A10. Add regression coverage

Deliver:

- Reducer and domain unit tests
- Full workflow browser test
- Parallel-run browser test
- Refresh/restore browser test
- Desktop and mobile screenshot baselines
- Accessibility checks for focus, labels, and disabled states

Verify:

- CI runs typecheck, unit tests, browser tests, and build
- A deliberate visual change causes screenshot failure
- Original HTML remains available as the v1 reference

## Track B: Wait for required inputs

Do not implement these as production features until the listed input is
available.

### B1. Production Supabase data

Status: first production backbone prepared on 2026-06-24. Migration, RLS,
Convert Cake auth gate, Supabase brand adapter, and Supabase workspace snapshot
adapter are in place. Applying the migration, seeding client data, and running
against a real project still require production credentials and source data.

Required first:

- Supabase project and environment credentials
- Source and ownership of “all clients”
- Organization and user access rules
- Final data retention decision
- Storage limits and allowed file formats

Then implement:

- Auth restricted to Convert Cake — prepared, pending real project verification
- RLS policies — prepared, pending real project verification
- Clients, brand library, learning, runs, outputs, and activity log — prepared
- Quotas, archive, jobs, and storage buckets
- Production persistence adapters — workspace and brand adapters prepared
- Generated database TypeScript types
- Automated pitching cleanup

### B2. Hook generation and ranking

Status: first backend harness contract prepared on 2026-07-09 in
`docs/FEATURE_HOOK_GENERATION.md`. n8n mode remains the default. Harness mode
can be enabled with `VITE_HOOK_GENERATION_MODE=harness`; it performs a
synchronous research step and generation/ranking step through
`/api/hook-generation-harness`. Caption generation is grounded in the
brand's real historical posts (`fetchPastPostExamples()` reading
`brand_social_posts`/`brand_ad_library_items`), not just the brand voice
summary — see `docs/FEATURE_HOOK_GENERATION.md`.

Required next:

- Creative Compass repository or callable service
- Exact model/provider
- Example accepted outputs
- Citation/source format
- API key storage location

Then implement / complete:

- Async `moons.jobs` persistence for hook progress
- Rewrite one hook
- Regenerate all hooks through the selected provider
- Persist generated hooks to `moons.creative_directions`
- Show source citations in UI
- Real “Let Moons pick” ranking

### B3. Artwork, caption, and QA

Status: built without Creative Compass — `gpt-image-2` direct (text-to-image
and reference-image edit), caption generation grounded in real historical
posts, and an AI vision quality-check agent are all live. See
`docs/FEATURE_ARTWORK_GENERATION.md` and `docs/FEATURE_HOOK_GENERATION.md`.
What's still open below is now about the *auto-fix* policy specifically, not
QA existing at all.

Required first:

- Auto-fix policy and maximum attempts (today: quality-check only flags and
  reports a reason; there is no bounded automatic re-generation attempt —
  a human clicks "Regenerate" manually)
- Provider limits, cost limits, and timeouts (today: `quality: "medium"`,
  `maxDuration: 120`/`90` were picked empirically, not from a stated budget)

Then implement:

- Pass / Moons fixed it / Needs revise as a stored three-way status (today:
  binary pass/fail from the QA agent, stored as `status: "ready" |
  "needs-revision"` on the output, not the `moons.qa_results` enum)
- One bounded automatic fix attempt
- Persist QA results to `moons.qa_results` instead of only the workspace
  snapshot

### B4. Internal QC review

Status: built without Slack — GD/CS/PM approval happens in-app
(`docs/FEATURE_INTERNAL_QC.md`), not via Slack notification/callback. The
original B4 plan assumed Slack as the review surface; that assumption no
longer holds, so this track is Slack-notification-on-top-of-the-existing-flow,
not the review mechanism itself.

Required first:

- Slack app
- Bot token and signing secret
- Channel ID
- Reviewer identity mapping
- Public callback endpoint
- Decision on whether Slack drives approval or just notifies about the
  in-app gate that already exists

Then implement:

- Notify GD when a run reaches Internal QC
- Optional: approve/reject from Slack, verified by Slack signature, mirrored
  into the same `review-output` action the in-app buttons use
- Persist every action in the audit log
- Link to download and replace artwork

### B5. Client review link

Required first:

- Decision whether client login is required
- Link expiry and revocation policy
- Comment visibility policy
- Client identity requirements

Then implement:

- Run-scoped signed link
- Approve, reject, and comment
- Revision request
- Expiry and revoke
- No access to other clients or runs

### B6. PPTX production export

Required first:

- Final output formats
- Production artwork storage
- Required slide template
- Thai and English font requirements

Then implement and test with:

- Microsoft PowerPoint
- Google Slides
- Square, portrait, and landscape artwork
- Thai text and long captions
- Replaced artwork

## Track C: Defer until the core loop is proven

- n8n orchestration
- Batch briefs
- Scheduled runs
- Push to Meta
- Push to TikTok

n8n should be introduced only if real jobs require durable multi-step retries,
fan-out, provider coordination, or operational monitoring beyond the existing
job service.

## Recommended execution order

```text
A1 Product contract
  -> A2 Multi-run domain
  -> A3 Persistence contract
  -> A4 Workflow guards
  -> A5 Async job states
  -> A6 Revision rules
  -> A7 Replace image
  -> A8 Pitching rules
  -> A9 CSV export contract
  -> A10 Regression coverage
```

Track B begins only when its specific required inputs are available. It does
not block Track A.

## Definition of ready for production integrations

Before connecting Supabase, AI, Slack, or client links:

- Run state is isolated by run ID
- Persistence ports are stable
- Job events are idempotent
- Navigation guards are centralized
- Revision rules are tested
- UI has loading, failure, retry, and completed states
- Browser tests protect the prototype flow

This prevents external integrations from defining or corrupting the product
model.
