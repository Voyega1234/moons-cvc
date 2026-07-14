# Neo UX/UI redesign handoff

Last updated: 2026-07-13 (Asia/Bangkok)

## Objective

Redesign the Neo React application using the visual language and UX hierarchy
from `neo-creative-compass.html`, while preserving the existing backend,
repositories, API payloads, workflow reducers, persistence format, and async run
targeting.

## Design read

This is a redesign-overhaul of an internal creative operations product. The
target language is clean creative-tech: a persistent navigation rail, a clear
seven-step workflow, cool white surfaces, blue primary actions, restrained
lime/orange semantic accents, soft borders, and medium information density.

- `DESIGN_VARIANCE: 5`
- `MOTION_INTENSITY: 3`
- `VISUAL_DENSITY: 6`

## Non-negotiable safeguards

- Keep internal stage IDs unchanged: `start`, `brief`, `directions`, `studio`,
  `approval`, `client`, and `summary`.
- Keep all `WorkflowAction` and `WorkspaceAction` behavior unchanged unless a
  separately documented UI-only action is required.
- Do not change Supabase, API endpoints, generation services, repositories,
  environment variables, or persistence schemas for this redesign.
- Do not copy the prototype's inline JavaScript or fake metrics into React.
- Do not reset, stash, or overwrite pre-existing uncommitted work.
- Preserve the in-progress artwork-mode feature in `DirectionsStage`.

## Stage label mapping

| Internal stage ID | Previous label | New UI label |
| --- | --- | --- |
| `start` | Start | Signal |
| `brief` | Brief | Brief |
| `directions` | Hook | Angles |
| `studio` | Create | Build |
| `approval` | Internal QC | Internal QC |
| `client` | Client review | Client |
| `summary` | Delivered | Learn |

## Baseline before redesign

- `npm run typecheck`: passed.
- `npm test`: passed, 36 test files and 132 tests.
- Worktree was already dirty before redesign work began.
- Important overlapping user changes exist in:
  - `src/features/workflow/model.ts`
  - `src/features/workflow/reducer.ts`
  - `src/features/workflow/stages.tsx`
  - `src/styles/app.css`

## Implementation strategy

1. Add a scoped application shell and navigation rail.
2. Keep current providers and dispatch closures wired exactly as they are.
3. Add a separate redesign stylesheet loaded after `app.css`.
4. Relabel the seven visible stages while keeping internal IDs stable.
5. Map Workboard to the existing Overview and map secondary rail actions only
   to existing, real application surfaces.
6. Add focused UI contract tests.
7. Run the full verification gate before removing any legacy CSS.

## Progress log

### Completed

- Production ingestion recovery on 2026-07-13: the original unclaimed
  SleepHappy job `95443167-abe1-43db-a216-a561a4b9ac56` was preserved as a
  `failed` / `manual_retry_reset` audit record. Fresh job
  `45fe8ab4-f825-4a3b-93f9-68e11446f012` was queued and run successfully,
  saving 30 posts, 60 ads, and 27 mirrored visual assets. Brand Memory was
  written and the client finished as `needs_review` because source ads contain
  conflicting product dimensions, starting prices, promotion terms, and
  health-related claims. The missing automatic worker trigger remains a
  separate production issue; future queued jobs still require a scheduler or
  secure immediate worker trigger.
- Audited `neo-creative-compass.html`, the React application shell, workflow
  model/reducers, stage components, persistence architecture, and test suite.
- Confirmed the backend can remain unchanged because the reference and current
  product share the same seven-stage conceptual workflow.
- Captured the pre-redesign typecheck and test baseline.
- Created this handoff document.
- Added `@phosphor-icons/react` as the single frontend icon family.
- Added the persistent Neo navigation rail, seven-step workflow header,
  responsive welcome hero, live run controls, and Workboard shell.
- Kept Workboard connected to the existing `overview` workspace view.
- Kept Library connected to the existing Signal/brand-memory surface.
- Kept Learnings guarded by the existing workflow stage rules.
- Added scoped visual tokens and responsive overrides in a separate stylesheet.
- Updated all visible workflow labels while preserving the internal stage IDs.
- An earlier terminology pass changed `Angles` to `Hook` and `Build` to
  `Create`; later stakeholder feedback superseded it. The current visible
  labels are `Angles` and `Build`, while internal IDs remain unchanged.
