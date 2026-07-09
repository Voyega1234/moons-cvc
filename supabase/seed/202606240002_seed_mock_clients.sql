insert into moons.clients (id, name, category, initials, source)
values
  ('bonefit', 'BoneFit', 'Health supplement', 'BF', 'prototype-seed'),
  ('aklass', 'A Klass Auto', 'Automotive', 'AK', 'prototype-seed'),
  ('jim', 'Jim Thompson', 'Fashion & lifestyle', 'JT', 'prototype-seed'),
  ('thaya', 'Thaya', 'Thai craft / home', 'TH', 'prototype-seed'),
  ('flora', 'Flora Daily', 'Flowers / lifestyle', 'FD', 'prototype-seed'),
  ('sora', 'Sora Home', 'Home / furniture', 'SH', 'prototype-seed'),
  ('brewbite', 'BrewBite', 'Coffee / cafe', 'BB', 'prototype-seed'),
  ('peakrun', 'PeakRun', 'Running / sportswear', 'PR', 'prototype-seed'),
  ('lumiere', 'Lumiere Skin', 'Skincare', 'LS', 'prototype-seed'),
  ('novakids', 'Nova Kids', 'Kids / education', 'NK', 'prototype-seed')
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  initials = excluded.initials,
  source = excluded.source,
  is_active = true;

with library_seed (client_id, section, title, description, sort_order) as (
  values
    ('bonefit', 'brand', 'Logo', 'Primary and mono marks ready', 10),
    ('bonefit', 'brand', 'Guideline', 'Premium, clean, evidence-led', 20),
    ('bonefit', 'brand', 'CI rules', 'White space, soft blue, rounded product frame', 30),
    ('bonefit', 'brand', 'Words', 'support, routine, comfort, premium', 40),
    ('bonefit', 'products', 'Posture support', 'Hero product for workday comfort', 10),
    ('bonefit', 'products', 'Travel kit', 'Bundle for on-the-go routine', 20),
    ('bonefit', 'products', 'Workday bundle', 'Hot offer for office audience', 30),
    ('bonefit', 'products', 'Ingredient sheet', 'Claims must stay support-led', 40),
    ('bonefit', 'docs', 'Brand guideline.pdf', 'Approved by client', 10),
    ('bonefit', 'docs', 'Product factsheet.pdf', 'Use for claim safety', 20),
    ('bonefit', 'docs', 'Promo brief.docx', 'Monthly offer details', 30),
    ('bonefit', 'docs', 'Past winner notes', 'High trust angle worked best', 40),
    ('bonefit', 'refs', 'Soft product hero', 'Clean product foreground', 10),
    ('bonefit', 'refs', 'Routine lifestyle', 'Desk, travel, morning routine', 20),
    ('bonefit', 'refs', 'Proof card', 'Compact benefit points', 30),
    ('bonefit', 'refs', 'Avoid', 'Medical cure or instant-fix tone', 40),
    ('aklass', 'brand', 'Guideline', 'Trust, transparent, premium', 10),
    ('aklass', 'products', 'SUV campaign', 'High intent family audience', 10),
    ('aklass', 'docs', 'Vehicle checklist.pdf', 'Use as proof source', 10),
    ('aklass', 'refs', 'Editorial showroom', 'Premium photography', 10),
    ('jim', 'brand', 'Guideline', 'Elegant, restrained, modern luxury', 10),
    ('jim', 'products', 'Silk scarf', 'Giftable hero', 10),
    ('jim', 'docs', 'Collection brief.pdf', 'Seasonal key message', 10),
    ('jim', 'refs', 'Editorial model', 'Luxury fashion tone', 10),
    ('thaya', 'brand', 'Guideline', 'Warm, artisanal, earthy', 10),
    ('thaya', 'products', 'Incense set', 'Hero gift bundle', 10),
    ('thaya', 'docs', 'Brand guideline.pdf', 'Approved', 10),
    ('thaya', 'refs', 'Warm lifestyle', 'Natural light, wood tones', 10),
    ('flora', 'brand', 'Guideline', 'Fresh, soft, feminine', 10),
    ('flora', 'products', 'Weekly bouquet', 'Subscription hero', 10),
    ('flora', 'docs', 'Promo brief.docx', 'Weekly drop', 10),
    ('flora', 'refs', 'Soft pastel hero', 'Bright airy scenes', 10),
    ('sora', 'brand', 'Guideline', 'Minimal, calm, Japandi', 10),
    ('sora', 'products', 'Sofa', 'Hero living piece', 10),
    ('sora', 'docs', 'Brand guideline.pdf', 'Approved', 10),
    ('sora', 'refs', 'Clean interior', 'Neutral tones, soft light', 10),
    ('brewbite', 'brand', 'Guideline', 'Bold, friendly, urban', 10),
    ('brewbite', 'products', 'Signature roast', 'Hero bag', 10),
    ('brewbite', 'docs', 'Promo brief.docx', 'Weekly combo', 10),
    ('brewbite', 'refs', 'Cafe lifestyle', 'Warm cafe scenes', 10),
    ('peakrun', 'brand', 'Guideline', 'Energetic, bold, performance', 10),
    ('peakrun', 'products', 'Race shoe', 'Hero performance', 10),
    ('peakrun', 'docs', 'Promo brief.docx', 'Launch drop', 10),
    ('peakrun', 'refs', 'Motion action', 'High-energy outdoor', 10),
    ('lumiere', 'brand', 'Guideline', 'Premium, clean, glow', 10),
    ('lumiere', 'products', 'Serum', 'Hero glow product', 10),
    ('lumiere', 'docs', 'Claim sheet', 'Keep claims gentle', 10),
    ('lumiere', 'refs', 'Soft glow hero', 'Dewy clean look', 10),
    ('novakids', 'brand', 'Guideline', 'Friendly, bright, safe', 10),
    ('novakids', 'products', 'Activity box', 'Hero subscription', 10),
    ('novakids', 'docs', 'Promo brief.docx', 'Term promo', 10),
    ('novakids', 'refs', 'Bright playful', 'Colorful safe scenes', 10)
)
insert into moons.brand_library (client_id, section, title, description, sort_order)
select client_id, section, title, description, sort_order
from library_seed
where not exists (
  select 1
  from moons.brand_library existing
  where existing.client_id = library_seed.client_id
    and existing.section = library_seed.section
    and existing.title = library_seed.title
);

with learning_seed (client_id, polarity, note) as (
  values
    ('bonefit', 'working', 'UGC testimonial hooks beat studio polish'),
    ('bonefit', 'working', 'Gut-health proof in the first 3 seconds'),
    ('bonefit', 'working', 'Problem to relief story arc'),
    ('bonefit', 'avoid', 'Clinical jargon up front'),
    ('bonefit', 'avoid', 'Busy packshot backgrounds'),
    ('bonefit', 'avoid', 'Generic Shop-now CTAs')
)
insert into moons.brand_learning (client_id, polarity, note)
select client_id, polarity, note
from learning_seed
where not exists (
  select 1
  from moons.brand_learning existing
  where existing.client_id = learning_seed.client_id
    and existing.polarity = learning_seed.polarity
    and existing.note = learning_seed.note
);
