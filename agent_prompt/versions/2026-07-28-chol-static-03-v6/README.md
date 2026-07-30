# Design System V6 — active upstream prompts and rollback provenance

This directory preserves the prompt chain that produced:

`logs/artwork-generation/2026-07-28T06-12-13-208Z-run-6a3c7394-0e89-43a2-b3b7-4b1b71afa375-chol-static-03-output.png`

It also contains the reusable V6 final-art reconstruction retained as the
`design-system` rollback baseline:

`prompts/03-design-system-v6.reusable.md`

This reusable final-art prompt is now the rollback baseline. Runtime
`design-system` requests use the V6.1 Adaptive final prompt in
`../2026-07-29-design-system-v6.1-adaptive/`, while the exact V6 strategy and
concept prompts in this package remain active upstream.

The exact CHOL artifacts remain frozen provenance snapshots. The runtime never
loads the CHOL-specific compiled prompt.

For `design-system` only, the runtime also loads the static V6 upstream prompts:

- `prompts/01-strategy-enrichment.exact.md`
- `prompts/02-creative-concept-director.exact.md`

Runtime campaign input and the strict JSON transport envelope are appended
after these static prompts. `design-system-new` keeps its current normalized
truth, concept, and final-art prompt pipeline.

## What is exact

- `prompts/01-strategy-enrichment.exact.md` is the exact static Strategy
  Enrichment prompt used by the run, before its runtime JSON was appended.
- `prompts/02-creative-concept-director.exact.md` is the exact static Creative
  Concept Director prompt used by the run, before its runtime JSON was
  appended.
- `prompts/03-design-system-v6.compiled-exact.md` is the exact final prompt
  submitted to GPT Image 2 after campaign context was compiled and provider
  length handling was applied.
- `prompts/03-design-system-v6.reusable.md` is the cleaned, brand-neutral V6
  reconstruction retained for rollback and comparison.
- `inputs/` preserves the exact structured inputs and final image-request
  metadata.
- `outputs/` preserves the exact intermediate Strategy and Concept outputs.

## Important recovery limitation

At runtime the final prompt loader read:

`agent_prompt/agent_design_system.md`

That working copy identified itself as:

`# GPT IMAGE 2 — CREATIVE GRAPHIC DESIGNER V6`

The reusable V6 source template was never committed to Git and no current copy
file is an exact match. All three requests from this batch reached the provider
prompt limit and contain the explicit lower-priority-context truncation marker.
Therefore this archive does not claim that
`prompts/03-design-system-v6.compiled-exact.md` is the complete pre-compilation
template. It is the complete, exact prompt the image model actually received
for CHOL Static 03.

Do not use or edit the compiled prompt as a reusable source: it contains
CHOL-specific campaign context and represents a post-truncation runtime
artifact. Runtime experiments belong in a new version package rather than in
the frozen provenance artifacts.

## Runtime routing

`src/server/artwork-generation/artwork-generation-endpoint.ts` loads the exact
V6 upstream prompts only when the selected mode is `design-system`:

- `design-system` runs the archived V6 Strategy Enrichment and Creative Concept
  Director prompts, then compiles the resulting creative provocation into the
  V6.1 Adaptive final-art prompt.
- `design-system-new` loads the canonical current
  `agent_prompt/agent_design_system.md` final-art prompt.

The reusable V6 final prompt is not active unless runtime routing is explicitly
rolled back. Standard and Reference Library modes are not routed through this
package.