- Updated application reference metadata and the prototype verification script
  to use `neo-creative-compass.html`.
- Added navigation contract tests covering stage IDs/labels and rail actions.
- Verified the rendered app at desktop and 390px mobile width. No horizontal
  overflow or browser console errors were found.
- Verified the populated Brief stage separately. The first pass exposed an
  invisible file input extending the document width; the scoped stylesheet now
  constrains that input to 1px. Desktop and 390px mobile were rechecked with
  `scrollWidth === clientWidth`.
- Post-shell `npm run typecheck`: passed.
- Targeted navigation tests: passed, 2 tests.
- Final `npm run check`: passed.
  - TypeScript: passed.
  - Full Vitest suite: passed, 37 files and 134 tests.
  - New prototype reference verification: passed.
  - Production Vite build: passed and emitted `dist/index.html` plus bundled
    JavaScript and CSS assets.

### Stakeholder feedback implemented (2026-07-13)

- Restored a bounded Brief reference picker. The library is a single-open
  accordion instead of an endlessly expanding list: the outer library is
  capped at `430px`, each open category is capped at `290px`, and overflow
  scrolls inside the panel.
- Restored an explicit **Edit** action on every Hook card. Editing replaces the
  hook's copy in place, keeps the original direction ID and selection state,
  and invalidates previously generated downstream output so stale artwork
  cannot survive a changed hook.
- Added an explicit **Regenerate** action on every Hook card. The reviewer
  supplies a new writing tone; the generation request includes the original
  hook and concept and instructs the existing generation backend to preserve
  the strategic idea, audience, product truth, and CTA while rewriting the
  tone. The replacement keeps the original direction ID and selection state.
- Kept the separate **Generate more** control and its append-only behavior.
- Added **Regenerate all** beside the Hook shortlist tools. One tone applies to
  every currently displayed Hook, including Hooks previously appended by
  Generate more. Large sets regenerate in batches of six; the final atomic
  replacement preserves every Hook ID and selection state and invalidates stale
  downstream artwork/QC.
- Removed the standalone **Save comment** flow. Internal approval now sends the
  decision and role comment together in one `review-output` action.
- Reject is guarded in both the UI and workflow rules: a whitespace-only or
  missing comment cannot be submitted. Approve may still use an empty comment.
- Added regression coverage for atomic review comments, rejection validation,
  serialization, and in-place Hook replacement.
- Visual QA was run against the local mock-data app. It confirmed one open
  reference category, the intended scroll caps, and no browser console errors.
- Fixed the brand-memory ribbon avatar alignment after stakeholder QA: the
  nested text selector no longer overrides the initials avatar's centered grid,
  so initials such as `CC` remain inside their box.
- Restyled every Download and Download all action as a black neutral utility
  button so downloads no longer compete with the blue primary-action tone.
- Brought Brief, Create, and Internal QC into the prototype's stage-level UX:
  - Brief now uses a two-column editor and sticky 325px context stack, with
    separate Creative setup and Creative brief modules.
  - Create now opens with a generated-set status panel and groups the artwork
    cards under a dedicated Draft review section.
  - Internal QC now uses a 224px progress rail, visible GD/CS/PM summaries, an
    asset queue heading, and a unified artwork-plus-decision review card.
  - All existing generation, upload, replacement, QA, approval, rejection,
    comment, and navigation actions are preserved.
  - Responsive rules collapse Brief and Internal QC to one column, reduce the
    Create grid to two columns on tablet and one on mobile, and remove sticky
    sidebars on smaller screens.
- Added `stages-redesign.test.tsx` to lock the new Create and Internal QC
  composition without coupling tests to CSS implementation details.
