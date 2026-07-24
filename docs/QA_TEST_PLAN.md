# Compass Creative OS — QA test plan

Author: QA pass conducted in-session by Claude, 2026-07-17. Derived from
`docs/V1_WORKFLOW_CONTRACT.md`, `docs/ARCHITECTURE.md`, `docs/FEATURE_*.md`,
and direct source reading (`src/features/workflow/rules.ts`,
`src/features/workflow/reducer.ts`, `src/app/providers/auth-provider.tsx`).

## How to use this document

Each test case has a **Verified** column:

- **Live** — actually executed in a browser against `npm run dev` with
  `VITE_DATA_SOURCE=mock` and observed the real result.
- **Derived** — not executed; the expected result is read directly from the
  guard logic in `rules.ts` / `reducer.ts`, so it should hold, but no human or
  agent has clicked through it in this pass.
- **Blocked** — could not be executed in this environment; see "Environment
  limitations" below.

## Environment limitations (read this first)

`npm run dev` (Vite only, no `vercel dev`) does **not** serve `/api/*`
serverless functions. Confirmed live: clicking "Generate angles" on the Brief
step POSTs to `/api/hook-generation-harness` and gets a **404**, which the UI
correctly surfaces as an inline error ("Harness hook generation returned an
empty response body.") rather than crashing. This is expected given the dev
command used, not a bug — see `README.md`'s `dev:full` script
(`vercel dev --listen 3000`) for the command that serves API routes.

Because of this:

- All AI-backed steps — hook generation, artwork generation, quality check —
  are **Blocked** for live verification under plain `npm run dev`.
- Running them for real under `vercel dev` calls production OpenAI /
  OpenRouter / n8n endpoints using the real keys in `.env`, which costs money
  and hits a live n8n webhook. That was intentionally **not** triggered in
  this pass without separate sign-off. If you want those test cases executed
  live, run `npm run dev:full` and expect real spend per generation.
- No mock/seed workspace exists with outputs already sitting in Internal QC
  or Client review, so those stages' UI could not be reached live via normal
  navigation in this pass either. Test cases for those stages are marked
  **Derived** from `docs/FEATURE_INTERNAL_QC.md` and `rules.ts`.

## Test environment setup used for the Live cases

`.env.local` was temporarily changed from `VITE_DATA_SOURCE=supabase` to
`VITE_DATA_SOURCE=mock` to skip the Supabase magic-link auth gate
(`AuthProvider` returns `enabled: false` and renders children directly when
`env.dataSource !== "supabase"` — see `src/app/providers/auth-provider.tsx:53`).
This also swaps every repository in `src/app/dependencies.ts` to its mock
implementation, so brand/workspace data is fixture data, not production
Supabase data. **This file is git-ignored** (`.gitignore` matches `.env.*`),
so nothing was committed, and it was reverted to `VITE_DATA_SOURCE=supabase`
after this pass — see the last section of this document.

---

## 1. Auth gate

| ID | Case | Steps | Expected | Priority | Verified |
| --- | --- | --- | --- | --- | --- |
| AUTH-01 | Unauthenticated user sees Google sign-in, not the app | Load the app with `VITE_DATA_SOURCE=supabase` and no session | `SupabaseAuthGate` renders "Continue with Google"; no workspace UI is reachable | High | Derived |
| AUTH-02 | Google OAuth requests only the required Workspace access | Click "Continue with Google" | `signInWithOAuth` requests `drive.file` and `spreadsheets.readonly`, plus `hd=convertcake.com` | High | Derived |
| AUTH-03 | Non-Convert-Cake Google session is rejected | Return from OAuth with a user email outside `@convertcake.com` | Session is signed out and the workspace stays inaccessible | High | Derived |
| AUTH-04 | Google provider token is shared with Workspace features | Complete Google OAuth, then import a Questionnaire or export Slides | Questionnaire calls Sheets API and Slides calls Drive API with the captured provider token | High | Derived |
| AUTH-05 | Redirect URL differs prod vs local | Compare `googleSignInRedirectUrl()` on `localhost`/`127.0.0.1`/`::1` vs any other hostname | Localhost returns `location.origin`; anything else returns `https://moons-cvc.vercel.app/` | Medium | Derived |
| AUTH-06 | Supabase misconfigured shows a hard error, not a blank screen | Unset `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` with `VITE_DATA_SOURCE=supabase` | `.boot-error` screen: "Supabase is not configured." with the two env var names | Low | Derived |
| AUTH-07 | Mock mode fully bypasses auth | Set `VITE_DATA_SOURCE=mock`, reload | App loads straight into Studio with no login screen, `enabled: false` in `AuthContext` | High | **Live** |

---

## 2. Stage navigation & gating

Backed by `highestUnlockedStageIndex` / `canNavigateToStage` in `rules.ts`.
The rule: a step is unlocked only once every prior step in the fixed order
(Signal → Brief → Hook → Create → Internal QC → Client → Learn) is complete
per `isStageComplete`.

| ID | Case | Steps | Expected | Priority | Verified |
| --- | --- | --- | --- | --- | --- |
| NAV-01 | Fresh workspace only unlocks Signal | Load app with no brand selected | Brief/Hook/Create/Internal QC/Client/Learn tabs are disabled with tooltip "Finish the current step before opening that stage."; Signal tab is active | High | **Live** |
| NAV-02 | Selecting a brand unlocks Brief | Pick any system brand (e.g. "A Klass Auto") on Signal | Signal tab gets a green checkmark; Brief tab tooltip clears and becomes clickable | High | **Live** |
| NAV-03 | Clicking a still-locked tab does nothing destructive | With only Signal complete, click the "Internal QC" tab directly | Nothing navigates; the guard message shows on hover/attempt; no state mutation, no `updatedAt` bump (per `V1_WORKFLOW_CONTRACT.md` "Blocked actions must not mutate run data") | High | Derived |
| NAV-04 | Backward navigation is always allowed | From Brief, click back to Signal | Navigates freely; brand selection and any Brief text already typed are preserved | Medium | Derived |
| NAV-05 | Direct URL/action dispatch can't skip the guard | Dispatch `set-stage` to a locked stage programmatically (not just hiding the tab in UI) | `workflowActionBlockReason` still returns the block reason; the central guard is action-level, not just UI-level | High | Derived (architectural claim in `ARCHITECTURE.md`) |
| NAV-06 | Changing service after Hook invalidates downstream stages | Generate hooks for "Single static", then go back and change the service to "UGC video" | Directions, outputs, QA, approval, client review, and delivery data for the old service are invalidated (`V1_WORKFLOW_CONTRACT.md`: "Changing service invalidates...") | High | Derived |

---

## 3. Signal (brand selection)

| ID | Case | Steps | Expected | Priority | Verified |
| --- | --- | --- | --- | --- | --- |
| SIG-01 | Brand picker lists system + sheet clients together | Open "Choose a brand" | Selectable system clients (e.g. A Klass Auto, BoneFit, BrewBite...) sorted before grey/disabled sheet-only clients labeled "No Compass data yet"; search box filters both | High | **Live** |
| SIG-02 | Selecting a system brand loads its memory | Click "A Klass Auto" | Header pill switches from "No client" to "AK · A Klass Auto"; right panel shows "A Klass Auto memory" with Brand kit / Products / Documents / References / Past work / Brand learning tabs | High | **Live** |
| SIG-03 | Sheet-only ("No Compass data yet") client is not selectable | Click a grey/disabled option, e.g. "100 Salueng" | Selection is rejected — `select-brand` guard returns "This client has no Compass brand memory yet." (`rules.ts:99`); no brand loads | High | Derived |
| SIG-04 | "Add to Compass" starts ingestion, doesn't select | Click "Add to Compass" next to a sheet-only client | Creates a draft client + queued ingestion job (`FEATURE_START.md`); client stays disabled/unselectable until Brand Memory is ready — it must not silently select the brand | Medium | Derived |
| SIG-05 | Search matches name, category, and status | Type a partial category name (e.g. "supplement") into the search box | Filters to brands whose name/category/mapping-status/service-status match, per `FEATURE_START.md` search contract | Low | Derived |
| SIG-06 | Thai-named clients render and sort correctly | Scroll the brand list past the Latin-named entries | Thai client names (e.g. "กรมทรัพย์สินทางปัญญา") render without mojibake and sort using Thai locale rules after the Latin/system group | Medium | **Live** (rendering confirmed; sort-order correctness not independently verified) |
| SIG-07 | "Continue to brief" only appears once a brand is loaded | Compare Signal screen before vs after brand selection | Button is absent/disabled with no brand; present as "Continue to brief →" once brand memory has loaded | Medium | **Live** |

---

## 4. Brief

| ID | Case | Steps | Expected | Priority | Verified |
| --- | --- | --- | --- | --- | --- |
| BRF-01 | Brief step shows content-mix quantity steppers | Land on Brief after selecting a brand | Static / UGC / Album steppers each show a default quantity and +/− controls; "Use monthly quota" button present | High | **Live** |
| BRF-02 | Working brief pre-fills from brand context | Observe the "Working brief" textarea on load | Contains brand-relevant objective/audience copy seeded from the loaded brand memory, with a live character counter (seen: "440 chars") | Medium | **Live** |
| BRF-03 | Primary success metric is a single-select | Click between CTR / CVR / CPA / ROAS tiles | Exactly one tile is highlighted at a time; selecting a new one deselects the previous | Medium | **Live** (CTR shown pre-selected; toggle behavior itself not exercised) |
| BRF-04 | "Generate angles" is blocked with no brand | Dispatch `generate-directions` with no brand selected | Blocked: "Choose a brand first." (`rules.ts:103`) | Medium | Derived |
| BRF-05 | "Generate angles" is blocked with an empty brief | Clear the working-brief textarea, click "Generate angles" | Blocked: "Add a brief first." (`rules.ts:104`) | High | Derived |
| BRF-06 | "Generate angles" is blocked with zero deliverables selected | Set every content-mix quantity to 0, click "Generate angles" | Blocked: "Choose at least one deliverable." (`rules.ts:106`) | High | Derived |
| BRF-07 | Hook-generation backend failure surfaces inline, doesn't crash | With a valid brand+brief+quantity, click "Generate angles" while `/api/hook-generation-harness` is unreachable (e.g. plain `npm run dev`) | Red inline banner "Harness hook generation returned an empty response body."; page remains interactive; no unhandled exception in console | High | **Live** |
| BRF-08 | Manage uploaded materials / attachments | Click "Manage uploaded materials" | Opens the attachment manager for brief-scoped uploads (documents/images used as generation context) | Low | Derived |

---

## 5. Hook (Angles)

Blocked from live verification — reaching this stage's real content requires
successful hook generation, which needs `vercel dev` + a real OpenAI/n8n call
(see "Environment limitations"). All cases below are Derived from
`rules.ts` and `docs/FEATURE_ARTWORK_GENERATION.md`'s mention of the
per-run artwork-mode selector living on this step.

| ID | Case | Steps | Expected | Priority | Verified |
| --- | --- | --- | --- | --- | --- |
| HOOK-01 | Selecting a hook before any exist is blocked | Dispatch `toggle-direction` with no directions generated | Blocked: "Generate hooks before selecting one." (`rules.ts:112`) | Medium | Derived |
| HOOK-02 | "Let Compass pick" is blocked before generation | Dispatch `auto-select-directions` with `directions.length === 0` | Blocked: "Generate hooks before Compass can pick." (`rules.ts:135`) | Medium | Derived |
| HOOK-03 | Manual hook requires all template fields | Use "Add manual direction" with hook text filled but pillar/subheadline/CTA blank | Blocked: "Complete the manual hook template before saving." (`rules.ts:124`) | Medium | Derived |
| HOOK-04 | Regenerating hooks must preserve count | Dispatch `replace-directions` with a different-length array than the current directions | Blocked: "Regenerated hook count does not match the current set." (`rules.ts:119`) | Low | Derived |
| HOOK-05 | "Create selected hooks" requires exact quantity match | Select fewer/more hooks than the Brief-step content-mix total, click "Create selected hooks" | Blocked: "Select {N} hooks first." where N = `totalCreativeMixQuantity` (`rules.ts:143`/`148`) | High | Derived |
| HOOK-06 | Artwork-mode selector persists on the run | Switch between Standard / Design System / Reference Library mode, then reload the workspace | Selected mode is stored on the run and survives reload; older saved runs without the field default to `standard` (`FEATURE_ARTWORK_GENERATION.md`) | Medium | Derived |
| HOOK-07 | Image-prompt-writer model choice persists | Switch between `gpt-5.6-terra` and `anthropic/claude-sonnet-4.6` | Choice is stored per-run; regeneration reuses the same model unless changed | Low | Derived |

---

## 6. Create (Studio / QA)

Blocked from live verification for the same reason as Hook — needs a real
artwork-generation round trip. Derived from `docs/FEATURE_ARTWORK_GENERATION.md`.

| ID | Case | Steps | Expected | Priority | Verified |
| --- | --- | --- | --- | --- | --- |
| CRE-01 | QA can't run before outputs exist | Dispatch `run-qa` with `outputs.length === 0` | Blocked: "Create outputs before QA." (`rules.ts:150`) | High | Derived |
| CRE-02 | Quality-check failure marks a specific output, not the whole run | Simulate one output failing `gdPassed`/`csPassed` | Only that output's `status` becomes `"needs-revision"`; its card shows the GD/CS reason inline (`.output-qa-note`); other outputs unaffected | High | Derived |
| CRE-03 | Studio step completion requires zero `needs-revision` outputs | With `qaComplete: true` but one output still `"needs-revision"` | `isStageComplete("studio")` is false (`rules.ts:29-32`); "Send to internal QC" stays blocked until every flagged output is resolved | High | Derived |
| CRE-04 | Regenerate-with-custom-prompt reuses the same endpoint | Open a creative's `OutputRegenerateModal`, add instructions, regenerate | Calls the same `/api/artwork-generation` route (not a separate endpoint) with `textInputs` carrying the custom instructions; on success dispatches `replace-output-asset`, resetting all three approval roles to `null` and bumping `revisionCount` | Medium | Derived |
| CRE-05 | Manual "Upload replacement" behaves identically to regenerate | Upload a replacement image file directly instead of regenerating | Same `replace-output-asset` action fires; `status` becomes `"fixed"`, approval resets to `{ null, null, null }` (`FEATURE_INTERNAL_QC.md`) | Medium | Derived |
| CRE-06 | "Use from library" only offers what mock data actually has | In mock mode, open the reference-image picker | Only the Logo appears as selectable (if the brand has one); Past-work thumbnails are empty because `MockBrandMemoryRepository.listAdsLibraryPastWork` returns `[]` — this is documented, not a bug | Low | **Live** (confirmed via code; picker itself not opened live) |
| CRE-07 | Quality check never hard-blocks progression | An output stays flagged `needs-revision` from QA | Creative can still be manually pushed forward if a human fixes/re-approves it — "the check surfaces problems, it doesn't hard-block" per `FEATURE_ARTWORK_GENERATION.md` | Medium | Derived |

---

## 7. Internal QC

Blocked from live verification (no seeded run reaches this stage without
real generation). All Derived from `docs/FEATURE_INTERNAL_QC.md` and
`rules.ts`. This section also covers the two visual tweaks made earlier in
this session (Internal QC nav icon changed shield→checkmark; GD/CS/PM role
badges recolored to match `neo-creative-compass.html`) — those need a live
pass once a run can reach this stage.

| ID | Case | Steps | Expected | Priority | Verified |
| --- | --- | --- | --- | --- | --- |
| QC-01 | UGC outputs skip Graphic Design review | Compare `approvalRolesForOutput` for a UGC-format output vs a static one | UGC-format outputs require only `["clientService", "projectManager"]`; everything else requires all three (`rules.ts:66-68`) — matches the UI copy "UGC starts with CS." | High | Derived |
| QC-02 | Roles must approve in order | Try to approve as PM before GD/CS have approved (non-UGC output) | Blocked: `"This creative is waiting for {role} review."` where `{role}` is the next unapproved role in sequence (`rules.ts:169`) | High | Derived |
| QC-03 | Rejection requires a comment | Reject a role's review with an empty comment | Blocked: "Add a comment before rejecting." (`rules.ts:160`) | High | Derived |
| QC-04 | A rejection flips output status | Reject any role's review | Output's `status` becomes `"needs-revision"`; clearing the last rejection (re-approving, or a fresh upload) returns it to `"ready"` (`FEATURE_INTERNAL_QC.md`) | High | Derived |
| QC-05 | Reviewing after full approval is a no-op with a clear message | Attempt to review an output where all three roles already `"approved"` | Blocked: "This creative already passed Internal QC." (`rules.ts:166`) | Medium | Derived |
| QC-06 | "Approve all" only touches pending roles | Click "Approve all" when some roles are already explicitly rejected | Bulk-approves every *pending* role across every creative; roles someone already rejected are left untouched, not silently overridden (`FEATURE_INTERNAL_QC.md`) | High | Derived |
| QC-07 | "Approve all" requires QA to have run first | Dispatch `approve-all` with `qaComplete: false` | Blocked: "Run QA before internal approval." (`rules.ts:153`) | Medium | Derived |
| QC-08 | "Approve all" blocked while any output still needs revision | Dispatch `approve-all` with at least one `status: "needs-revision"` output | Blocked: "Resolve every quality suggestion before internal approval." (`rules.ts:155`) | Medium | Derived |
| QC-09 | Run-level `approved` is fully derived, never stored input | Approve all three roles on every output | `WorkflowState.approved` becomes `true` only via `computeApproved`; there's no direct action that sets it | Medium | Derived |
| QC-10 | Known gap: reviews aren't cross-visible across logins | Log in as a different Convert Cake user who didn't push the run to Internal QC | That reviewer cannot see the run — approval state lives entirely in the pusher's workspace snapshot (`moons.workspaces`), not `moons.internal_reviews` (documented gap in `FEATURE_INTERNAL_QC.md`) | High (known limitation, not a new bug) | Derived — confirms documented gap, worth re-flagging to product since it blocks real multi-reviewer QC |
| QC-11 (visual) | Internal QC nav icon is a checkmark, not a shield | Look at the top stage rail's Internal QC icon when the stage is not yet "done" | Renders Phosphor `Check` (bold), not `ShieldCheck` — changed in `App.tsx:784-785` this session | Low | Needs live check once a run reaches/approaches this stage (typecheck-verified only so far) |
| QC-12 (visual) | GD/CS/PM role badges use the reference's solid gradient colors | Open Internal QC, look at the GD / CS / PM avatar badges | GD: `linear-gradient(145deg,#7d87ff,#5664f5)`; CS: `linear-gradient(145deg,#ff8d74,#ff6846)`; PM: `linear-gradient(145deg,#9b8cff,#725df0)`; all white text — matches `neo-creative-compass.html` (`compass-redesign.css:4623-4643`) | Low | Needs live check, same blocker as QC-11 |

---

## 8. Client review

Derived — same blocker (needs approved outputs, which needs real generation).

| ID | Case | Steps | Expected | Priority | Verified |
| --- | --- | --- | --- | --- | --- |
| CLI-01 | Client review is blocked until internal approval | Dispatch `send-client` with `run.approved === false` | Blocked: "Approve internally before client review." (`rules.ts:201`) | High | Derived |
| CLI-02 | Client review blocked with zero outputs | Dispatch `send-client` with `outputs.length === 0` | Blocked: "Create outputs before client review." (`rules.ts:200`) | Medium | Derived |
| CLI-03 | Client approve/reject requires the packet to have been sent | Dispatch `approve-output` or `request-client-change` before `clientSent` | Blocked: "Send to client first." for both actions (`rules.ts:203`/`208`) | High | Derived |
| CLI-04 | Requesting a client change requires a comment | Call `request-client-change` with an empty comment | Blocked: "Add a comment before requesting changes." (`rules.ts:209`) | High | Derived |
| CLI-05 | Step completion requires every output client-approved | Approve 4 of 5 outputs, leave one pending | `isClientReviewComplete` is false; "Mark delivered" stays blocked | High | Derived |
| CLI-06 | Routing GD/CS/PM-flagged changes back respects role ownership | Dispatch `route-output-changes` from a role that isn't the creative's current pending role | Blocked with the same "waiting for {role} review" / "already passed Internal QC" messaging as `review-output` (`rules.ts:188-193`) | Medium | Derived |

---

## 9. Delivered / Learn

| ID | Case | Steps | Expected | Priority | Verified |
| --- | --- | --- | --- | --- | --- |
| DEL-01 | "Mark delivered" blocked until every output is client-approved | Dispatch `mark-delivered` with any output not `"approved"` | Blocked: "Client must approve every output first." (`rules.ts:216`) | High | Derived |
| DEL-02 | "Mark sent" only valid from the Delivered step | Dispatch `mark-done` while `run.stage !== "summary"` | Blocked: "Mark delivered before closing the run." (`rules.ts:220`) | Medium | Derived |
| DEL-03 | Delivered run status vocabulary | Inspect `runStatus()` transitions | Returns `"delivered"` once `done`; `"warning"` if any output is `needs-revision`; `"ready"` once `qaComplete`; else `"active"` — check the priority order matches `runStatus()` in `rules.ts:233-242` (delivered beats warning beats ready) | Medium | Derived |

---

## 10. Multi-run / workspace behavior

| ID | Case | Steps | Expected | Priority | Verified |
| --- | --- | --- | --- | --- | --- |
| RUN-01 | New creative keeps the current brand | With a brand loaded, click "+ New creative" | Creates a second run, same brand, `activeRunId` switches to it; first run's data is untouched | Medium | Derived |
| RUN-02 | "Refresh studio" creates a separate blank run | Click the refresh/circular-arrow icon in the top bar | New blank run created; does not clear or merge into the existing run(s) | Medium | **Live** (button present and clickable; effect on state not independently confirmed) |
| RUN-03 | Switching runs changes only `activeRunId` | Open a second run tab, switch back to the first | First run's brief/hooks/outputs/approvals are exactly as left; no cross-run bleed | High | Derived |
| RUN-04 | Final run can't be closed | With exactly one run open, attempt to close it | Close is a no-op or disabled — "the final remaining run cannot be closed" (`V1_WORKFLOW_CONTRACT.md`) | Medium | Derived |
| RUN-05 | Closing the active run selects the nearest remaining run | With 3 runs open, close the active (middle) one | Selection falls to an adjacent run, not an arbitrary one | Low | Derived |
| RUN-06 | Async actions target the run that started them, not whichever is active on response | Start "Generate angles" on Run A, immediately switch to Run B before the response returns | Result lands on Run A when the response arrives, even though Run B is now active; if Run A was closed meanwhile, the result is dropped harmlessly (documented fix, `ARCHITECTURE.md` "Async actions target a run id") | High | Derived — this is exactly the class of bug most worth a live regression test once generation is testable |
| RUN-07 | Workspace persistence excludes transient UI state | Reload the page mid-session | Toasts, open menus, and search text do not survive reload; brief text, brand, hooks, outputs do (per versioned snapshot rule) | Low | Derived |
| RUN-08 | Invalid/unknown snapshot version is dropped, not partially loaded | Manually corrupt or version-skew the `moons.workspace` LocalStorage value, reload | `LocalWorkspaceRepository.load()` removes the bad snapshot and returns `null` rather than loading it partially (`local-workspace-repository.ts`, `ARCHITECTURE.md`) | Medium | Derived |

---

## 11. Regression watchlist from this session's changes

Two unrelated visual changes landed earlier in this session and are worth a
dedicated pass once the app is reachable end-to-end:

1. **Neo → Compass rename** (branding, CSS class prefix `neo-*` → `compass-*`,
   `NeoReviewPdf*` identifiers → `CompassReviewPdf*`). Typecheck and the full
   test suite (564/567, 3 pre-existing flaky parallel-worker timeouts,
   unrelated) both passed. Spot-checked live: login screen renders "Sign in
   to Compass", tab title "Compass - Creative OS", rail logo renders
   "compass". **Not yet checked live:** the exported PDF review
   (`exportCompassIdeasReviewPdf`) actually opens/renders correctly — this
   exercises the renamed PDF-kit identifiers end-to-end and wasn't reachable
   without real outputs.
2. **Internal QC nav icon + GD/CS/PM badge colors** — see QC-11/QC-12 above.

## 12. Summary of coverage gaps

- **Everything AI-generation-dependent is untested live in this pass**: hook
  generation, artwork generation (all 3 modes), quality check, regenerate,
  reference-library strategy enrichment. Recommend a follow-up pass using
  `npm run dev:full` with a small, deliberate budget (a handful of real
  generations), since these are the highest-risk, most expensive-to-debug-in-
  production paths in the app.
- **Internal QC, Client review, Delivered/Learn are entirely Derived** — no
  seeded fixture exists to jump straight to those stages without generation.
  Consider adding a small "seed a completed run" dev helper (e.g. a
  fixture JSON loadable into `moons.workspace` in mock mode) purely to make
  these stages reachable for fast UI QA without spending on generation every
  time.
- **Cross-login QC visibility (QC-10)** is a known, documented gap — flagging
  again here since it directly blocks realistic multi-reviewer QA of the
  Internal QC flow itself.

---

## Environment restored

`.env.local` was reverted to `VITE_DATA_SOURCE=supabase` at the end of this
QA pass, restoring the Supabase magic-link login gate exactly as it was
before this session (see git-ignored `.env.local`; not committed either way).
