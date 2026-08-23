# Reference Library Style Grammar: ทำอย่างไรให้งานไม่เป็น AI Slop

เอกสารนี้สกัดจาก artwork 72 ภาพใน `agent_prompt/Images/` โดยดูภาพจริงร่วมกับ
spec รายภาพใน `agent_prompt/Images/output/` เป้าหมายคือถ่ายทอดวิธีตัดสินใจของ
designer ไม่ใช่ให้ AI เลียนแบบวัตถุ ฉาก หรือ layout ของงานเก่า

## ข้อสรุปสำคัญ

ชุดภาพนี้ไม่มี visual style เดียว เพราะครอบคลุมหลายแบรนด์และหลายประเภทงาน
สิ่งที่ซ้ำและควรให้ agent เรียนรู้คือ **design grammar** ต่อไปนี้:

1. หนึ่งภาพมีหนึ่ง visual thesis ที่อธิบายได้ในหนึ่งประโยค
2. Hero ไม่ได้มีไว้ตกแต่ง แต่ทำให้ problem, benefit, mechanism, offer หรือ proof มองเห็นได้
3. มีลำดับสายตา 3–4 ขั้นที่ตั้งใจไว้ ไม่กระจายน้ำหนักให้ทุกอย่างเด่นเท่ากัน
4. Typography ถูก compose เป็นรูปทรงหนึ่งของภาพ ไม่ใช่ข้อความที่แปะทับภายหลัง
5. สีเด่นมีหน้าที่จำกัด เช่น เน้นคำสำคัญ ราคา CTA หรือ product signal เพียงบทบาทหลักเดียว
6. วัตถุทุกชิ้นอยู่ในโลกเดียวกัน: perspective, light direction, shadow, material และ depth สอดคล้องกัน
7. ความหนาแน่นถูกเลือกตามงาน ไม่ใช่ใช้ minimal หรือ maximal เป็นค่าเริ่มต้นกับทุก brief
8. Product, logo, offer และ proof ถูกจัดเป็น source of truth ไม่ปล่อยให้ AI แต่งข้อมูลขึ้นเอง

ข้อสังเกตเชิงปริมาณจาก library สนับสนุน grammar นี้:

- 40/72 ภาพใช้ container แบบผสม คือ box เฉพาะข้อมูลที่ต้องแยก ไม่ box ทุกอย่าง
- 55/72 ภาพเน้นคำสำคัญด้วยการเปลี่ยนสี และมักจำกัดอยู่ที่ 1–3 คำหรือวลี
- Headline ส่วนใหญ่เป็น clean sans, รองลงมาคือ rounded Thai display; serif เป็นกรณีเฉพาะของ premium work
- High-key commercial lighting เป็นฐานที่พบบ่อยที่สุด ส่วน dramatic lighting ใช้เมื่อ concept ต้องการจริง
- งานทั่วไปให้พื้นที่ text ราว 28–42% และ hero ราว 32–45% ของ canvas โดยไม่จำเป็นต้องเป็นกรอบแข็ง

## สิ่งที่ห้าม agent เรียนผิด

อย่าเรียน “ผิวหน้า” ของ reference เช่น โทรศัพท์ลอย, glass card, blue glow, เมฆ,
แท่น 3D, particle, miniature people หรือ gradient แล้วนำไปใส่ทุกงาน สิ่งเหล่านี้ใช้ได้
เฉพาะเมื่อมีหน้าที่ต่อ concept หากดึงมาใช้โดยไม่มีเหตุผลจะกลายเป็น AI slop ทันที

อย่าเฉลี่ยทั้ง 72 ภาพเป็น house style เดียว ให้เลือก reference family ที่ตรงกับ brief
แล้วดึงเฉพาะกฎที่เข้ากันได้

## Reference families และ template ที่ควรเลือกใช้

### A. Conceptual commercial / problem–solution

เหมาะกับ: service, campaign idea, pain point, benefit ที่เล่าเป็นภาพได้

- หนึ่ง metaphor หรือหนึ่งเหตุการณ์เป็น hero
- Headline สั้น 2–4 บรรทัด อยู่ใน quiet zone
- Supporting element มีเฉพาะสิ่งที่ทำให้เรื่องอ่านออก
- ฉากมี foreground, midground, background และมี contact shadow จริง
- CTA และ logo เป็นลำดับท้าย

### B. Central monument / symbolic hero

เหมาะกับ: abstract benefit, performance, growth, business outcome

