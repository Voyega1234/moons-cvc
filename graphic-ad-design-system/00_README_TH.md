# Graphic Advertising Design System for GPT Image

ชุด Prompt นี้ออกแบบมาเพื่อให้ AI ทำงานใกล้เคียงกระบวนการของ Creative Director, Art Director และ Graphic Designer มากกว่าการรับ Brief แล้วสร้างภาพทันที

เป้าหมายไม่ใช่เพียงทำให้ภาพ “สวย” หรือ “ไม่ดู AI” แต่ทำให้ทุกการตัดสินใจในภาพมีเหตุผล ทั้ง Concept, Layout, Grid, Typography, สี, Visual Weight, Lighting, Material, Product Integration และ Commercial Hierarchy

## ไฟล์ในชุด

1. `01_WORKFLOW_PLAN_TH.md` — แผนการทำงานตั้งแต่รับ Brief ถึง Final Artwork
2. `02_BRIEF_TEMPLATE.md` — แบบฟอร์ม Brief สำหรับกรอกก่อนเริ่มงาน
3. `03_MASTER_CREATIVE_DIRECTOR_AGENT.md` — Master Prompt สำหรับใช้เป็น Agent ตัวเดียว
4. `04_REFERENCE_FORENSICS_PROMPT.md` — Prompt วิเคราะห์ Reference ในมุม Graphic Design
5. `05_CONCEPT_ROUTE_PROMPT.md` — Prompt สร้างและคัดเลือก Concept Routes
6. `06_FINAL_IMAGE_PROMPT_TEMPLATE.md` — Template สำหรับสร้าง Prompt ภาพสุดท้าย
7. `07_ART_DIRECTOR_QA_PROMPT.md` — Prompt ตรวจคุณภาพงาน
8. `08_SURGICAL_REVISION_PROMPT.md` — Prompt แก้ภาพเฉพาะจุดโดยลดการ Drift
9. `09_QUICK_MODE_PROMPT.md` — เวอร์ชันรวดเร็วสำหรับงานประจำวันที่ไม่ต้องการ Workflow เต็ม
10. `examples/` — ตัวอย่างการใช้งาน 3 รูปแบบ

## วิธีใช้ที่แนะนำ

### การใช้งานใน Moons

ในหน้า Hook ของแต่ละ Creative Run สามารถเลือก `Design system` ในหัวข้อ
Artwork mode ได้ ระบบจะใช้ `03_MASTER_CREATIVE_DIRECTOR_AGENT.md` เป็น Prompt
Source แยกจากโหมด `Standard` เดิม โดย Brief, Hook, Concept, Brand Library,
Additional Instructions และ Reference ที่เลือกจะถูกส่งเข้า Workflow นี้
อัตโนมัติ การเลือกโหมดจะถูกบันทึกกับ Run และใช้ต่อในการ Regenerate ภาพ

โหมด `Reference library` เป็นอีกทางเลือกหนึ่ง โดยใช้
`agent_prompt/agent_artwork_reference.md` ซึ่งสรุป Design Pattern จากงานโฆษณา
ที่วิเคราะห์ไว้ใน `agent_prompt/Images/output` ระบบจะนำ Logic ด้าน Layout,
Hierarchy, สี, Lighting, Density และ Storytelling มาปรับใช้กับ Brief ใหม่
โดยไม่คัดลอก Brand, Copy, Product หรือฉากของงานต้นฉบับ

### วิธีที่ 1: Agent ตัวเดียว

นำ `03_MASTER_CREATIVE_DIRECTOR_AGENT.md` ไปใส่เป็น System Prompt หรือข้อความแรก จากนั้นแนบ Brief, Brand Assets, Product Packshot และ Reference

Agent จะทำงานตามลำดับ:

Brief Diagnosis → Reference Forensics → Concept Routes → Art Direction → Generation Prompt → QA → Revision

### วิธีที่ 2: แยกทีละขั้นเพื่อควบคุมสูงสุด

1. กรอก `02_BRIEF_TEMPLATE.md`
2. วิเคราะห์ภาพด้วย `04_REFERENCE_FORENSICS_PROMPT.md`
3. สร้างแนวคิดด้วย `05_CONCEPT_ROUTE_PROMPT.md`
4. สร้าง Prompt ภาพด้วย `06_FINAL_IMAGE_PROMPT_TEMPLATE.md`
5. ตรวจภาพด้วย `07_ART_DIRECTOR_QA_PROMPT.md`
6. แก้ภาพด้วย `08_SURGICAL_REVISION_PROMPT.md`

วิธีนี้เหมาะกับงานลูกค้า งาน Key Visual และงานที่ต้องรักษา CI อย่างจริงจัง

## หลักสำคัญ

- Reference ใช้เพื่อเรียนรู้ Design Reasoning ไม่ใช่คัดลอกฉากหรือไอเดีย
- AI ควรคิดหลาย Concept ก่อนเลือก ไม่ใช้ไอเดียแรกโดยอัตโนมัติ
- Background ต้องมีหน้าที่และต้องไม่เด่นกว่า Hero
- Typography เป็นส่วนหนึ่งของ Composition ไม่ใช่ข้อความแปะบนภาพ
- งานข้อมูลเยอะต้องแบ่ง Information Zones ไม่ใช่ลดทุกอย่างจนอ่านไม่รู้เรื่อง
- Product, Logo, Packaging, Price และข้อความสำคัญควรใช้ Asset จริงเมื่อความถูกต้องมีความสำคัญ
- Prompt ยาวไม่ใช่เป้าหมาย เป้าหมายคือคำสั่งที่ตรงกับการตัดสินใจของงานนั้น
- Final Quality เกิดจากการ Generate, Critique และ Revise ไม่ใช่รอบเดียว

## ข้อจำกัดที่ควรรู้

แม้ใช้ระบบนี้ AI อาจยังผิดพลาดกับภาษาไทย, ฉลากสินค้า, Logo, เครื่องหมายรับรอง, รายละเอียดราคา และการจัด SKU จำนวนมาก สำหรับงาน Production ควรตรวจความถูกต้องและวาง Asset สำคัญด้วยไฟล์ต้นฉบับ
