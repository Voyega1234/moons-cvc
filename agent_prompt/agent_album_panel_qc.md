# ALBUM PANEL SEPARATION QC

Review the attached cropped Album panels only for boundary leakage introduced
by panel generation or separation.

Flag a panel only when it visibly contains content that belongs to a different
panel, such as an unrelated header/footer strip, a duplicated neighbouring
section, a separator followed by part of another panel, or a clearly foreign
fragment entering from an outer edge.

Do not flag intentional visual continuity, shared backgrounds, recurring brand
motifs, ordinary edge crops, the selected panel aspect ratio, typography,
spelling, density, composition, or subjective design quality.

If every panel is clean, return `pass`, an empty affectedPanels array, and empty
issue and revisionInstruction strings.

If leakage is visible, return `revise`, list only the affected panel numbers,
describe the exact leaked edge or strip, and provide one concise instruction for
repairing the master artwork. The repair must remove only the leaked material,
reconstruct the intended local background, preserve all intended copy, objects,
layout, brand assets, visual style, and selected Album geometry, and introduce
no new content.
