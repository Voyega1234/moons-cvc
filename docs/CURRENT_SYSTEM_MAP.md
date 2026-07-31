# Current system map

Last verified: 2026-07-30

This is the short routing document for Moons. Read this before opening the
large workflow implementation. It identifies the current source of truth,
stage ownership, important state transitions, and the files affected by the
current UX request.

## Product flow

```text
My Work / Overview
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
| GPT Luna idea preflight | `stages/preflight-modal.tsx`, `services/quality-check/run-idea-preflight.ts`, `server/quality-check/idea-preflight-endpoint.ts` |
| Quality check request | `src/features/workflow/use-run-quality-check.ts` |
| Stage configuration and labels | `src/features/workflow/config.ts` |
| Main application composition | `src/app/App.tsx` |
| Personal work queue | `src/features/workflow/my-work.tsx` |
| Client PPTX / Google Slides export | `src/features/workflow/export-client-slides-pptx.ts` |

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
| Shared artwork mode selector | `stages/artwork-mode-selector.tsx` |
| Hook selection | `DirectionsStage`, hook edit/regenerate modals |
| Before-build idea checks | `stages/preflight-modal.tsx` |
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
| My Work | `src/features/workflow/my-work.tsx`, live run assignments and queue state |

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

Client presentation export uses one slide per creative. Static and Album
creatives use a three-column review layout: campaign information and CTA on
the left, artwork in the center, and the caption in a dedicated right-hand
panel. Album slides widen the center artwork panel and use a narrower caption
panel; Static slides keep the balanced three-column proportions. UGC uses its
single-slide storyboard layout. Do not add separate Creative Direction or
Artwork & Caption slides unless the export contract is intentionally changed.

## Artwork prompt pipeline

Artwork requests are built in
`src/services/artwork-generation/openai-image-generation.ts` and executed by
`src/server/artwork-generation/artwork-generation-endpoint.ts`.

- `standard` is a direct Image API route:
  `agent_prompt/agent_image.md + Compact Campaign Input → GPT Image 2`.
  `buildStandardImagePrompt()` assembles the two parts locally; Standard does
  not call the Responses API or an OpenRouter/OpenAI prompt-writing model.
  Selected reference images are attached directly to GPT Image 2. Album
  service adds only the `ALBUM MASTER GRID` instruction before generating and
  splitting the master artboard.
- `design-system` uses the V6.2 Judgment final-art prompt at
  `agent_prompt/versions/2026-07-30-design-system-v6.2-judgment/prompts/03-design-system-v6.2-judgment.md`.
  V6.2 removes fixed visual presets and percentage-based composition rules. It
  lets GPT Image 2 select the art direction that best fits the active concept,
  brand, category, audience, objective, format, and information density while
  retaining universal hierarchy, coherence, physical-credibility,
  asset-integrity, and anti-AI-slop gates. V6.1 remains available as the
  immediate rollback version.
- `design-system` runs the complete archived V6 upstream chain:
  `01-strategy-enrichment.exact.md` followed by
  `02-creative-concept-director.exact.md`. Runtime campaign evidence is appended
  to the static prompts, and the concept response uses a strict
  `moons_creative_visual_concept` JSON transport envelope. The resulting
  three-sentence creative provocation is compiled into the V6.2 Judgment prompt
  and sent directly to GPT Image 2. Only the final-art stage changed in V6.2;
  the archived V6 strategy and concept prompts remain active upstream.
- `design-system-new` now reuses the proven archived V6 chain and V6.2 final-art
  prompt instead of the former Campaign Truth Normalizer/current-design-system
  route. At request start the endpoint deterministically locks the confirmed
  run input once. A set-level Creative Director then chooses one shared campaign
  grammar and one distinct shot opportunity per selected idea using
  `agent_prompt/versions/2026-07-30-design-system-new-flow-v1/prompts/00-set-creative-director.md`.
  Each idea then runs archived `01-strategy-enrichment.exact.md`, archived
  `02-creative-concept-director.exact.md`, and V6.2 Judgment before GPT Image 2.
- After each `design-system-new` image is generated, visual-only QC uses
  `04-visual-qc.md` from the same flow version. It evaluates visual density,
  hierarchy, physical credibility, and visible AI artefacts while deliberately
  ignoring factual, spelling, legal, and copy-accuracy review. A `revise`
  decision permits exactly one targeted GPT Image 2 edit; a `pass` decision
  preserves the original image.
- The old `agent_prompt/agent_campaign_truth_normalizer.md`,
  `agent_prompt/agent_creative_concept_director.md`, and
  `agent_prompt/agent_design_system.md` are no longer active in the
  `design-system-new` artwork endpoint. Their standalone modules remain for
  other isolated callers and rollback history.
- `agent_prompt/agent_creative_strategy_enrichment.md`,
  `agent_prompt/agent_creative_graphic_designer.md`, and
  `agent_prompt/agent_creative_concept_director.md` remain available to their
  other/current pipelines; the archived `01` and `02` prompts are selected when
  `artworkMode` is either `design-system` or `design-system-new`.
- `design-system-new` does not call the Production Brief Director. The
  standalone production-brief helper remains in
  `src/server/artwork-generation/image-prompt-agent.ts` for isolated callers
  and tests, but it is not part of the artwork endpoint pipeline.
- `direct-final-artwork` is the shortest route:
  `Hook JSON → GPT Image 2`. It does not call strategy enrichment, campaign
  truth normalization, a creative concept agent, or the image-prompt agent.
  Each selected idea contributes only `Hook`, `subheadline`,
  `Supporting points (one per line)`, and `CTA`. The endpoint combines those
  fields with the complete active brand context, optional Artwork brief, and
  selected artifact roles using
  `agent_prompt/versions/2026-07-30-direct-final-artwork-v1/prompts/01-direct-final-artwork-v1.md`.
- Brand Kit rule changes, including `Colors` / `Primary colors` and
  `Secondary colors`, must dispatch `sync-brand-rules` into the active run.
  Artwork request serialization reads that run-bound state to populate
  `brand.colors`; repository-only changes are not sufficient.

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
4. `src/styles/workflow/brief-stage.css`
5. `src/styles/workflow/hook-album-format.css`
6. `src/styles/workflow/preflight.css`
7. `src/styles/workflow/create-build.css`
8. `src/styles/workflow/ugc-preview.css`
9. `src/styles/workflow/internal-qc.css`
10. `src/styles/workflow/client-review.css`
11. `src/styles/workflow/learn-summary.css`
12. `src/styles/workflow/my-work.css`

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
