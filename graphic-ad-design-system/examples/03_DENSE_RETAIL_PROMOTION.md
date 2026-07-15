# Example 3 — Information-Rich Retail Promotion

ตัวอย่างนี้แสดงว่างานข้อมูลเยอะไม่จำเป็นต้อง Minimal แต่ต้องมีระบบแบ่งกลุ่มและ Hierarchy

## Brief

- Brand: BrightKids Nutrition (สมมติ)
- Campaign: 9.9 Family Super Sale
- Products: 7 SKUs
- Main offer: ลดสูงสุด 40%
- Secondary offer: ซื้อครบ 1,200 บาท ส่งฟรี
- Platform: Marketplace social ad
- Output: 1:1

## Information Architecture

1. Event: 9.9 Family Super Sale
2. Main offer: ลดสูงสุด 40%
3. Hero products: 3 SKUs
4. Supporting products: 4 SKUs
5. Secondary offer: ส่งฟรีเมื่อซื้อครบ 1,200 บาท
6. Date and marketplace CTA

## Art Direction

- Design mode: energetic retail promotion
- Concept: “Family Festival Shelves” — Product ถูกจัดบนชั้นโค้งเหมือนพื้นที่งานแฟร์ ไม่ใช้สินค้าโปรยบนท้องฟ้า
- Grid: modular 12-column
- Zones: event top, product middle, conversion strip bottom
- Color: brand blue + warm orange + cream; red เฉพาะส่วนลด
- Label system: ใช้ Label รูปทรงเดียวกันทั้งหมด แต่เปลี่ยนขนาดตาม Priority
- Product grouping: Hero 3 ชิ้นกลาง, supporting 2+2 ด้านข้าง

## Final Generation Prompt

```text
INTENDED USE
Create a square 1:1 marketplace-ready retail promotion artwork for BrightKids Nutrition’s “9.9 Family Super Sale.”

The artwork contains seven product SKUs and multiple offers. It must feel energetic and information-rich while maintaining clear grouping and hierarchy.

CREATIVE CONCEPT
Create a clean “Family Festival Shelves” environment: a series of broad curved retail platforms arranged like a cheerful indoor family fair. Products are organized by importance on these platforms rather than scattered or floating.

DESIGN MODE
Energetic Thai retail-promotion design with strong commercial typography, clean modular organization, and polished product compositing.

COMPOSITION
Use a 12-column modular grid with three horizontal bands:

Top 30% — campaign event and main discount
Middle 52% — product system
Bottom 18% — secondary offer, date, and CTA

Place three hero products in the center on the highest and largest curved platform. Place two supporting products on a smaller left platform and two on a smaller right platform. Maintain clear gaps between product groups.

Do not allow products, labels, or decorative elements to overlap packaging fronts.

VIEWING ORDER
1. “9.9 Family Super Sale”
2. “ลดสูงสุด 40%”
3. Central hero product group
4. Supporting product groups
5. Free-shipping offer, date, and CTA

TYPOGRAPHY
Use the exact text:

“9.9 FAMILY SUPER SALE”
“ลดสูงสุด 40%”
“ซื้อครบ 1,200 บาท ส่งฟรี”
“เฉพาะวันที่ 8–11 ก.ย.”
“ช้อปเลย”

Use one bold condensed display family for the campaign title and one highly readable Thai sans-serif family for supporting information.

Create a compact campaign-title silhouette with “9.9” as the dominant numeric element. Use a controlled dimensional edge or shadow only on the title, not on every text element.

Use one consistent rounded label system for product-specific offers. Hero labels may be larger; supporting labels must remain quieter.

PRODUCT SYSTEM
Use supplied packshots as authoritative assets. Preserve packaging, labels, proportions, cap colors, and product colors exactly.

Central hero products should be approximately 25–35% larger than supporting products. Keep all products grounded with coherent contact shadows. Maintain consistent camera height and perspective.

BACKGROUND
Use a bright cream indoor festival environment with broad blue structural arches and warm-orange curved platforms. Add only a few abstract paper streamers near the campaign title. Avoid confetti across product labels.

The background should organize the products, not become a fantasy scene.

COLOR SYSTEM
- dominant: clean cream
- brand structure: saturated family blue
- platform/support: warm orange
- main discount: controlled bright red
- secondary accents: pale yellow
- text: deep navy and white depending on contrast

Reserve the strongest red and highest contrast for the main discount only.

LIGHTING
Use bright, soft commercial studio lighting from upper-left with even product-label readability, soft platform shadows, subtle rim separation, and one consistent color temperature.

MATERIALS
Platforms use semi-matte coated material with soft edge highlights. Background arches are matte painted surfaces. Product packaging retains its real plastic, paper, glass, and cap characteristics. Avoid applying one glossy material to every object.

DENSITY CONTROL
Keep the campaign-title zone active but readable. Keep the product zone structured and grouped. Keep the bottom conversion strip simple. Leave small quiet gaps between all three bands.

ANTI-AI CONTROLS
No floating products, no parachutes, no random balloons, no excessive clouds, no product-scale inconsistencies, no different light direction per SKU, no badge on every available gap, no glow around every object, and no decorative element covering packaging.

FINAL QUALITY
Create a polished, conversion-ready retail artwork that handles dense information through modular grouping, consistent labels, scale hierarchy, and disciplined color—not by reducing necessary content or decorating every empty space.
```

