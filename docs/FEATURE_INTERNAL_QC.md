# Internal QC contract

## Purpose

Step 5 ("Internal QC") is the human approval gate before a client ever sees
a creative. Each creative needs independent GD (Graphic Design), CS (Client
Service), and PM (Project Manager) sign-off before the run can move to
Client review.

## Data model

`CreativeOutput.approval` (`src/domain/creative-run.ts`):

```ts
interface ApprovalGate {
  graphicDesign: "approved" | "rejected" | null;
  clientService: "approved" | "rejected" | null;
  projectManager: "approved" | "rejected" | null;
}
```

Each creative carries its own `ApprovalGate` — approval is per-creative, not
per-run. `WorkflowState.approved` is derived, not stored input: `true` only
when every output has all three roles `"approved"`
(`computeApproved` in `src/features/workflow/reducer.ts`).

Actions:

- `review-output` — set one role's decision on one creative. A rejection
  sets that output's `status` to `"needs-revision"`; clearing the last
  rejection (approving over it, or a fresh upload) returns it to `"ready"`.
- `replace-output-asset` — used by both the manual "Upload replacement" flow
  here and the "Regenerate image" flow in Create & fix
  (`docs/FEATURE_ARTWORK_GENERATION.md`). Bumps `revisionCount`, resets all
  three roles to `null` (a new image is a new review cycle), sets
  `status: "fixed"`.

**Known gap:** none of this is written to `moons.internal_reviews`. It lives
entirely in the workspace snapshot, isolated per login — see
`docs/DATABASE_CONTRACT.md`'s note on `moons.workspaces`. A GD reviewer
logged in as themselves cannot see a run an Account Manager pushed to this
stage under a different login.

## UI

`ApprovalStage` in `src/features/workflow/stages.tsx`. Each creative is a
carousel slide (`.qc-carousel`, scroll-snap) with numbered dot navigation
(`.qc-dot`), not a grid — the earlier grid layout was replaced because
reviewers need to focus on one creative's full review gate at a time.

Each slide is two columns:

- **Left: a Facebook post mockup** (`.fb-mockup`) — avatar, page name,
  verified badge, timestamp, the real generated caption (not a stub),
  the real generated image (`output.assetUrl` — falls back to a static
  placeholder card if generation hasn't produced a real asset yet), and
  Like/Comment/Share chrome. This exists so reviewers see approximately what
  the client will see, not a bare image.
  - Caption is clamped to 3 lines by default with a real "See more"/"See
    less" toggle (`CAPTION_CLAMP_THRESHOLD = 220` chars in `stages.tsx`).
    Clamping uses `max-height` + a `mask-image` fade-out, not
    `-webkit-line-clamp` — line-clamp was clipping mid-glyph on some Thai
    text (tall diacritics interacting with the WebKit box layout), which
    looked like corrupted text. The mask-fade degrades gracefully
    regardless of the exact cutoff point.
  - "Download" (real per-image link) and "Upload replacement" (real file
    upload to the `creative-assets` bucket, dispatches
    `replace-output-asset`) sit below the mockup.
- **Right: the approval gate** — one row per role (GD/CS/PM) with a
  description of what that role checks, a pending/approved/rejected pill,
  and Approve/Reject buttons.

"Approve all" bulk-approves every *pending* role across every creative
without touching roles someone already explicitly rejected.

## Files

- `src/domain/creative-run.ts` — `ApprovalGate`, `ApprovalRole`,
  `emptyApprovalGate`
- `src/features/workflow/model.ts` — `review-output`, `replace-output-asset`
  actions
- `src/features/workflow/reducer.ts` — `computeApproved`,
  `isOutputFullyApproved`
- `src/features/workflow/stages.tsx` — `ApprovalStage`, `QcSlide`,
  `VerifiedBadge`, `GlobeIcon`
- `src/services/artwork-generation/replace-output-asset.ts` — client-side
  upload straight to Supabase Storage (no backend endpoint needed; the
  `creative-assets` bucket RLS already permits any Convert Cake user)
