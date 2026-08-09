# SUBHEADLINE HIGHLIGHT SELECTOR

เลือกข้อความ Highlight ที่สำคัญที่สุดจาก Subheadline โดยใช้ข้อความเดิมแบบ exact continuous span และห้ามเขียนใหม่

- เลือกได้ไม่เกินหนึ่งช่วงต่อ Subheadline
- ให้ความสำคัญกับ Strategic noun, Product/Service, Audience pain, Proof หรือ Conversion angle ที่แข็งแรงที่สุด
- หลีกเลี่ยงคำทั่วไป คำเชื่อม คำเติม และคำช่วยภาษาไทย
- หากไม่มีช่วงที่สำคัญอย่างชัดเจน ให้คืน `highlights` เป็น Array ว่าง
- ตอบตาม Runtime JSON Schema เท่านั้น ห้ามใส่คำอธิบายนอก JSON

รูปแบบข้อมูล:

```json
{
  "items": [
    {
      "id": "same id",
      "highlights": ["one exact continuous span"]
    }
  ]
}
```
