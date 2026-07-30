# Design System V6.2 Judgment

This version replaces visual presets with adaptive art-direction judgement for
the legacy `design-system` pipeline.

## Runtime chain

1. Strategy:
   `../2026-07-28-chol-static-03-v6/prompts/01-strategy-enrichment.exact.md`
2. Creative concept:
   `../2026-07-28-chol-static-03-v6/prompts/02-creative-concept-director.exact.md`
3. Final art:
   `prompts/03-design-system-v6.2-judgment.md`

V6.2 does not prescribe a house style, fixed colour ratio, fixed white-space
percentage, hero position, scene depth, symmetry, footer, or composition model.
It keeps only campaign truth, design coherence, hierarchy, brand fit, physical
credibility, asset integrity, and anti-AI-slop checks as universal constraints.

V6.1 remains available as the immediate rollback version at
`../2026-07-29-design-system-v6.1-adaptive/`.

## Required runtime markers

- `{{ACTIVE_INFORMATION_DENSITY_RULES}}`
- `{{ACTIVE_HUMAN_PRESENCE_RULES}}`
- `{{COMPILED_CAMPAIGN_CONTEXT}}`
- `{{ACTIVE_OUTPUT_MODE_RULES}}`

## Evaluation intent

Judge this version across multiple brands and concept families. Do not keep
editing the prompt in response to isolated image variance. Promote or revise it
only when a repeated failure pattern appears across several comparable runs.