- Follow-up stakeholder feedback rejected the shallow stage pass and asked for
  closer parity with `neo-creative-compass.html`. The correction is complete:
  - Visible workflow names are now **Brief**, **Angles**, and **Build**. Stable
    internal stage IDs remain `brief`, `directions`, and `studio`.
  - Brief now follows the prototype's real two-column composition. The left
    canvas contains **Creative mix** and **Creative brief**. The sticky context
    rail contains **Signal stack**, **Primary success metric**, **Creative
    principle**, **Uploaded materials**, and the existing bounded reference
    library accordions.
  - Stakeholder correction: Creative mix is now a real ordered list instead of
    one service plus one global quantity. Users can add a content item, choose
    its type, set its quantity, and remove it. Types stay unique and the total
    remains within the existing six-deliverable generation limit.
  - `creativeMix` is authoritative workflow state. The legacy `service` and
    `quantity` fields remain synchronized compatibility aliases so existing
    backend request schemas do not change. Older snapshots without
    `creativeMix` migrate into one row during deserialization.
  - Hook generation receives the total requested count plus a concise mix
    instruction. Artwork generation splits the selected Hooks into one
    existing backend request per mix row, preserving the current endpoint
    contract while producing the requested content-type groups.
  - Creative-mix browser QA covered add, content-type selection, quantity
    change, and removal. A two-row mix rendered without horizontal overflow at
    390px, and the browser console reported no warnings or errors.
  - Follow-up typography correction: content-type dropdown values use an
    explicit compact `12px` size instead of inheriting the larger page scale,
    and the selected value is centered within the control.
  - Primary success metric is real workflow state with `CTR`, `CVR`, `CPA`, and
    `ROAS`. It persists in workspace snapshots, defaults older snapshots to
    `CTR`, and is sent through the generation services' existing optional
    `extraInstructions` field. No backend endpoint or request schema changed.
  - Angles now closely matches the final reference card template: idea and
    format pills, metric metadata, large Hook
    typography, separate Sub-headline, Concept, and CTA blocks, an honest
    angle-number pill, a top-right export selector, and Edit / Regenerate
    footer actions. The whole card is a keyboard-accessible selection target,
    while Edit, Regenerate, and the
    export selector remain independent actions. Regenerate all, Generate
    more, Let Neo pick, selection quotas, and artwork-mode controls remain
    unchanged.
  - Build now groups outputs by their real `output.format`, adds prototype-style
    format section headers and draft counts, and keeps preview, regenerate,
    quality check, and Internal QC actions intact.
  - Build/Create output cards now reuse the reference Angles card anatomy: soft
    pill headers, a prominent Hook block, structured Caption and CTA copy, and
    a balanced footer around the existing artwork preview. Opening a creative,
    regeneration, QA, and workflow dispatch behavior remain unchanged.
  - Color fidelity was corrected against the final active CSS layer in
    `neo-creative-compass.html`: cobalt-on-soft-blue format icons, pale-lime
    metric and principle states, pale-blue selected Angle cards, and the
    neutral-light Build introduction now match the rendered prototype. This
    pass changed presentation tokens only; behavior and backend contracts are
    unchanged.
  - Browser color QA confirmed the active Brief palette renders as expected:
    `#eef0ff` / `#5664f5` format icons, `#f4ffdc` active metric state with the
    reference lime halo, and a `#f5ffdd` creative-principle surface.
  - Responsive browser QA passed at 1280px desktop and 390px mobile. Brief
    collapses to one column with no horizontal overflow. Browser console had no
    warnings or errors.
- Internal QC received a reference-matched high-fidelity pass:
  - The page uses a bounded progress rail and one focused review workspace.
    Stakeholder follow-up removed the duplicate top-level and per-asset Review
    route displays.
  - GD, CS, and PM are real selectable role tabs. Switching roles updates the
    guidance, waiting count, asset queue heading, checks, stored rejection note,
    and decision controls without duplicating all three forms on every asset.
  - Each focused asset card keeps the real creative preview, caption expansion,
    black Download action, replacement upload, QA status, and existing
    `review-output` dispatch contract. Download and replacement upload now sit
    in the right-panel action footer beside the review decisions, while the
    artwork column is narrower and the preview is capped to reduce excess card
    height and empty decision-panel space.
  - The persistent comment box was removed. Approve dispatches immediately;
    Reject opens a focused modal and cannot submit until the reviewer provides
    a comment. Rejection and comment still use one atomic `review-output`
    action, with no separate Save comment button.
  - Rejection modal drafts reset correctly when moving between roles, so an
    unfinished GD comment cannot leak into the CS or PM decision.
  - Download links explicitly remove anchor underlines, and the small-screen
    divider below the asset actions was removed.
  - Responsive rules preserve the three-role selector, collapse asset and
    decision content to one column on smaller screens, and keep all actions
    inside the card boundary.
  - `stages-redesign.test.tsx` now verifies role-focused rendering and switching
    from the GD queue to the CS queue.
