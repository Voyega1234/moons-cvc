# ALBUM PANEL SEPARATION QC

Review the attached cropped Album panels only for two boundary problems
introduced by panel generation or separation: content leaking in from a
neighbouring panel, and this panel's own content being cut off incomplete at
its own edge because it was drawn too close to the crop line.

Flag a panel for **leakage** when it visibly contains content that belongs to
a different panel, such as an unrelated header/footer strip, a duplicated
neighbouring section, a separator followed by part of another panel, or a
clearly foreign fragment entering from an outer edge.

Flag a panel for **truncation** when an element that clearly belongs to this
panel is sliced through and reads as incomplete rather than intentionally
framed — an icon showing only its top or bottom half, a caption or headline
line cut off mid-word or mid-character, a logo or badge missing part of its
shape, or a button/CTA pill with its edge sliced off. The tell is that the
element has no natural stopping point; a viewer can see it was interrupted.

Do not flag intentional visual continuity, shared backgrounds, recurring brand
motifs, a deliberate photographic crop that has a natural framing (e.g. a
person or object crossing the edge with clean composition, no partial text or
icon), the selected panel aspect ratio, typography, spelling, density,
composition, or subjective design quality.

If every panel is clean, return `pass`, an empty affectedPanels array, and empty
issue and revisionInstruction strings.

If leakage or truncation is visible, return `revise`, list only the affected
panel numbers, describe the exact problem (leaked edge/strip, or which element
is truncated and where), and provide one concise instruction for repairing the
master artwork. For leakage, remove only the leaked material and reconstruct
the intended local background. For truncation, redraw the affected element
fully inside its panel with real margin from the boundary (shrink or reposition
it slightly rather than continuing it past the edge). Either way, preserve all
other intended copy, objects, layout, brand assets, visual style, and selected
Album geometry, and introduce no new content.
