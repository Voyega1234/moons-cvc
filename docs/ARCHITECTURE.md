# Moons architecture

## Current objective

Preserve the production workflow and backend contracts while migrating the
React application to the approved `neo-creative-compass.html` UX/UI. The HTML
file is a visual reference and is not loaded or executed by the application.

## Product model

Moons is a creative operations workflow with:

1. Brand selection and memory loading
2. Brief and source collection
3. Hook generation and selection
4. Creative generation and quality checks
5. Internal approval
6. Client review and revisions
7. Delivery, downloads, and saved learning

The prototype also includes an overview, parallel creative runs, brand
profiles, quota visibility, historical approved work, and mock export tools.

## Async actions target a run id, not "whichever run is active"

Fixed 2026-07-10. `App.tsx`'s `dispatch` wraps every `WorkflowAction` in a
`WorkspaceAction`. It used to be `{ type: "update-active-run" }`, which
applied the action to `getActiveRun(state)` — whichever run happened to be
active **when the action was dispatched**, not when it was requested. That's
fine for synchronous UI actions (click → dispatch happens in the same tick),
but every async action in this app — hook generation, "Generate more",
artwork generation, quality check, brand-learning suggestions — dispatches
its result later, from a `.then()` callback, after an API round trip. If the
user switched to a different run (or opened a new one) while a request was
in flight, the result landed on whatever run was active when the *response*
arrived, not the run that made the *request*. Depending on whether that
other run satisfied the same action's guard conditions, the result either
silently applied to the wrong run or got dropped by
`workflowActionBlockReason` — which looked, from the run the user actually
started generation on, like "it just stopped."

The fix: `dispatch` is now `{ type: "apply-run-action", runId, action, now }`
(`workspace-reducer.ts`), and the `useCallback` that creates it depends on
`state.id` instead of `[]`. Every stage component's hooks (`useGenerateHooks`,
`useCreateSelectedHooks`, etc.) receive whichever `dispatch` closure was
current when the user clicked the button — and since that closure captured
`state.id` at creation time, the async `.then()` it eventually calls still
targets the original run, regardless of what's active by the time the
request resolves. If the target run was closed in the meantime, the action
is dropped harmlessly (see the `apply-run-action` case in
`workspace-reducer.ts`).

## Architectural rule

Dependencies point inward:

```text
UI -> use cases -> domain <- ports <- adapters
```

- `domain` contains stable business language and no browser code.
- `ports` define what the application needs from external systems.
- adapters will implement HTTP, database, object storage, AI generation,
  authentication, analytics, and background jobs.
- UI modules consume use cases rather than calling APIs directly.

## Shared modules

```text
config/env.ts                 Reads public environment variables once
lib/supabase/client.ts        Creates the browser Supabase singleton
app/dependencies.ts           Chooses mock or production implementations
ports/                        Stable interfaces used by the application
repositories/                 Mock and Supabase data implementations
services/                     Shared business operations
shared/utils/                 Pure reusable functions
shared/hooks/                 Reusable React behavior
shared/constants/             Shared non-business constants
```

Features must not call `createClient`, read `import.meta.env`, or import mock
data directly. Changing providers should happen in `app/dependencies.ts`.

Workspace persistence uses a versioned snapshot. Transient UI state such as
toasts, open menus, and search text is intentionally excluded. Invalid or
unknown snapshots are removed by the development LocalStorage adapter instead
of being loaded partially.

In Supabase mode, the same versioned snapshot is stored in
`moons.workspaces`. This is the first production persistence slice. The
normalized `runs`, `outputs`, and `activity_log` tables exist for subsequent
feature migrations, but the UI still consumes the workspace port rather than
database tables directly.

The database source-of-truth transition plan is documented in
`docs/DATABASE_CONTRACT.md`. Future agents should read it before replacing
snapshot-backed behavior with normalized table adapters.

The Start/client-picker behavior is documented in `docs/FEATURE_START.md`.
Other implemented feature contracts: `docs/FEATURE_HOOK_GENERATION.md`,
`docs/FEATURE_ARTWORK_GENERATION.md`, `docs/FEATURE_INTERNAL_QC.md`,
`docs/FEATURE_BRAND_LEARNING.md`, `docs/FEATURE_BRAND_MEMORY.md`,
`docs/FEATURE_CLIENT_INGESTION.md`.

## Migration sequence

Replace one vertical workflow slice at a time:

1. Extract mock brand data behind `BrandRepository`.
2. Move run state to a typed store and persistence adapter.
3. Replace Start and Brief DOM code with typed UI modules.
4. Add visual regression coverage against the HTML reference.
5. Move generation and QA behind gateway ports.
6. Move approval, client review, and delivery.
7. Replace the remaining mock adapters with production services.

Each slice must preserve:

- visible copy
- CSS class names and tokens
- keyboard behavior
- responsive behavior
- stage gating rules
- mock behavior until its production adapter is ready

## Production integrations

The likely production boundaries are:

- authentication and organization membership
- relational persistence for brands, runs, reviews, and learning
- object storage for documents and creative assets
- background jobs for generation, QA, and export
- signed upload and download URLs
- audit events for approvals and client feedback
- analytics and error reporting

Provider choices are intentionally not hard-coded. They belong in adapters and
can be selected when deployment and operational requirements are known.

## Visual contract

`neo-creative-compass.html` is the visual source of truth as of 2026-07-13.
Its inline JavaScript and fake data are not application contracts. Preserve the
React workflow actions, persistence, accessibility, responsive behavior, and
backend integrations while translating its visual hierarchy into components.

Implementation progress and continuation notes live in
`docs/UX_REDESIGN_HANDOFF.md`.

Implementation milestones and integration prerequisites are maintained in
`docs/ROADMAP.md`.
