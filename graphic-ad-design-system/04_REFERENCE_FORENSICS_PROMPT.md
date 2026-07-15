# Reference Forensics Prompt

ใช้เมื่อแนบ Reference แล้วต้องการให้ AI วิเคราะห์ “วิธีออกแบบ” ไม่ใช่แค่ความหมายของภาพ

```text
Act as a senior Art Director conducting a forensic graphic-design analysis of the attached references.

Do not summarize only the subject matter, mood, message, or objects visible in the images.

Study the decisions a graphic designer made to construct each image.

For every reference, analyze:

1. DESIGN PURPOSE
- likely advertising objective
- audience attention strategy
- intended one-second impression
- role of the image in the customer journey

2. LAYOUT BLUEPRINT
- aspect ratio
- underlying grid
- dominant axis
- major zones and approximate canvas share
- shared alignment anchors
- center of visual gravity
- symmetry/asymmetry
- crop decisions
- negative-space placement

3. EYE PATH
List the intended viewing order from first to last and explain which visual devices create it: scale, contrast, color, position, sharpness, lighting, isolation, or grouping.

4. TYPOGRAPHY AS COMPOSITION
- probable type category, not an unsupported exact font guess
- display and supporting styles
- scale relationships
- weight and width contrast
- line-break design
- text-block silhouette
- alignment
- leading and tracking character
- highlighted words
- relationship between Thai and Latin text
- whether typography is the hero, support, or conversion layer

5. COLOR SYSTEM
- dominant, supporting, neutral, readability, and accent colors
- saturation hierarchy
- warm/cool relationship
- where maximum contrast is reserved
- how color separates information groups

6. HERO AND SUPPORTING ELEMENTS
- hero object or visual metaphor
- scale manipulation
- relationship to text
- product/model prominence
- supporting elements and their purpose
- elements intentionally suppressed

7. DEPTH, LIGHT, AND MATERIAL
- foreground/middle/background
- viewpoint and perspective
- key light direction and softness
- contact shadows and ambient occlusion
- focus hierarchy
- material treatment
- texture and imperfection
- how compositing is made coherent

8. DENSITY AND RHYTHM
- active zones
- quiet zones
- repeated shapes or intervals
- grouping logic
- use of containers, badges, labels, or platforms
- why the design feels controlled rather than random

9. BACKGROUND ROLE
Identify its primary function: contrast, context, atmosphere, metaphor support, or depth. Explain how it remains subordinate or becomes the concept.

10. HUMAN CRAFT SIGNALS
Identify optical corrections, intentional asymmetry, custom typography behavior, selective simplification, crop choices, edge control, texture variation, or other signs of human refinement.

11. TRANSFER MAP
Separate findings into:

A. Transferable design principles
B. Brand-specific visual DNA
C. Content-specific execution
D. Elements that must not be copied literally
E. How to apply the reasoning to a new brief without reproducing the same scene

12. ANTI-AI FINDINGS
Explain which decisions prevent the work from looking like a generic generated image, and which details an AI would most likely misunderstand or overdo.

When several references are provided, conclude with:

- shared design DNA
- meaningful differences
- which reference should guide composition
- which should guide typography
- which should guide color
- which should guide lighting/material
- which should guide density/commercial structure

Be concrete and visual. Avoid vague phrases such as “looks premium,” “nice balance,” or “good hierarchy” without explaining exactly what creates that result.
```

