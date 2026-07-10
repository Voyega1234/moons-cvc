# Brand learning suggestions contract

## Purpose

Brand Memory's "What's working" / "What to avoid" (`moons.brand_learning`)
already fed into hook generation (`docs/FEATURE_HOOK_GENERATION.md`), but
nothing wrote back to it from what actually happened in a run — it was
purely populated during client ingestion. This closes that loop: **agent
proposes, human approves.**

Design decision (confirmed with the user 2026-07-09): suggestions are
proposed by an AI reviewing one completed run's real approval signal, and a
person must explicitly approve each one before it's written to brand memory.
No fully-automatic write path exists — the point is filtering noisy/wrong
inferences before they pollute a brand's memory, not just automation.

## Scope

Operates on the **current run only**, triggered manually from the Summary
("Delivered") stage — not a background job, not cross-run, not cross-user.
This sidesteps the workspace isolation problem (see `docs/DATABASE_CONTRACT.md`
on `moons.workspaces`): the agent only ever needs the current login's own
completed run, never another user's data.

## Backend

`POST /api/suggest-brand-learning` →
`src/server/brand-learning/suggest-learning-endpoint.ts`. Same shape as the
hook harness: Convert Cake auth check, OpenAI Responses API call with a
strict JSON schema, no persistence — the endpoint only proposes, it never
writes to the database itself.

Request: brand info, brief, and one entry per creative in the run —
hook/concept/visual/cta/caption plus its real GD/CS/PM decisions and client
status. Response: 0–6 `{ polarity: "working" | "avoid", note: string }`
suggestions.

The prompt explicitly instructs the model to ground every suggestion in the
provided approval signal and return an empty list rather than inventing a
pattern when there isn't enough evidence (e.g. everything still pending, or
everything approved with no distinguishing signal).

## Frontend

`LearningSuggestionsPanel` in `src/features/workflow/stages.tsx` (Summary
stage). "Suggest learning" calls
`src/services/brand-learning/suggest-brand-learning.ts`, renders each
suggestion as a card (green border for `working`, red for `avoid`) with
Approve/Reject. Approve calls
`BrandMemoryRepository.createLearningEntry({ clientId, polarity, note,
sourceRunId })`, which inserts into `moons.brand_learning` with
`source_run_id` set to the run it came from. Reject just discards the
suggestion locally — nothing is written.

## Backend write access

`moons.brand_learning` only ever had a `select` grant. Insert access
(`authenticated`, gated by `moons.is_convert_cake_user()`) was added by
`supabase/migrations/202607091014_brand_learning_writes.sql` specifically
for this feature. No update/delete grant — approved suggestions are
append-only; there's no edit/retract path yet.

## Files

- `src/server/brand-learning/suggest-learning-endpoint.ts`
- `api/suggest-brand-learning.ts`
- `src/services/brand-learning/suggest-brand-learning.ts`
- `src/ports/brand-memory-repository.ts` — `createLearningEntry`
- `src/repositories/brand-memory/supabase-brand-memory-repository.ts` /
  `mock-brand-memory-repository.ts`
- `src/features/workflow/stages.tsx` — `LearningSuggestionsPanel`
- `supabase/migrations/202607091014_brand_learning_writes.sql`
