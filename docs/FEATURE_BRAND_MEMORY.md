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

**"Upload guideline" (implemented 2026-07-10):** Brand kit's own "Upload
guideline" button was previously a permanently-disabled stub pointing users
to Documents instead. It's now real — accepts a PDF or image
(`AnalyzeGuidelineInput` in `src/ports/brand-memory-repository.ts`), uploads
it to the `brand-assets` bucket exactly like the logo upload does (signed
URL, no service-role key needed), then calls
`POST /api/analyze-brand-guideline`
(`src/server/brand-guideline/analyze-guideline-endpoint.ts`). Besides a file,
the button also accepts pasted guideline text (`AnalyzeGuidelineInput` is a
`{file}` / `{text}` union) — sent as a plain `input_text` block instead of
`input_file`/`input_image`; text input skips the Documents-tab step below
since there's no file to store. That endpoint sends the file/text straight to
the OpenAI Responses API as an `input_file` (PDF, via a `file_url` — OpenAI
extracts both text and page images server-side, no local PDF rendering
needed), `input_image` (PNG/JPEG/WEBP), or `input_text` (pasted text), and
asks `gpt-5.6-terra` (`OPENAI_GUIDELINE_ANALYSIS_MODEL`) for a short
mood/tone/style summary **in Thai** plus separate primary and secondary hex
color palettes.

The uploaded file also creates a real `moons.brand_documents` row
(`document_type: 'brand_guideline'`, same storage path convention as the
Documents tab's own upload) so it shows up in Documents too, not just Brand
kit — it starts `uploaded`, then flips to `ready_for_ai` (`usable_for_ai:
true`) once analysis succeeds, or `failed` if the analysis call errors (the
file itself is never lost either way; only the processing status changes).

The analysis result is written straight into Brand kit as three rows,
matching the existing free-form title/description model — no new columns or
migration: a `Tone & Style` rule (the Thai summary text), a `Colors` rule
(the primary palette), and a `Secondary colors` rule — each a
comma-separated hex list. If a row already exists it's updated in place; new
colors are merged into the existing list rather than replacing it, so a
second guideline upload adds to the palette instead of wiping out
manually-added swatches. Unlike other Brand kit rules (which render as
tag pills via `BrandKitTag`/`splitBrandKitTags`), `Colors` and
`Secondary colors` get a dedicated `ColorsCard` UI directly under the Logo
card: square swatches with the hex code beneath, a "×" to remove a color,
click-a-swatch-to-edit inline, and an "Add" tile to add a new one — all
backed by the same `createBrandRule`/`updateBrandRule`/`deleteBrandRule`
calls as any other rule (deleting the last color deletes the row).

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

- `moons.brand_social_posts`
- `moons.brand_ad_library_items`
- `moons.brand_visual_assets`
- `moons.runs`
- `moons.outputs`
- `moons.creative_directions`
- `moons.client_review_items`
- `moons.brand_learning`

The Brand Profile presents Facebook posts and Ads Library creatives as
reference-only Past work. Delivered Compass work remains a separate group.

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
