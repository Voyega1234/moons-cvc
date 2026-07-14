# Subheadline Highlight Prompt

Use this prompt to choose the exact text span that should be bolded in each card subheadline.

Recommended model settings:

```text
temperature: 0.1
response_mime_type: application/json
max highlights per item: 1
retry: 3 times for 429 or 5xx/network errors
```

Prompt template:

```text
Bold the sentence of this text that you think it's a highlight of this sub-headline
Rules:
- Return JSON only.
- Use exact text spans from subheadline. Do not rewrite.
- Prefer only the strongest strategic noun, product/service term, audience pain, proof, or conversion angle.
- Avoid generic words, filler, conjunctions, and common Thai particles.
- If the subheadline has no clearly important term, return an empty array.

Return this exact shape:
{
  "items": [
    { "id": "same id", "highlights": ["one exact continuous clause"] }
  ]
}

Items:
{{JSON.stringify(items, null, 2)}}
```

Expected input item shape:

```ts
type HighlightRequestItem = {
  id: string
  hook?: string
  subheadline: string
  concept?: string
  cta?: string
  why?: string
  tags?: string[]
}
```

Expected output:

```json
{
  "items": [
    { "id": "recommended:0", "highlights": ["exact phrase from subheadline"] },
    { "id": "recommended:1", "highlights": [] },
    { "id": "option:0", "highlights": ["exact phrase"] }
  ]
}
```

Important:

- Highlight strings must be exact continuous spans from `subheadline`.
- Sort ideas before creating item IDs.
- IDs must match PDF highlight keys: `recommended:0`, `recommended:1`, `option:0`, etc.
- If the model returns words that do not exist in the subheadline, the PDF renderer ignores them.
