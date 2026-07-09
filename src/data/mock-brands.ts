import type { Brand } from "../domain/brand";
import { slugify } from "../shared/utils/text";

type SeedItem = readonly [title: string, description: string];

const item = ([title, description]: SeedItem, index: number) => ({
  id: `${slugify(title)}-${index}`,
  title,
  description
});

function brand(
  id: string,
  name: string,
  category: string,
  initials: string,
  library: {
    brand: readonly SeedItem[];
    products: readonly SeedItem[];
    docs: readonly SeedItem[];
    refs: readonly SeedItem[];
  },
  memory: Brand["memory"] = { working: [], avoid: [] }
): Brand {
  return {
    id,
    name,
    category,
    initials,
    library: {
      brand: library.brand.map(item),
      products: library.products.map(item),
      docs: library.docs.map(item),
      refs: library.refs.map(item)
    },
    memory
  };
}

export const brands: readonly Brand[] = [
  brand(
    "bonefit",
    "BoneFit",
    "Health supplement",
    "BF",
    {
      brand: [
        ["Logo", "Primary and mono marks ready"],
        ["Guideline", "Premium, clean, evidence-led"],
        ["CI rules", "White space, soft blue, rounded product frame"],
        ["Words", "support, routine, comfort, premium"]
      ],
      products: [
        ["Posture support", "Hero product for workday comfort"],
        ["Travel kit", "Bundle for on-the-go routine"],
        ["Workday bundle", "Hot offer for office audience"],
        ["Ingredient sheet", "Claims must stay support-led"]
      ],
      docs: [
        ["Brand guideline.pdf", "Approved by client"],
        ["Product factsheet.pdf", "Use for claim safety"],
        ["Promo brief.docx", "Monthly offer details"],
        ["Past winner notes", "High trust angle worked best"]
      ],
      refs: [
        ["Soft product hero", "Clean product foreground"],
        ["Routine lifestyle", "Desk, travel, morning routine"],
        ["Proof card", "Compact benefit points"],
        ["Avoid", "Medical cure or instant-fix tone"]
      ]
    },
    {
      working: [
        "UGC testimonial hooks beat studio polish",
        "Gut-health proof in the first 3 seconds",
        "Problem to relief story arc"
      ],
      avoid: [
        "Clinical jargon up front",
        "Busy packshot backgrounds",
        "Generic Shop-now CTAs"
      ]
    }
  ),
  brand("aklass", "A Klass Auto", "Automotive", "AK", {
    brand: [["Guideline", "Trust, transparent, premium"]],
    products: [["SUV campaign", "High intent family audience"]],
    docs: [["Vehicle checklist.pdf", "Use as proof source"]],
    refs: [["Editorial showroom", "Premium photography"]]
  }),
  brand("jim", "Jim Thompson", "Fashion & lifestyle", "JT", {
    brand: [["Guideline", "Elegant, restrained, modern luxury"]],
    products: [["Silk scarf", "Giftable hero"]],
    docs: [["Collection brief.pdf", "Seasonal key message"]],
    refs: [["Editorial model", "Luxury fashion tone"]]
  }),
  brand("thaya", "Thaya", "Thai craft / home", "TH", {
    brand: [["Guideline", "Warm, artisanal, earthy"]],
    products: [["Incense set", "Hero gift bundle"]],
    docs: [["Brand guideline.pdf", "Approved"]],
    refs: [["Warm lifestyle", "Natural light, wood tones"]]
  }),
  brand("flora", "Flora Daily", "Flowers / lifestyle", "FD", {
    brand: [["Guideline", "Fresh, soft, feminine"]],
    products: [["Weekly bouquet", "Subscription hero"]],
    docs: [["Promo brief.docx", "Weekly drop"]],
    refs: [["Soft pastel hero", "Bright airy scenes"]]
  }),
  brand("sora", "Sora Home", "Home / furniture", "SH", {
    brand: [["Guideline", "Minimal, calm, Japandi"]],
    products: [["Sofa", "Hero living piece"]],
    docs: [["Brand guideline.pdf", "Approved"]],
    refs: [["Clean interior", "Neutral tones, soft light"]]
  }),
  brand("brewbite", "BrewBite", "Coffee / cafe", "BB", {
    brand: [["Guideline", "Bold, friendly, urban"]],
    products: [["Signature roast", "Hero bag"]],
    docs: [["Promo brief.docx", "Weekly combo"]],
    refs: [["Cafe lifestyle", "Warm cafe scenes"]]
  }),
  brand("peakrun", "PeakRun", "Running / sportswear", "PR", {
    brand: [["Guideline", "Energetic, bold, performance"]],
    products: [["Race shoe", "Hero performance"]],
    docs: [["Promo brief.docx", "Launch drop"]],
    refs: [["Motion action", "High-energy outdoor"]]
  }),
  brand("lumiere", "Lumiere Skin", "Skincare", "LS", {
    brand: [["Guideline", "Premium, clean, glow"]],
    products: [["Serum", "Hero glow product"]],
    docs: [["Claim sheet", "Keep claims gentle"]],
    refs: [["Soft glow hero", "Dewy clean look"]]
  }),
  brand("novakids", "Nova Kids", "Kids / education", "NK", {
    brand: [["Guideline", "Friendly, bright, safe"]],
    products: [["Activity box", "Hero subscription"]],
    docs: [["Promo brief.docx", "Term promo"]],
    refs: [["Bright playful", "Colorful safe scenes"]]
  })
];
