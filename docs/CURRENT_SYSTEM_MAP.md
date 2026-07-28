# Current system map

Last verified: 2026-07-27

This is the short routing document for Moons. Read this before opening the
large workflow implementation. It identifies the current source of truth,
stage ownership, important state transitions, and the files affected by the
current UX request.

## Product flow

```text
Overview
  -> Signal / brand selection
  -> Brief
  -> Hook / directions
  -> Create / studio
  -> Internal QC
  -> Client review
  -> Learn / delivery summary
```

The stage IDs are defined in `src/features/workflow/config.ts`:

| Order | Stage ID | UI name | Current component |
| --- | --- | --- | --- |
| 1 | `start` | Signal | `StartStage` |
| 2 | `brief` | Brief | `stages/brief-stage.tsx` |
| 3 | `directions` | Hook | `DirectionsStage` |
| 4 | `studio` | Create | `stages/studio-stage.tsx` |
| 5 | `approval` | Internal QC | `stages/approval-stage.tsx` |
| 6 | `client` | Client | `ClientStage` |
| 7 | `summary` | Learn | `SummaryStage` |

`src/app/App.tsx` chooses the visible stage and supplies a run-bound dispatch.
Async results must continue targeting the run that started the request.

## Behavioral source of truth

| Concern | File |
| --- | --- |
| Workflow and workspace types | `src/features/workflow/model.ts` |
| State transitions | `src/features/workflow/reducer.ts` |
| Stage gates and action blockers | `src/features/workflow/rules.ts` |
| Workspace/run persistence transitions | `src/features/workflow/workspace-reducer.ts` |
| Hook generation | `src/features/workflow/use-generate-hooks.ts` |
| Artwork generation | `src/features/workflow/use-create-selected-hooks.ts` |
| Quality check request | `src/features/workflow/use-run-quality-check.ts` |
| Stage configuration and labels | `src/features/workflow/config.ts` |
| Main application composition | `src/app/App.tsx` |

Do not infer workflow behavior from the HTML prototype. The prototype is a
visual reference and contains mock behavior.

## Current UI ownership

The legacy barrel remains `src/features/workflow/stages.tsx`, so existing
imports stay stable. Ownership after the first extraction is:

| Area | Main declarations |
| --- | --- |
| Brand selection and setup | `StartStage`, brand setup/profile/library panels |
| Brief and shared material browser | `stages/brief-stage.tsx` |
| Pre-generation confirmation | `stages/brief-confirmation-modal.tsx` |
| Hook selection | `DirectionsStage`, hook edit/regenerate modals |
| Create | `stages/studio-stage.tsx` |
| Shared output workspace | `review/output-grid.tsx` |
| Shared grouping and display order | `review/output-groups.ts` |
| Shared creative previews | `review/creative-previews.tsx` |
| Shared copy editing | `review/creative-copy-edit-modal.tsx` |
| Shared downloads | `review/downloads.ts` |
| Internal QC | `stages/qc-proof-board.tsx` via `stages/approval-stage.tsx` |
| Client review | `ClientStage`, client revision and preview UI |
| Learn | `SummaryStage`, `LearningSuggestionsPanel` |
| Overview | `Overview`, workboard helpers |

`StartStage`, `DirectionsStage`, `ClientStage`, `SummaryStage`, and `Overview`
still live in the monolith. Structural moves preserve exports so
`src/app/App.tsx` and existing tests remain stable.

## Shared creative review model

Single, album, and UGC outputs share review helpers:

- `isUgcOutput`
- `isAlbumOutput`
- `groupOutputsForReview`
- `reviewCreativeGroups`
- `reviewCreativeCount`
- `AlbumPanelPreview`
- `UgcTemplatePreview`
- `CreativePreviewModal`

These are used by Create, Internal QC, Client review, and Learn. They now live
under `src/features/workflow/review/` and must not be duplicated per stage.

## Artwork prompt pipeline

Artwork requests are built in
`src/services/artwork-generation/openai-image-generation.ts` and executed by
`src/server/artwork-generation/artwork-generation-endpoint.ts`.

- `design-system` compiles `agent_prompt/agent_design_system.md` and sends the
  rendered master prompt directly to GPT Image 2.
- `design-system-new` keeps the same strategy, creative-concept, campaign
  compilation, assets, and image settings. It then runs the compiled master
  prompt through the selected OpenAI/OpenRouter model using
  `agent_prompt/agent_production_brief.md`. Only the returned structured
  production brief is sent to GPT Image 2.
- The shared prompt-agent implementation and production-brief validation live
  in `src/server/artwork-generation/image-prompt-agent.ts`.
- Production-brief debug traces use the `-production-brief-agent.json` suffix;
  the final GPT Image 2 request remains the unsuffixed generation JSON.

## Current UX request routing