- แปลง keyword สำคัญเป็นวัตถุหรือสัญลักษณ์ขนาดใหญ่หนึ่งชิ้น
- ใช้ scale contrast ชัดเจน และไม่เพิ่ม metaphor ตัวที่สอง
- จัด headline กับ hero ให้เกิด silhouette เดียวกัน
- ใช้ texture, material และ lighting ช่วยเพิ่มความหมาย ไม่ใช่เพิ่มความอลังการเฉย ๆ

### C. Clean B2B / tech feature

เหมาะกับ: product feature, integration, SaaS, enterprise offer

- White, pale neutral หรือ tight blue system เป็นค่าเริ่มต้นเมื่อ CI อนุญาต
- Hero 1 ชิ้น เช่น device, interface moment หรือ physicalized mechanism
- UI card ใช้เฉพาะ proof ที่จำเป็น 0–3 ชิ้น
- Edge คมที่ hero แต่ atmosphere และ background เงียบ
- ห้ามกระจาย dashboard, icon และ glass card เต็มภาพเพียงเพื่อให้ดู “tech”

### D. Lifestyle beauty / wellness

เหมาะกับ: clinic, beauty device, nutrition, personal benefit

- Human result หรือ product เป็น hero หลัก ไม่แย่งกันเด่น
- High-key light, skin/material texture ธรรมชาติ, สี analogous ที่ควบคุมแล้ว
- Ingredient, mechanism หรือ benefit cue จัดเป็นวง/แนวที่รองรับ hero
- Price และ CTA อาจอยู่ใน container เดียว ส่วน headline ไม่ต้อง box

### E. Dense retail / marketplace

เหมาะกับ: multi-SKU, sale date, discount, platform campaign

- แบ่งชัดเป็น headline band, offer band, product stage และ date/CTA band
- Product 4–8 ชิ้นได้ แต่ต้องจัดกลุ่มบน stage เดียว ไม่กระจายแบบสุ่ม
- Price/discount chip ใช้ geometry, radius, outline และ shadow family เดียวกัน
- เลือก platform color เป็นระบบ และมี dominant/secondary/accent ที่ชัด
- งานแน่นต้องยังมี hierarchy; ความแน่นไม่เท่ากับทุกอย่างใหญ่และ saturated เท่ากัน

### F. Editorial premium / travel

เหมาะกับ: premium product, destination, offer ที่ขายด้วย atmosphere

- ใช้ negative space, crop, texture และ light เป็นตัวสร้าง value
- Typography น้อยและไม่ box; serif ใช้เมื่อ brand evidence รองรับเท่านั้น
- Product หรือ destination ได้พื้นที่หายใจ
- Seal/certification ใช้เฉพาะของจริง และรักษาขนาดให้เป็น proof ไม่ใช่ hero

## Default element budget

ใช้เป็นจุดเริ่มต้นแล้วปรับตาม brief:

| Mode | Hero | Supporting objects | Info chips | Badges | Text blocks |
|---|---:|---:|---:|---:|---:|
| Conceptual / standard commercial | 1 | 4–6 | 1–3 | 0–1 | 8–12 |
| B2B / tech | 1–2 | 3–6 | 0–3 | 0–1 | 7–10 |
| Retail / marketplace | 4–8 SKU | 5–9 | 3–6 | 0–2 | 9–13 |
| Premium / editorial | 1–3 | 1–3 | 0 | เฉพาะของจริง | 3–5 |

ถ้า element ใดไม่มีหน้าที่เป็น `sell`, `prove`, `group`, `guide`, `stage` หรือ
`add depth` ให้ลบออก

## Copy-paste agent instruction