- Product-facing branding changed from **Moons** to **Neo** across the rail
  wordmark and accessibility label, document title and metadata, loading and
  authentication states, workflow guidance, action labels, error messages,
  and generation-agent prompt labels.
  - The Supabase `moons` schema, `moons.workspace` storage key, existing
    `moons-cvc.vercel.app` authentication redirect, n8n webhook URL, package
    identifier, and internal `appId` remain unchanged. These are compatibility
    contracts, not visible brand labels.
  - Navigation coverage now locks the visible `neo` wordmark and its `Open Neo
    studio` accessible name.
- Artwork-generation diagnostics now retain a separate sanitized
  `*-image-agent.json` trace for every selected Hook when
  `ARTWORK_GENERATION_DEBUG_LOG_DIR` is configured. It includes the exact text
  sent to the image prompt-writing agent, model/mode, reference metadata,
  returned production prompt, and failure status/error. API keys,
  authorization headers, and base64 image bodies are excluded. The existing
  final GPT Image request log remains unchanged, so the two files show the
  complete prompt-writer-to-image-model flow without changing generation or
  fallback behavior.
- Angles now includes a persisted **Image prompt model** selector. GPT 5.6 via
  OpenAI is the default; users can choose Claude Sonnet 4.6 via OpenRouter.
  The selection changes only prompt writing, not the final `gpt-image-2`
  artwork call. Older saved runs default safely to GPT 5.6. OpenRouter requires
  the server-only `OPENROUTER_API_KEY`, and prompt debug logs identify the
  selected provider without storing credentials.
- Angles Hook headlines now use a taller `1.18` line height so multi-line Thai
  copy has clear vowel and tone-mark spacing without changing the card scale.
- Client review received the highest-priority parity and workflow correction:
  - Each client card now presents the creative Hook, supporting concept,
    decision state, Download, Request change, and Approve actions in the
    reference card hierarchy.
  - Request change opens a focused modal. A non-empty comment is mandatory in
    the component, workflow rule, and reducer, so the requirement cannot be
    bypassed by dispatching directly.
  - A submitted request marks only that creative as `revision` and
    `needs-revision`, attaches the feedback to the PM approval record, returns
    the run to Internal QC, and opens the PM queue so the client note is
    immediately visible.
  - Other client-approved creatives remain approved. Sending the corrected set
    again updates only non-approved outputs instead of erasing earlier client
    decisions.
  - The Client back action now correctly returns to Internal QC rather than
    Build. Existing asset download, client approval, delivery, workspace
    serialization, and backend endpoint contracts are unchanged.
  - Focused coverage now verifies the required-comment modal, reducer routing,
    preserved independent approvals, and workflow action guards.
  - Verification passed on 2026-07-14: 3 focused files / 28 tests, prototype
    reference verification, TypeScript, and the production Vite build. The
    build retains the existing non-blocking large-chunk warning.
- Brand setup completion now has a real in-app notification path:
  - `BrandProvider` polls every eight seconds only while at least one brand is
    actively ingesting, using the existing brand repository and ingestion
    statuses. No worker, endpoint, database, or ingestion contract changed.
  - A transition to `ready`, `needs_review`, or `failed` creates one unread
    notification and repeated refreshes do not duplicate it. Direct
    `not_started` to terminal transitions are also covered for fast jobs.
  - The top-right header now includes a reference-style notification bell with
    an unread badge and bounded popover. Opening the popover marks current
    items read; selecting an item returns to Signal and loads the completed
    brand when it is usable.
  - The bell control was visually tightened to match the reference: an 18px
    outline icon, quiet active state, and a contained unread dot instead of an
    oversized count badge hanging outside the button.
  - Background refresh failures keep the last successful brand list visible
    instead of emptying the picker.
  - Notifications are in-app session state. A durable cross-device mailbox
    would require a separate persisted notification backend and is not part of
    this backend-preserving pass.
  - Notification verification passed on 2026-07-14: 2 focused files / 4 tests,
    TypeScript, prototype reference verification, and the production Vite
    build. Live visual QA reached the expected Neo authentication gate; the
    signed-in header still needs a quick authenticated-browser glance.
