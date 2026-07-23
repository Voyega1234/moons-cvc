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

Operators can add a new client from Start by entering a client name, Facebook
URL, and a normal Google Sheet URL for the required onboarding questionnaire.
Compass reads the public `1. Questionnaire` tab on demand without Google
credentials. Mapping clients prefill the URL from Client Portal when available, but
the operator can replace it before import. The questionnaire is historical
onboarding context and is not treated as the current campaign brief. This
creates a draft client and queued ingestion job; the client remains disabled
until the backend harness prepares Brand Memory.

The intake form includes a Google Sheet extraction section. Supported mapping
fields are Client ID, Status, Service Status, and Client Portal URL. For a
sheet-backed client, the section shows the values that were extracted from its
mapping row. Questionnaire content is imported from the Google Sheet URL in the
setup form when the operator submits it.

Overview rows follow the same selectability rule and use `.brief-row.disabled`
when a sheet-only client appears there.

## Google Sheet access

The browser calls `/api/mapping-clients`; it never fetches Google directly.
Questionnaire reads use the public Google Visualization response for the exact
`1. Questionnaire` tab and therefore require the Sheet to be shared as
`Anyone with the link`. The endpoint remains protected by Compass
authentication. The configured source must be a normal Google Sheet URL, not a
Publish to web URL.

The separate mapping-client list reader still uses keyless Google authentication:
Production and Preview use Vercel OIDC through Workload Identity Federation,
while local development uses Application Default Credentials.

## Verification

Relevant tests:

- normal Google Sheet URL and selected `gid` parsing
- OIDC/ADC authentication selection and key-file rejection
- Sheets API mapping and extraction summary
- anonymous read-only extraction from the public Client Portal
  `1. Questionnaire` tab without creating a Google access token
- merge keeps system clients selectable
- merge adds sheet-only clients as disabled
- reducer blocks selecting a sheet-only client

Run:

```bash
npm run check
```