```text
You are a senior advertising Art Director and graphic designer. Learn design
reasoning from the attached reference artworks, not their campaign content.

Your goal is an original, brand-native commercial artwork that avoids generic
AI aesthetics. Do not average incompatible references. First classify the brief
into exactly one visual family: conceptual problem–solution, central symbolic
hero, clean B2B/tech feature, lifestyle beauty/wellness, dense retail/marketplace,
or editorial premium/travel. Select one primary reference from that family for
composition and hierarchy, and at most one secondary reference for compatible
craft such as lighting, texture, typography behavior, or finishing.

Before designing, write a private one-sentence visual thesis:
“The viewer sees [one hero/action], which makes [problem, mechanism, benefit,
offer, or proof] immediately visible.”
Reject the route if it needs two unrelated metaphors or a paragraph to explain.

Build one deliberate reading path:
1. headline or hero,
2. the paired headline or hero,
3. proof/offer,
4. CTA,
5. logo.
Nothing outside that order may steal attention.

Treat typography as part of the composition. Break Thai copy by meaning and
spoken cadence. Use one dominant phrase, one coordinated supporting tier, and
one quiet CTA/proof tier. Emphasize only 1–3 words or short phrases, normally by
one accent-color swap. Use at most two compatible type personalities and 2–3
purposeful weights. Do not auto-fit text, create accidental orphan lines, or
make every phrase bold, outlined, dimensional, or boxed.

Choose density from the brief. Containers are allowed only for information that
must behave as a unit: price, offer, proof, feature, date, or CTA. Do not add
cards, icons, badges, arrows, particles, gradients, glass panels, glowing rings,
floating objects, miniature people, or decorative props unless each has a clear
communication or spatial function.

Create one coherent physical and graphic world. All elements must share a
plausible camera, perspective, scale, light direction, shadow softness, color
grade, material response, edge quality, and depth system. Ground products with
credible contact shadows or reflections. Preserve natural skin, fabric, food,
packaging, metal, glass, and paper texture. Avoid waxy skin, synthetic gloss,
uniform sharpness, over-HDR contrast, excessive bloom, halos, impossible
reflections, and showroom perfection.

Use a controlled palette with clear roles: dominant field, structural secondary,
and one high-salience accent. Do not distribute the accent everywhere. Protect a
quiet zone and keep comfortable outer margins. Background detail must cluster
around the hero and fall away near copy.

Official product, logo, packaging, price, dates, claims, certifications, and
legal copy are source-of-truth assets. Never invent or redraw them when accuracy
matters. Copy approved text exactly once and flag uncertainty rather than
hallucinating it.

Do not copy a reference's people, props, scene, visual metaphor, exact layout,
readable copy, or brand identity. Transfer only its abstract construction:
zone proportions, hierarchy, density, typography behavior, palette roles,
lighting logic, material language, depth, and finish.

Avoid vague prompt adjectives such as “premium, cinematic, modern, futuristic,
hyper-realistic, ultra-detailed” unless each is translated into observable
design decisions. The result must feel art-directed, not keyword-styled.

Before approval, inspect the actual rendered image at thumbnail and full size.
Fail it if: the big idea is unclear in one second; two elements compete for first
read; typography looks pasted on; decoration has no job; product/logo/copy is
wrong; perspective or light is inconsistent; or the same treatment could be
used for an unrelated brand without meaningful changes. Revise the smallest
high-impact area first instead of regenerating blindly.
```

## Anti-slop QA scorecard

ให้คะแนนเต็ม 100 และไม่ผ่านถ้าหัวข้อใดมี hard fail:

| หัวข้อ | คะแนน | Hard fail |
|---|---:|---|
| Visual thesis และ concept fit | 20 | อธิบายภาพไม่ได้ในหนึ่งประโยค หรือใช้หลาย metaphor แข่งกัน |
| One-second hierarchy | 15 | ไม่รู้ว่าอะไรควรเห็นเป็นอันดับแรกและสอง |
| Composition / spacing / grid | 15 | ขอบอึดอัด, alignment หลุด, ไม่มี quiet zone |
| Typography | 15 | อ่านไทยผิด, line break ผิดความหมาย, ทุกบรรทัดเด่นเท่ากัน |
| Brand / product / copy truth | 15 | logo, package, price, claim หรือ certification ผิด |
| Physical and material coherence | 10 | แสง, perspective, shadow หรือ material อยู่คนละโลก |
| Restraint and finish | 10 | มีของตกแต่งไร้หน้าที่, glow/particle/card มากเกิน, edge มี halo |

เกณฑ์แนะนำ: ต้องได้อย่างน้อย 85/100 และไม่มี hard fail ก่อนส่งให้ลูกค้า

## วิธีใช้กับระบบปัจจุบัน

1. ใช้ `agent_prompt/Images/output/library_index.json` เพื่อ filter reference ตาม mode และ archetype
2. ใช้ spec รายภาพเพื่อดึงค่าที่วัดได้ของ reference ที่เลือก ไม่ดึงค่าเฉลี่ยทั้ง library
3. ใช้ `agent_prompt/agent_artwork_reference.md` เป็น runtime prompt สำหรับสร้างงาน
4. ใช้ `07_ART_DIRECTOR_QA_PROMPT.md` ตรวจ output จริง แล้วแก้ด้วย surgical revision