- Brand Profile cleanup now keeps ingestion implementation details out of the
  user-facing memory UI:
  - Brand kit cards, color swatches, and edit forms hide stored
    `Source: brand_analysis_jobs/...` metadata while retaining the metadata in
    persistence until a user intentionally edits that rule.
  - Past work now loads both saved Facebook posts and Ads Library creatives.
    It groups the two sources clearly, supports text-only Facebook posts, and
    continues to show delivered Neo work separately.
  - The Build reference picker uses the same mixed Past work source, but only
    offers items that have a usable image as visual-generation references.
  - Verification passed on 2026-07-14: 3 focused files / 10 tests, TypeScript,
    prototype reference verification, and the production Vite build. The
    existing non-blocking large-chunk warning remains.
- Current Hook-spacing verification passed: both Angles component suites (2
  files, 6 tests), typecheck, prototype verification, and production build.
- The full regression attempt passed 157 of 158 tests. Its only failure is an
  historical Standard image-agent prompt assertion. This note is superseded by
  the compact Standard-mode input change below.
- Angles now keeps the Brief Creative mix as an end-to-end typed contract:
  - Root cause: the Brief stored the requested mix correctly, but the hook
    harness replaced it with `STATIC AD x 3`, explicitly requested six static
    concepts, removed content type from the response, and the UI displayed the
    first service for every card.
  - Hook requests now send structured `{ service, count }` quotas. The harness
    prompt and strict response schema require the exact total and type order,
    and each saved direction carries its service. Legacy saved directions still
    fall back safely to their Creative mix position.
  - Selection limits are enforced per content type. Artwork generation groups
    selected directions by their saved service rather than by selected-array
    position, so choosing a later replacement card cannot send Static copy to
    the Album or UGC generator.
  - The Angles screen now renders separate Static, Album, UGC, Short video, and
    Resize sections in the shared PDF sort order, with the requested quantity,
    description, selected progress, and correct format badge in each section.
  - `Export PDF` is available in the Angles toolbar. It maps the cards into the
    existing portable PDF kit, sorts them `STATIC AD -> ALBUM AD -> UGC VIDEO
    -> SHORT VIDEO`, and downloads an A4 landscape review deck. `jspdf` 4.2.1
    is now an explicit dependency. PDF page creation now keeps landscape
    orientation explicit, uses a white page background, and writes the Blob
    from an ArrayBuffer.
  - Regression coverage now checks mixed 3 Static / 1 Album / 2 UGC quota
    transport, harness prompt/schema behavior, direction assignment, section
    order and badges, service-aware artwork requests, and content-type aliases.
  - PDF QA generated and rendered a real Thai 3/1/2 sample. Poppler reports its
    known `Adobe-Identity-H` warning for the supplied Sukhumvit font, while the
    native macOS PDF renderer confirms the exported Thai card layout. The PDF
    exporter remains browser-side and does not change backend persistence.
  - Subheadline emphasis is now part of the generated direction contract. The
    hook agent returns one concise `subheadlineHighlight` copied exactly from
    the direction concept. Invalid or legacy values receive a safe exact-span
    fallback, so every generated Angle has a visible bold phrase.
  - Each Angle card previews the saved emphasis and exposes a compact `Adjust
    bold` action. Reviewers can select text directly from the subheadline or
    type an exact phrase; the modal rejects rewritten text that is not present
    in the subheadline.
  - Fixed on 2026-07-14: the generated `copywriting.sub_headline_1` now persists
    separately as `direction.subheadline`; `concept_idea` remains the internal
    strategy field in `direction.concept`. The server response parser,
    generation normalizer, workspace serializer, Angle card/Edit modal, Build
    and review fallbacks, and PDF export all use the real subheadline. The hook
    prompt explicitly requires one concise Thai supporting sentence and rejects
    a strategy explanation or paragraph. Legacy saved directions fall back to
    their old `concept` because their original subheadline was discarded; edit
    or regenerate those cards once to replace that fallback with real copy.
  - Subheadline-field verification passed on 2026-07-14: 6 focused files / 47
    tests, TypeScript, prototype reference verification, and the production
    build. The build retains the existing non-blocking large-chunk warning.
  - The emphasis survives workspace serialization, Hook edits, single/all
    regeneration, and content-type sorting. `Export PDF` now passes the sorted
    highlight map to the existing PDF renderer, so the on-screen bold phrase
    and exported bold phrase cannot diverge.
  - Angle PDF review grouping now matches the stakeholder reference. Every
    Angle card has a compact export selector with `Recommended`, `Option`, and
    `Not selected`. Recommended uses the Neo lime background, Option uses the
    soft orange background, and Not selected remains neutral. This export
    grouping is separate from clicking the card, which still controls the
    Create flow. The visible `Adjust bold` control and its modal were removed;
    generated emphasis remains automatic for cards and PDF export.
  - Corrected Angle-control placement on 2026-07-14: the colored export selector
    is the only top-right control; Edit is beside Regenerate in the footer; and
    Concept is visible as its own card field. Component coverage verifies all
    three placements while retaining the absence of Adjust bold.
  - Rebuilt the automated quality-agent criteria on 2026-07-14 around the exact
    stakeholder GD and CS checklists. The agent now receives the full creative
    copy, Brief, Brand kit/product/client context, visual references, and prior
    revision comments; returns separate GD/CS verdicts; and fails the existing
    overall QA gate when either role fails. The same shared checklist constants
    render as readable lists in the corresponding Internal QC cards. Missing
    references or revision feedback cannot cause an invented failure. Focused
    endpoint, request-mapping, and Internal QC coverage passes (3 files / 10
    tests), as does TypeScript.
  - Corrected the Standard image-prompt-agent path on 2026-07-14. Standard mode
    now loads the complete `agent_prompt/agent_image.md` as its authoritative
    instruction and appends the compact JSON only as
    `AUTHORITATIVE COMPACT CAMPAIGN INPUT`. The hardcoded one-sentence prompt
    that bypassed `agent_image.md` has been removed. The compact runtime input
    contains brand identity, objective, Angle, exact on-image copy, hero
    visual, reference roles, and output-density controls; Caption, the full
    Brief, product-library dumps, and repeated runtime blocks remain omitted.
    User regeneration text is preserved as optional `revisionInstructions`.
    Standard requires the Markdown contract's `finalPrompt`; Design System
    stays on its separate master prompt and `prompt` response field. Both
    Markdown sources are bundled for Vercel.
  - Removed the prompt-agent's silent deterministic fallback on 2026-07-14.
    OpenAI/OpenRouter prompt-agent failures now stop the artwork run before
    `gpt-image-2`, retain a sanitized provider error in the debug trace, and
    surface that failure to the caller instead of generating with unintended
    instructions. Focused verification passes 3 files / 28 tests plus
    TypeScript.
  - Added the supplied generation-success notification sound on 2026-07-14.
    `public/universfield-new-notification-051-494246.mp3` now plays once after a
    successful initial Hook batch, Generate more, single Hook regeneration,
    Regenerate all, initial artwork batch, or image regeneration. Failed
    requests remain silent. Playback rejection is intentionally ignored because
    browsers can block audio until the user has interacted with the page. The
    audio helper has direct playback and blocked-autoplay coverage; focused
    verification passes 3 files / 9 tests plus TypeScript. Full sequential
    verification passes 44 files / 179 tests, prototype-reference verification,
    TypeScript, and the production build.
  - Replaced Subheadline-highlight selection on 2026-07-14 with the exact
    stakeholder-supplied batch prompt. Harness generation now runs research,
    direction generation, then a dedicated highlight pass over
    `{ id, subheadline }` items. The main direction prompt/schema no longer
    select a competing highlight. Only an exact continuous returned span is
    accepted; rewritten spans and `highlights: []` remain unbolded. Legacy data
    with no highlight field retains the deterministic fallback. Focused
    verification passes 5 files / 43 tests plus TypeScript.
  - The export no longer uses the `Angles by content type` heading. It creates
    `Recommended topics` and `Other options` sections, sorts content types
    inside each section with the shared PDF order, and excludes `Not selected`
    cards. Export shows a clear inline error when no Angle has an export group.
  - Export groups persist in saved workspaces and survive Hook edits, single
    regeneration, and Regenerate all. Focused verification passed 33 tests,
    prototype verification, TypeScript, and the production build. A rendered
    two-page sample confirmed both new PDF headings and section order; Poppler
    still reports the known `Adobe-Identity-H` warning for the supplied Thai
    font.
  - Emphasis verification passed on 2026-07-14: 6 focused files / 46 tests,
    TypeScript, prototype reference verification, and the production build.
    Browser QA reached the real Brief screen, but the local mock
    data source still calls the hook harness and could not create live Angles
    without a generation response; the modal interaction is covered in the
    component test.
  - The older 171/172 full-suite result and its `STAGE 1` prompt-marker failure
    are superseded. Standard mode uses `agent_image.md` plus compact runtime
    campaign input; tests assert the file's instruction text is present and
    the bypassing hardcoded sentence is absent. The PDF renderer remains a
    separate lazy-loaded build chunk. The existing non-blocking large-chunk
    build warning and one low-severity npm audit finding remain.
  - Final verification after the compact Standard-mode change passed all 43
    test files / 175 tests. After the dedicated Subheadline-highlight pass was
    added, the suite reached 43 test files / 177 tests. After restoring
    `agent_image.md` as the Standard instruction and removing the silent
    prompt fallback, verification passed all 43 test files / 177 tests. After
    adding generation-success audio coverage, the latest verification passes
    all 44 test files / 179 tests, prototype-reference verification,
    TypeScript, and the production build. The existing non-blocking large-chunk
    warning remains.

