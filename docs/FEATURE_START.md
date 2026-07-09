# Start feature contract

## Purpose

Start is the production entrypoint for a creative run.

It must answer one question only:

```text
Which client/brand has enough Moons memory to start work?
```

## Data sources

The visible client picker merges two sources:

1. Google Sheet mapping list
2. System clients from `BrandRepository`

In Supabase mode, system clients come from:

- `moons.clients`
- `moons.brand_library`
- `moons.brand_learning`

The Google Sheet source is handled by:

```text
src/repositories/mapping-clients/google-sheet-mapping-client-repository.ts
```

The merge rule is handled by:

```text
src/services/clients/merge-mapping-clients.ts
```

## Selection rules

- Client exists in system/database: selectable
- Client exists only in Google Sheet: visible, grey, disabled
- New client with ingestion status `draft`, `queued`, in-progress, or `failed`:
  visible, grey, disabled
- Existing manual clients with `not_started` remain selectable for backward
  compatibility
- Disabled clients must not be selectable through UI or reducer actions
- Search must include client name, category, mapping status, and service status
- Sorting puts selectable database clients first, then sheet-only disabled
  clients. Each group is sorted by client name with Thai locale support.

State-level guard:

```text
workflowActionBlockReason(..., { type: "select-brand" })
```

This prevents a non-system client from being selected even if a UI path
accidentally dispatches the action.

## UI behavior

Dropdown rows:

- selectable clients use normal row styling
- sheet-only clients use `.client-row.disabled`
- disabled rows show “No Moons data yet”
- ingestion rows show current ingestion status such as “Ingestion queued” or
  “Analyzing visuals”
- mapping/service statuses are shown inline when available

Operators can add a new client from Start by entering client name and required
Facebook URL. This creates a draft client and queued ingestion job; the client
remains disabled until the backend harness prepares Brand Memory.

Overview rows follow the same selectability rule and use `.brief-row.disabled`
when a sheet-only client appears there.

## Current limitation

The Google Sheet CSV is fetched from the browser. If the published CSV ever
blocks browser fetches, add a small server/proxy adapter instead of moving sheet
logic into UI components.

## Verification

Relevant tests:

- CSV parser handles quoted fields
- merge keeps system clients selectable
- merge adds sheet-only clients as disabled
- reducer blocks selecting a sheet-only client

Run:

```bash
npm run check
```