| Requirement | Primary UI area | Behavioral files to verify |
| --- | --- | --- |
| Add Confirm Brief and reference attachment opportunity | `BriefStage` | `model.ts`, `reducer.ts`, `rules.ts` |
| Album selection must include format | Selected Album card in `DirectionsStage`, `stages/album-format-modal.tsx` | `domain/creative-run.ts`, `model.ts`, `reducer.ts` |
| Type order: Single, Album, UGC | Brief mix selector and summaries | `config.ts`, `model.ts` |
| UGC mockup must follow the supplied reference | `UgcTemplatePreview` | Output grouping helpers |
| Internal QC progress must follow the supplied reference | `stages/qc-proof-board.tsx`, proof cards | `rules.ts`, approval reducer cases |
| Comments must remain clickable and unobstructed | QC social-review modal and `internal-qc.css` | approval tests |
| Next-step button logic must match the agreed flow | Stage action buttons | `rules.ts`, `reducer.ts` |
| Remove manual “Check QC” button | `StudioStage` | quality-check trigger and reducer behavior |
| Backend/internal team checks QC before final user output | generation/QA service boundary and approval flow | `use-run-quality-check.ts`, quality-check services, backend/API |

The last requirement is not only visual. It changes when QC is triggered and
who owns the gate, so it must be designed against the current backend contract
before removing the manual UI action.

## CSS ownership

CSS currently loads in this order:

1. `src/styles/app.css`
2. `src/styles/compass-redesign.css`
3. `src/styles/workflow/brief-confirmation.css`
4. `src/styles/workflow/hook-album-format.css`
5. `src/styles/workflow/create-build.css`
6. `src/styles/workflow/ugc-preview.css`
7. `src/styles/workflow/internal-qc.css`

`compass-redesign.css` contains several generations of overrides and is not a
clean component boundary. Before changing a rule:

1. Search for every occurrence of the class.
2. Inspect the final occurrence and media-query context.
3. Verify the affected stage in tests or the browser.

New extracted styles should live under `src/styles/workflow/` and be imported
in an explicit order from `src/main.tsx`. Do not reorder legacy CSS during a
component extraction.

## Test routing

| Scope | Test |
| --- | --- |
| Broad workflow redesign/UI behavior | `src/features/workflow/stages-redesign.test.tsx` |
| Artwork mode and direction behavior | `src/features/workflow/stages-artwork-mode.test.tsx` |
| Reducer transitions | `src/features/workflow/reducer.test.ts` |
| Rules and stage gates | `src/features/workflow/rules.test.ts` |
| Workboard/overview | `src/features/workflow/workboard.test.tsx` |
| Workspace transitions | `src/features/workflow/workspace-reducer.test.ts` |

Run the narrowest relevant test after each extraction. Run the complete suite
after the stage boundary is stable.

The Drive folder's Open action now has an explicit accessible name such as
`2026 Open folder`; tests must query the action rather than matching any
button containing the folder name.

## Safe refactor sequence

1. ~~Extract shared stage primitives such as `StageProps`, `DecisionCard`, and
   `Spinner`.~~ Completed.
2. ~~Extract the shared creative review model and previews used by Create,
   Internal QC, Client, and Learn.~~ Completed.
3. ~~Move `StudioStage`, `ApprovalStage`, and their stage-only children.~~
   Completed.
4. ~~Move `BriefStage` and its current materials/library dependencies as the
   first Brief boundary.~~ Completed. Split the 2,500-line Brief module further
   before adding more brand-library behavior.
5. Split matching tests by stage without changing assertions.
6. Move matching CSS rules after component ownership is clear.
7. ~~Only then implement new UX behavior.~~ Confirm Brief, native UGC,
   automatic quality preflight, per-hook Album format selection, and the v51
   proof-card Internal QC board are implemented.

Keep mechanical moves and requirement changes in separate verification steps.

## File-size snapshot

Recorded before extraction:

| File | Lines |
| --- | ---: |
| `src/features/workflow/stages.tsx` | 11,154 |
| `src/styles/compass-redesign.css` | 9,526 |
| `src/features/workflow/reducer.ts` | 1,165 |
| `src/features/workflow/stages-redesign.test.tsx` | 3,310 |
| `neo-creative-compass-v51.html` | 5,229 |

The issue is concentration, not total project size. A codebase may reasonably
contain tens of thousands of lines; a stage file containing unrelated product
areas at this scale is the maintenance and context-cost problem.

After the first extraction:

| File | Lines |
| --- | ---: |
| `src/features/workflow/stages.tsx` | 6,172 |
| `src/features/workflow/stages/brief-stage.tsx` | 2,508 |
| `src/features/workflow/stages/approval-stage.tsx` | 1 |
| `src/features/workflow/stages/qc-proof-board.tsx` | 755 |
| `src/features/workflow/stages/studio-stage.tsx` | 215 |
| `src/features/workflow/review/output-grid.tsx` | 662 |
| `src/features/workflow/review/creative-previews.tsx` | 177 |
| `src/features/workflow/review/output-groups.ts` | 125 |