### In progress

- Nothing. The implementation and verification pass is complete.

### Not started

- Optional later cleanup of legacy CSS. Do not begin this until visual parity
  has been accepted by the user or design owner.

## Files changed by the redesign

- `docs/UX_REDESIGN_HANDOFF.md` - this living handoff document.
- `package.json` and `package-lock.json` - Phosphor icon and jsPDF dependencies.
- `src/app/App.tsx` - redesigned shell, rail, header, hero, and stage icons.
- `src/app/App.navigation.test.tsx` - navigation and stable-stage contract tests.
- `src/features/workflow/config.ts` - visible workflow labels and hero copy,
  including Angles and Build over stable internal IDs.
- `src/features/workflow/stages.tsx` - visible stage headings and Workboard title.
- `src/features/workflow/use-generate-hooks.ts` - tone-based regeneration of a
  single existing Hook through the existing generation services.
- `src/features/workflow/model.ts`, `reducer.ts`, and `rules.ts` - in-place Hook
  replacement, persisted primary success metric, and atomic review
  decision/comment behavior.
- `src/features/workflow/angle-content-types.ts` - shared Angles section order,
  display metadata, PDF mapping, and sorted emphasis map.
- `src/domain/subheadline-highlight.ts` - exact-span validation and legacy
  fallback for subheadline bold text.
