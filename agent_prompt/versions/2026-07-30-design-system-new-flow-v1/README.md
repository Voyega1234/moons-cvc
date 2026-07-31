# Design System New Flow V1

Runtime order:

1. deterministic Locked Campaign Input, created once per generation request;
2. `00-set-creative-director.md`, called once for the complete selected set;
3. archived V6 strategy prompt `01-strategy-enrichment.exact.md`, per idea;
4. archived V6 concept prompt `02-creative-concept-director.exact.md`, per idea;
5. V6.2 Judgment final-art prompt, sent directly to GPT Image 2;
6. `04-visual-qc.md`, reviewing the generated image;
7. at most one targeted GPT Image 2 edit when Visual QC returns `revise`.

This replaces the previous Campaign Truth Normalizer pipeline behind
`design-system-new`. The other artwork modes are unchanged.
