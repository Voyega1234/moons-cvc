# Moons architecture

## Current objective

Preserve the approved HTML prototype while implementing the product in React
and strict TypeScript. The HTML file is a visual reference and is not loaded or
executed by the application.

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

`moons-prototype-22-jun-26.html` is the visual source of truth. Do not restyle,
rename, or remove its selectors during migration unless the design itself has
been explicitly changed.

Implementation milestones and integration prerequisites are maintained in
`docs/ROADMAP.md`.
