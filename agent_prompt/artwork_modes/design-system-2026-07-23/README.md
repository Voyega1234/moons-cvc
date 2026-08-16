# Design System — 23 July 2026

This artwork mode restores the `design-system` workflow as it existed in Git
commit `009c176097353f5ab00090d06a7592bf1ef89274`.

The production mode id is `design-system-2026-07-23`. It is intentionally
isolated from the current `design-system` and `design-system-new` modes so the
historical workflow can be tested without changing either of them.

## Prompt provenance

- `01-creative-strategy-enrichment.md` is byte-for-byte identical to
  `agent_prompt/agent_creative_strategy_enrichment.md` at commit `009c176`.
  SHA-256: `a06267a14b895c28fa6fcdfc2466e451629d4b04dd0d2d2f655eb6fe3ec05cd8`
- `02-final-artwork.md` is byte-for-byte identical to
  `agent_prompt/agent_design_system.md` at commit `009c176`.
  SHA-256: `eefb010df77b5a1b6039e13e6af29e7b423f5414d90edafb6d8507dc082d6313`
- `../../agent_design_system-2026-07-23-009c176.md` is a convenient provenance
  copy of the same final-art prompt requested for the repository root prompt
  directory. Runtime reads the isolated copy in this folder.

## Input

For every selected idea, the mode receives:

- brand name, category, personality, and colors;
- confirmed campaign brief and service type;
- selected hook, concept, rationale, visual direction, supporting points, CTA,
  caption, and album beats when present;
- brand memory (`working` and `avoid`);
- Brand Kit guidelines, brand facts, products, documents, and reference notes;
- selected source/reference image attachments and their roles;
- additional artwork requirements entered by the user;
- requested canvas size.

## Process

1. **Creative strategy enrichment** — one `GPT-5.6 Luna` Responses API call
   uses `01-creative-strategy-enrichment.md` and returns structured decisions
   such as commercial style, selling mechanism, human presence, audience
   moment, reason to believe, offer/proof, and evidence status.
2. **Deterministic prompt compilation** — application code inserts campaign
   input, the strategy response, copy priority, artifact roles, and compact
   Brand Kit context into `02-final-artwork.md`. This step does not call a
   model.
3. **Image generation** — one `GPT Image 2` request receives the compiled
   prompt and selected image attachments. A request with attachments uses image
   edit; a request without attachments uses image generation. Quality is
   `medium`, and the configured output size is used.
4. **Persistence** — the generated original is stored as the artwork output and
   its prompt/debug trace follows the existing artwork debug-log behavior.

## Output

- One original generated image for each selected idea.
- The normal persisted artwork output metadata and storage URL.
- When debug logging is enabled: the strategy request/response and final GPT
  Image request prompt.

Album requests retain the application's current album persistence and splitting
machinery around the restored per-idea prompt. Static generation is the closest
comparison with outputs originally produced by the July 23 workflow.

## Deliberate historical limitations

This mode preserves the old behavior for comparison:

- no Creative Concept Director between strategy and image generation;
- no multi-candidate generation or candidate selection;
- no post-generation Visual QC or automatic regeneration;
- GPT Image 2 creates both the visual and all typography in a single pass;
- the historical prompt remains information-heavy and includes fixed visual
  grammar/layout guidance that can repeat across brands.

These are known limitations, not recommendations for the new simplified Art
Director mode discussed separately.