- `src/features/export-pdf-kit/` - portable Angles PDF renderer and canonical
  content-type sorting aliases/order.
- `src/server/hook-generation/hook-generation-harness-endpoint.ts` and hook
  generation services - structured Creative mix quota transport and response
  typing.
- `src/services/artwork-generation/openai-image-generation.ts` - preserves the
  selected direction service through grouped artwork requests.
- `src/features/workflow/reducer.test.ts` and `rules.test.ts` - feedback behavior
  regression coverage.
- `src/services/workspace/workspace-serializer.ts` and its tests - persist the
  success metric and prove backward compatibility plus review-comment storage.
- `src/services/clients/merge-mapping-clients.ts` - replaces a visible em dash
  fallback with a regular hyphen; mapping behavior is unchanged.
- `src/styles/neo-redesign.css` - scoped creative-tech visual layer.
- `src/main.tsx` - loads the redesign stylesheet after the legacy stylesheet.
- `src/config/app.ts` - approved reference metadata.
- `scripts/verify-prototype.mjs` - verifies the new reference structure.
- `docs/ARCHITECTURE.md` - records the new visual source of truth.

## Next action

Open the redesigned application for stakeholder review, focusing on the new
Brief signal rail, Angles cards and regeneration controls, grouped Build output
sections, the role-focused Internal QC asset queue, and the Client Request
change round trip back to PM review.
If more feedback arrives, continue from this document. Do not remove legacy CSS
or change external backend/API/persistence contracts until the new visual
direction is explicitly accepted.

The package installation reported one low-severity npm audit finding. It was
not auto-fixed because dependency remediations are outside this redesign and
could introduce unrelated changes.
