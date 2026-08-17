# Current system map

Last verified: 2026-08-17

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
| Workspace persistence UI and cloud reload | `src/app/providers/workspace-provider.tsx`, `src/app/App.tsx` |
| Cloud-first workspace routing | `src/repositories/workspace/cloud-first-workspace-repository.ts` |
| Shared run loading and optimistic saves | `src/repositories/workspace/supabase-collaborative-workspace-repository.ts` |
| Hook generation | `src/features/workflow/use-generate-hooks.ts` |
| Hook Agent playground | `src/features/playground/hook-agent-playground.tsx`, `/playground` |
| Local Hook generation debug logs | `src/server/hook-generation/hook-generation-debug-log.ts` |
| Client ingestion and recovery | `src/server/client-ingestion/client-ingestion-harness.ts`, `openai-brand-discovery-search.ts`, `openai-brand-visual-analyzer.ts` |
| Google Sheet questionnaire extraction | `src/server/google-sheets/mapping-client-sheet.ts`, `questionnaire-extraction-qc-agent.ts` |
| AI token/image usage ledger | `src/server/shared/ai-usage-recorder.ts`, `moons.ai_usage_events` |
| Artwork generation | `src/features/workflow/use-create-selected-hooks.ts` |
| GPT Luna idea preflight | `stages/preflight-modal.tsx`, `services/quality-check/run-idea-preflight.ts`, `server/quality-check/idea-preflight-endpoint.ts` |
| Quality check request | `src/features/workflow/use-run-quality-check.ts` |
| Stage configuration and labels | `src/features/workflow/config.ts` |
| Main application composition | `src/app/App.tsx` |
| Personal work queue | `src/features/workflow/my-work.tsx` |
| Client PPTX / Google Slides export | `src/features/workflow/export-client-slides-pptx.ts` |

Hook generation uses `agent_prompt/agent_hook.md` as the single creative-policy
source of truth. The runtime endpoint adds only changing campaign evidence,
Research availability, quotas, format contracts, and JSON transport; it must
not restate Creative, Brand Voice, Research, Copy, Product Truth, or scoring
policy. Subheadline emphasis is a separate micro-agent owned by
`agent_prompt/agent_hook_highlight.md`. Generated headlines must communicate
their central message independently. `subheadline` remains a required string in
the provider's Structured Output shape but may be `""` when no supporting line
adds distinct value; empty subheadlines skip the emphasis pass and stay hidden
in review UI. Missing `subheadline` fields in legacy saved runs still fall back
to the stored concept.

Each run stores an explicit Idea intent: explore new angles, develop an
assigned topic, iterate from supplied performance learnings, or build a
multi-product portfolio. The Brief confirmation modal owns the selector and
the selected intent is added to Hook generation instructions. Saved runs
without the field migrate to `explore`. Targeted Idea improvement has two
modes: copy polish preserves the strategic concept, while concept replacement
may change the tension, angle, product role, or creative mechanism but keeps
the content type, verified product truth, campaign constraints, and commercial
objective.

`/playground` is the internal Hook Agent workbench. It reads the current
`agent_hook.md` through the authenticated `/api/hook-agent-prompt` endpoint,
allows a temporary prompt override, previews the exact request payload, and
runs one to five direct Hook models concurrently. Users can add validated
OpenRouter `provider/model` IDs from the Playground; n8n remains hidden there.
Shared Research is enabled by default: it creates one validated Research
dossier and reuses that exact dossier for every model. Users can turn sharing
off to omit the dossier and let each model request run its own Research step.
Completed
experiments are stored locally in the browser with their input, prompt,
Research dossier, results, and per-model errors. The prompt editor also exposes
a line-level diff against the source prompt. Prompt overrides are scoped to the
playground request and never persist or change normal workflow runs.

