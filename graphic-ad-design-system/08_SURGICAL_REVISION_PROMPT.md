# Surgical Revision Prompt

ใช้แก้ภาพเดิมโดยลดโอกาสที่ AI จะเปลี่ยนส่วนอื่น

```text
Refine the supplied advertising artwork through a controlled surgical edit.

OBJECTIVE
[DESCRIBE THE SINGLE MAIN IMPROVEMENT]

CHANGE ONLY

1. [EXACT ELEMENT]
Current issue: [WHAT IS WRONG]
Required change: [SPECIFIC SIZE / POSITION / COLOR / CONTRAST / LIGHT / MATERIAL / COPY CHANGE]

2. [EXACT ELEMENT]
Current issue: [WHAT IS WRONG]
Required change: [SPECIFIC CHANGE]

3. [OPTIONAL]

PRESERVE EXACTLY

- overall concept
- canvas dimensions and aspect ratio
- composition outside the named edit areas
- product geometry, packaging, label, color, and scale
- model identity, face, pose, anatomy, clothing, and expression
- logo geometry and placement
- all approved text not explicitly listed for change
- brand colors
- lighting direction
- background structure
- crop and safe margins
- all elements not explicitly named under CHANGE ONLY

HIERARCHY TARGET

After revision, the intended viewing order must be:
1. [FIRST]
2. [SECOND]
3. [THIRD]
4. [FOURTH]

CRAFT REQUIREMENTS

- maintain consistent perspective
- preserve physically believable contact shadows
- maintain coherent reflections and ambient light
- avoid newly introduced glow, particles, icons, cards, text, or decorative objects
- prevent edge halos and pasted-object appearance
- keep background detail subordinate to the hero
- maintain natural texture and controlled imperfection

Do not reinterpret the concept.
Do not redesign the entire artwork.
Do not move, replace, restyle, or regenerate preserved elements.
Do not add anything that was not requested.
```

## ตัวอย่างคำสั่งแก้แบบเฉพาะจุด

```text
Refine the supplied advertising artwork through a controlled surgical edit.

OBJECTIVE
Improve product dominance and create more comfortable separation between the headline and hero product.

CHANGE ONLY

1. Reduce the headline block by approximately 8–10%. Keep the exact line breaks and font treatment. Move it slightly upward so its lower edge no longer competes with the product silhouette.

2. Reduce background contrast and sharpness behind the product by approximately 15%. Keep the background objects and structure unchanged.

3. Add a slightly denser but soft contact shadow directly beneath the product so it feels grounded on the platform. Match the existing upper-left light direction.

PRESERVE EXACTLY

- all approved copy
- logo
- product packaging and label
- product scale and angle
- color palette
- overall layout
- platform geometry
- all other shadows and objects
- canvas and crop

Do not add new effects, decorations, icons, or text.
```

