# Brand Memory feature contract

## Purpose

Brand Memory stores the reusable source material Moons uses for:

- hooks
- artwork
- captions
- QA
- delivered-run learning

Start should only preview and open Brand Profile. It should not become a heavy
upload workspace.

## UI structure

Brand Profile is opened from Start with `Open brand profile`.

Sections:

1. Brand kit
2. Products
3. Documents
4. References
5. Past work

Current UI state:

- A Brand Profile panel exists in Start.
- Brand kit rules can be added, edited, and deleted.
- Documents upload is wired for v1.
- Product, Reference, and Past work write actions are still disabled
  until their save adapters are implemented.

## Database mapping

### Brand kit

Current source:

```text
moons.brand_library section='brand'
```

Use for voice, CI rules, claim rules, approved words, banned words, and brand
guideline summaries.

Brand kit writes require:

```text
supabase/migrations/202606240007_brand_library_writes.sql
```

Guideline files should still be uploaded through Documents with document type
`brand_guideline`; Brand kit itself stores structured text rules.

### Products

Production table:

```text
moons.brand_products
```

Use for structured product/service data:

- name
- description
- key_benefit
- audience
- offer
- price
- landing_url
- claim_notes
- is_active

### Documents

Production table:

```text
moons.brand_documents
```

Documents must have processing state:

- `uploaded`
- `processing`
- `ready_for_ai`
- `failed`

Do not mark uploads as AI-usable until text extraction/processing succeeds.

Documents must also have a business document type selected before upload:

- `brand_guideline` — brand book, voice, CI, claim guardrails
- `product_factsheet` — offer, SKU, pricing, benefits, product specs
- `campaign_brief` — campaign-specific brief/input
- `claim_support` — compliance proof, claim evidence, allowed wording
- `reference` — visual/style/reference document
- `report` — past performance or learning report
- `other` — temporary fallback when the document does not fit yet

Supported upload file formats in v1 are PDF, Word, CSV, text, PNG, JPEG, WebP,
and GIF. The file format is separate from `document_type`; `document_type`
describes why the document exists and how AI should use it later.

### References

Production table:

```text
moons.brand_references
```

Reference types:

- `inspiration`
- `avoid`
- `competitor`
- `past_winner`
- `other`

### Past work

Past work should be derived from delivered runs, not manually entered as brand
library data.

Expected sources:

- `moons.runs`
- `moons.outputs`
- `moons.creative_directions`
- `moons.client_review_items`
- `moons.brand_learning`

## Migration

Apply after the production backbone migrations:

```text
supabase/migrations/202606240004_brand_memory.sql
supabase/migrations/202606240005_brand_asset_storage.sql
```

The v1 upload bucket is:

```text
brand-assets
```

Override with `VITE_BRAND_ASSETS_BUCKET` only if the Supabase bucket uses a
different name.

## Next implementation slice

Recommended next work:

1. Wire Brand Profile save actions to `moons.brand_products`,
   `moons.brand_documents`, and `moons.brand_references`.
2. Add document text extraction job through `moons.jobs`.
3. Show processing states beyond initial `uploaded`.
4. Add signed download/preview URLs for private files.

Keep the Start step focused on choosing a client. Brand Profile owns memory
management.