Hook generation always uses `fresh-research`. Legacy workspaces and requests
that still contain the former hidden `standard` value are migrated at the
workspace and server boundaries because the UI has no no-research selector.
Before creative generation, the dedicated Research Agent at
`agent_prompt/agent_hook_research.md` searches Product Truth, Thai audience
behavior, category/competitor context, provable moments, cultural/platform
signals, and consumer language once per request. It returns a structured
dossier with a compact `summary`, direct-source `references`, evidence-backed
`insights`, and material `gaps`. Each insight compresses Evidence, Tension,
Belief challenged, Human consequence, Why now, and Brand connection into one
content field, while its `referenceIds` must resolve inside the same dossier.
The dossier is shared by every Hook batch, which uses the ordered insights as
its primary strategic starting points and the references as proof.
The Research Agent always uses OpenAI with `web_search_preview` and Thailand
location context and `medium` reasoning effort, even when the Hook Agent is
routed through OpenRouter. The
Hook Agent receives the dossier without a search tool so research and creative
judgment remain separate. Research is discovery-first: at least eight distinct
queries adapt to the brand across fresh domain news/research, current Thai
societal tension, the next 60 days of seasonal moments, recent platform/search
language, and category shifts. B2B, marketing, and technology brands weight
official updates, studies, and benchmarks more heavily; consumer brands weight
seasonal, cultural, and consumer-language signals more heavily. At least six
queries exclude brand and competitor names, while brand/product verification is
capped at two queries and two selected brand-owned references. Product truth is
a factual guardrail rather than the default idea seed. Every current signal must
pass a `Brand truth × Audience tension × Current signal` usefulness gate and
state the specific content leverage it unlocks before Hook generation. New runs
default to comparing `google/gemini-3.6-flash`,
`anthropic/claude-sonnet-5`, and `openai/gpt-5.6-terra` through OpenRouter.
Saved selections using Qwen 3.8 Max or Claude Sonnet 4.6 are migrated to Claude
Sonnet 5.
Users may select one to five Hook models. Direct Hook runs create one Research
dossier first, reuse it for every selected model, and start all selected model
requests concurrently. A failed model no longer discards successful results
from the other models. The client
records the originating model on every direction and groups the review cards
into model columns inside each content type. The Hook picker saves custom
OpenRouter `author/slug` model IDs in a persistent catalog and uses checkboxes
to select up to five models per run. Unselecting a model does not delete it from
the catalog. The picker links to the OpenRouter model catalog. The n8n route is hidden from this picker;
its backend integration remains available for legacy compatibility. Legacy workspaces
without a saved model list retain their single saved model, while Hook API
requests without an explicit model still default to
`google/gemini-3.6-flash`. A targeted rewrite stays on the direction's
originating model. Normal workflow and Playground comparisons both share one
validated dossier across models. A non-JSON 500 from the serverless boundary is
retried only once; ordinary JSON errors and known 504 timeouts are not replayed.
The OpenAI and n8n Hook routes remain user-selectable for compatibility.
The business context sent to Research is intentionally limited to Questionnaire,
Brand name, Brand system, and User brief. The Hook Agent receives that same
context plus the Research dossier and up to six recent Past Posts (prefer four
paid-ad captions and two organic posts) as caption-style evidence only. Past
Posts must not supply ideas, offers, claims, facts, or product details. Brand
Memory, Products, Documents, References, attachment names, and uploaded images
are not included in Hook generation. Runtime quota, format, and JSON transport
instructions are still appended so the workflow contract remains enforceable.
Hook requests intentionally do not send the run's existing Hook history to
either the direct Hook Agent or either n8n route. A targeted regeneration still
includes only the specific original Hook and concept inside its explicit rewrite
instructions so the Agent knows which item it is replacing.
Creative quality, Product Truth, Citation use, and scoring policy belong to
`agent_hook.md`; runtime code does not reject consumer-facing wording through
hidden semantic regexes or self-score thresholds. Runtime validation remains
limited to transport/schema requirements, requested quotas, Album panel counts,
and the explicit Thai first-person prohibition. Search audit metadata is written
to local Hook debug logs. Album `formatBeats` map one-to-one to non-cover panels
(two for three-panel formats and three for four-panel formats). UGC returns four
short storyline beats and a matching four-scene `ugcBrief` in the order Hook,
Development, Proof / Benefit, and CTA. Every scene keeps 1–2 camera-ready
`scriptLines`, its shot direction in `visual`, its on-screen copy in
`textOverlay`, and its timing in `duration`; shot directions must never be
presented as spoken script. Motion may return as many `formatBeats` as its idea
needs. Workspace deserialization migrates the former opening/showcase/closing
UGC fields into this scene structure for saved-run compatibility.

Hook generation also exposes the user-selectable `n8n · Compass New` route.
That selection sends the existing n8n Hook payload through the authenticated
`/api/n8n-compass-new` proxy, owned by
`src/server/hook-generation/n8n-compass-new-endpoint.ts`, which forwards one
POST request to the configured `N8N_COMPASS_NEW_WEBHOOK_URL`. GPT and
OpenRouter selections continue to follow the existing global harness/legacy
n8n environment switch.

Do not infer workflow behavior from the HTML prototype. The prototype is a
visual reference and contains mock behavior.

Direct OpenAI/OpenRouter requests inside Hook generation and Artwork
generation are wrapped by `ai-usage-recorder.ts`. Each provider attempt,
including HTTP failures, retries, and transport failures, creates an
`ai_usage_events` row tied to the authenticated user, client, and workspace run.
The ledger stores token counters, cache/reasoning/search counters, image token
breakdowns, image size/quality/count, provider-reported cost when available,
and the raw provider `usage` object. It never stores prompts, image bytes, or
the generated response. Usage persistence is non-blocking for the creative
workflow: a ledger write failure is logged but does not discard a successful
generation.

