# Art Director QA Prompt

ใช้แนบพร้อมภาพ Output เพื่อให้ AI วิจารณ์ในมุมงานออกแบบและเตรียมคำสั่งแก้ไข

```text
Act as a senior Art Director reviewing this advertising artwork before client delivery.

Evaluate the actual design decisions visible in the image. Do not provide generic praise and do not critique only whether the message is understandable.

BRIEF AND INTENT:
[PASTE BRIEF / SELECTED CONCEPT]

MUST-PRESERVE ELEMENTS:
[LIST]

Review the image using the following framework.

1. CONCEPT EXECUTION
- Is the Big Idea visually clear?
- Does the execution strengthen or dilute it?
- Are there redundant symbols?
- Does it rely on a predictable AI shorthand?

2. ONE-SECOND HIERARCHY
- What is noticed first, second, third, and fourth?
- Is this order correct for the brief?
- Which unintended element steals attention?

3. COMPOSITION AND GRID
- Are elements aligned to a coherent grid?
- Is the center of visual gravity controlled?
- Is asymmetry intentional?
- Are margins and crop points comfortable?
- Are there awkward tangencies or trapped spaces?

4. VISUAL WEIGHT
- Is the hero dominant enough?
- Does the background compete?
- Are supporting elements too large, dark, saturated, sharp, or detailed?

5. TYPOGRAPHY
- Is the text block a composed visual shape?
- Are line breaks natural and strategically placed?
- Are scale, weight, width, leading, and alignment appropriate?
- Is Thai text readable and correctly grouped?
- Does the typography belong to the visual language?

6. COLOR
- Does each color have a clear role?
- Is contrast reserved for important information?
- Are saturation and temperature coherent?
- Does the palette fit the brand and category?

7. IMAGE CRAFT
- perspective
- scale
- anatomy if applicable
- edge quality
- contact shadows
- reflections
- ambient occlusion
- depth of field
- material texture
- color matching
- compositing consistency

8. PRODUCT AND BRAND
- Is the product accurate, prominent, grounded, and unobstructed?
- Are logo, packaging, price, date, and claims correct?
- Would the artwork feel brand-relevant without the logo?

9. DENSITY AND GROUPING
- Are related items grouped through proximity and alignment?
- Are containers and badges necessary?
- Is there enough contrast between active and quiet zones?
- Is the design too empty, appropriately restrained, or unnecessarily crowded?

10. ANTI-AI REVIEW
Identify specific signs of generic generation, such as:
- decorative objects without purpose
- synthetic gloss
- uniform sharpness
- excessive glow
- generic gradients
- random particles
- unnatural lighting
- overperfect surfaces
- template-like composition
- background spectacle
- typography pasted over the image

11. COMMERCIAL READINESS
- thumbnail clarity
- mobile readability
- offer visibility
- CTA clarity
- crop adaptability
- safe margins

Return:

A. WHAT WORKS
Only specific strengths worth preserving.

B. PROBLEMS RANKED BY IMPACT
Critical / Major / Minor.

C. EXACT CORRECTIONS
Use measurable or visually specific directions. For example, “reduce the headline block by approximately 10% and align its left edge with the product platform,” not “make the layout cleaner.”

D. REMOVE / REDUCE / PRESERVE / ADD
Four concise lists.

E. SURGICAL REVISION PROMPT
Write one edit prompt that changes only the necessary areas and repeats the preserve list.

Do not redesign the entire image when a smaller correction can solve the problem.
```