Questionnaire imports prefer the read-only `1. Questionnaire` tab and also
accept explicit common naming variants such as `Questionnaire`, `Questionaires`,
and `Questionaies`. If no supported tab exists, onboarding skips Questionnaire
and continues brand analysis with the other available sources. Found tabs use a
deterministic heading/placeholder extraction first, followed by one grounded
GPT Luna QC request. Luna may reassign or omit fields, but every returned value
is rebuilt server-side from verbatim substrings found in the original Sheet
cells. Ungrounded evidence, duplicate keys, or an unavailable QC provider stops
the import instead of persisting unchecked data. An empty reviewed result is
treated as no Questionnaire context so onboarding can continue with the other
sources. The Questionnaire Google Sheet URL is optional; leaving it blank skips
Questionnaire import.

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
| Per-Hook reference image | `stages/hook-reference-image.tsx`, `hook-reference-images.ts` |
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
panel; Static slides keep the balanced three-column proportions. UGC uses one
`SHORT VIDEO STORYLINE` slide: headline, time, concept, storyline, and mood on
the left; the captured 9:16 Create preview in the center; and the four scenes'
actual Script, Visual, and Text Overlay on the right. Do not add separate
Creative Direction or Artwork & Caption slides unless the export contract is
intentionally changed.

Each Hook may store up to two optional `referenceImages`. The Hook card owns
multi-upload and per-image removal UI. The first image is always normalized as
Primary and later images as Supporting; removing the Primary promotes the next
image automatically. Legacy saved `referenceImage` values migrate into this
array. `hook-reference-images.ts` keeps Hooks without their own references on
the normal artwork batch path, but isolates each referenced Hook into its own
request so its images cannot influence another Hook. The same images are
embedded as a thumbnail grid on that Hook's client slide.
Referenced Hook requests set `referenceLed` and take precedence over the saved
Artwork mode. They bypass Campaign Input preflight, strategy/concept prompt
agents, and `agent_image.md`. `reference-interpreter.ts` sends the Primary and
Supporting Hook references together to GPT Terra vision using
`agent_prompt/agent_reference_interpreter.md` and returns structured design
grammar that separates transferable hierarchy/treatment from source-specific
people, products, scenes, props, copy, and exact composition. The Primary
reference controls layout and hierarchy; Supporting references contribute only
compatible secondary ideas, with conflicts resolved in favor of Primary. All
Hook style references are also attached to the final GPT Image 2 edit alongside
official logo, product, and other approved identity assets. Their ordered
Primary/Supporting labels and the interpreter's design grammar tell GPT Image 2
to use them as visual evidence without treating the completed advertisements as
literal edit bases. The final prompt is assembled by
`reference-led-image-prompt.ts` from the extracted grammar, campaign idea,
headline, optional single supporting line, CTA, every attachment label, and
output ratio. Hooks without a per-Hook reference keep the selected Artwork mode
and its existing pipeline.

## Artwork prompt pipeline

Artwork requests are built in
`src/services/artwork-generation/openai-image-generation.ts` and executed by
the thin façade at
`src/server/artwork-generation/artwork-generation-endpoint.ts`.
New runs and legacy workspaces without a saved Artwork mode default to
`standard`; an explicitly saved mode remains unchanged.

The Hook Agent's `visual` / Visual direction field remains available for idea
review, export, and learning, but it is excluded from artwork prompt agents,
reference selection, and the final GPT Image 2 prompt in every artwork mode.

Server-side ownership is split by responsibility:

- `artwork-generation-pipeline.ts` owns request orchestration and the active
  generation flow.
- `artwork-request-parser.ts` validates and normalizes generation and revision
  request bodies.
- `prompt-runtime.ts` loads, compacts, and renders prompt templates;
  `prompt-context.ts` compiles active campaign context and runtime rules.
- `reference-images.ts` resolves, recovers, and normalizes reference assets.
- `album-master.ts` builds Album master instructions and performs deterministic
  format-native panel cropping. Album crops are then checked together by the
  focused prompt at `agent_prompt/agent_album_panel_qc.md`; when visible
  neighbouring-panel leakage is found, the pipeline permits one targeted GPT
  Image 2 edit of the master and splits the repaired master again.
- `artwork-revision.ts` owns revision prompting and image-edit orchestration.
- `artwork-persistence.ts`, `artwork-paths.ts`, and
  `artwork-generation-types.ts` own storage paths, uploads, signed URLs, and
  the storage contract.
- `artwork-debug-log.ts` owns debug-log schemas, filenames, and artifact
  writes.

Keep the endpoint façade stable for API and test imports. Add new behavior to
the smallest owning module above instead of rebuilding the former monolith.

On the current `design-system-flow` branch, the active endpoint still contains
the Album master helpers. Four-grid masters must place both dividers within 2%
of the center lines. A misaligned master receives one targeted GPT Image 2 edit
and is checked again before any master or panel asset is persisted; a second
failure stops Album generation. Slide export places every Album format inside a
square preview so its native panel ratios are not stretched.

- `standard` preflights only the Campaign Input with `gpt-5.6-terra` through
  the OpenAI Responses API using
  `agent_prompt/agent_campaign_input_preflight.md`. Terra organizes product,
  objective, copy, constraints, product truth, and reference roles; it does
  not receive `agent_image.md` and does not write a visual route. The final
  Image API call remains
  `agent_prompt/agent_image.md + Preflighted Campaign Input + selected image attachments → GPT Image 2`.
  `buildStandardImagePrompt()` assembles the final text locally. Album service
  adds only the `ALBUM MASTER GRID` instruction before generating and splitting
  the master artboard.
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
