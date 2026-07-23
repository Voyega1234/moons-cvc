# Hook generation contract

## Current modes

Moons supports two hook generation modes:

1. `n8n`
   - Existing behavior.
   - Frontend sends the brief to `VITE_N8N_HOOK_WEBHOOK_URL`.
   - n8n returns hook directions directly.

2. `harness`
   - New backend harness mode.
   - Frontend sends the active run context to `/api/hook-generation-harness`.
   - Backend keeps model/search API keys server-side.
   - Backend performs three model steps:
     1. research/search for provable Thai moments, consumer behavior, cultural
        signals, platform buzz, and category signals;
     2. generate, judge, and rank the requested hook directions;
     3. select exact Subheadline highlight spans in one dedicated batch pass.

Switch modes with:

```bash
VITE_HOOK_GENERATION_MODE=n8n
VITE_HOOK_GENERATION_MODE=harness
VITE_HOOK_GENERATION_HARNESS_ENDPOINT=/api/hook-generation-harness
```

If `VITE_HOOK_GENERATION_MODE` is omitted, Moons uses `n8n` to preserve the
existing prototype flow.

## Backend secrets

Harness mode requires backend-only env:

```bash
OPENAI_API_KEY=<openai-api-key>
OPENAI_HOOK_GENERATION_MODEL=gpt-5.6-terra
SUPABASE_URL=<project-url>
SUPABASE_ANON_KEY=<anon-key>
```

Do not expose `OPENAI_API_KEY` through `VITE_*` env.

If `SUPABASE_URL` and `SUPABASE_ANON_KEY` are present on the backend, the
harness endpoint validates the incoming `Authorization: Bearer <supabase-access-token>`
header and only allows Convert Cake users:

- `app_metadata.organization = "convert_cake"`, or
- email ending in `@convertcake.com`

If those Supabase env values are absent, the endpoint allows local isolated
development calls. Do not deploy it that way.

## Frontend request shape

The frontend builds the request from the active run:

```ts
type HookGenerationHarnessRequest = {
  runId: string;
  brand: {
    id: string;
    name: string;
    category: string;
  } | null;
  service: "single-static" | "album-post" | "motion-static" | "resize" | "ugc-video";
  quantity: number;
  brief: string;
  onboardingQuestionnaire: string; // historical onboarding context only
  extraInstructions: string;
  existingHooks: { hook: string; concept: string }[];
  attachments: string[];
  brandMemory: {
    working: string[];
    avoid: string[];
  };
  brandLibrary: {
    brand: { title: string; description: string }[];
    products: { title: string; description: string }[];
    docs: { title: string; description: string }[];
    refs: { title: string; description: string }[];
  };
};
```

The request intentionally includes Brand Kit, Products, Documents, References,
and learning so the hook agent can use the same context visible in the UI.

## Generate more (implemented 2026-07-10)

The Hook step's "Regenerate all" button — which discarded every hook and
replaced them — is gone. In its place: an "Add more direction for this round
(optional)" input plus a "Generate more" button
(`DirectionsStage`/`useGenerateMoreHooks` in `src/features/workflow/`).

Dispatches a new `generate-more-directions` action instead of
`generate-directions` — the reducer appends the returned batch to
`state.directions` rather than replacing it (`reducer.ts`). Since the model
can independently produce ids like `direction-1` in two separate calls, the
reducer reassigns any id that collides with an existing direction
(`createId("direction")`) before appending, so nothing is silently
overwritten.

Two things travel with the request to keep the new batch actually new:

- `extraInstructions` — whatever the user typed in the optional input,
  merged into the prompt as "Additional direction for this round — HIGH
  PRIORITY, on top of the brief above", separate from (and layered on top
  of) the original brief text, which stays unchanged in `state.brief`.
- `existingHooks` — every hook + concept already generated in this run
  (`state.directions`, both from the first generation and any prior
  "Generate more" round), sent as an explicit "do not repeat these" list in
  the prompt (see `buildInputBlock` in `hook-generation-harness-endpoint.ts`).

Both fields are threaded through the n8n path too
(`generateDirectionsFromWebhook`, nested under `brief.extraInstructions`/
`brief.existingHooks`) on a best-effort basis — n8n workflows aren't
guaranteed to use them, but the data is there if the flow is updated to.

## Backend response shape

```ts
type HookGenerationHarnessResponse = {
  directions: {
    id: string;
    service: ServiceType;
    hook: string;
    subheadline: string;
    concept: string;
    subheadlineHighlight: string;
    why: string;
    visual: string;
    cta: string;
    caption: string;
    score?: number;
    reasoning?: string;
    citations?: string[];
  }[];
};
```

The UI currently persists:

- `id`
- `service`
- `hook`
- `subheadline` — concise user-facing supporting copy mapped from
  `copywriting.sub_headline_1`
- `concept`
- `subheadlineHighlight` — exact phrase inside `subheadline` used for bold
  emphasis on screen and in PDF export
- `why`
- `visual`
- `cta`
- `caption`
- `selected`

`score`, `reasoning`, and `citations` are returned by the backend for future UI
work but are not persisted in `CreativeDirection` yet.

## Subheadline highlight pass

After direction generation finishes, the harness sends every generated
`{ id, subheadline }` to a separate structured-output call. The generation
prompt no longer selects `subheadlineHighlight`; the dedicated pass is the
single source of that decision.

The runtime prompt is the stakeholder-supplied prompt beginning with:

```text
Bold the sentence of this text that you think it's a highlight of this sub-headline
Rules:
- Return JSON only.
- Use exact text spans from subheadline. Do not rewrite.
- Prefer only the strongest strategic noun, product/service term, audience pain, proof, or conversion angle.
- Avoid generic words, filler, conjunctions, and common Thai particles.
- If the subheadline has no clearly important term, return an empty array.
```

It requests `{ items: [{ id, highlights: [...] }] }` and appends the generated
items with `JSON.stringify(items, null, 2)`. The schema permits zero or one
highlight per item. The server accepts only an exact continuous span found in
the matching Subheadline. Rewritten or invalid phrases become `""`, and an
empty `highlights` array remains intentionally unbolded in the Angle card,
workspace persistence, regeneration flow, and PDF export. Only legacy saved
data where the highlight field is absent uses the deterministic fallback.

## Prompt source

The harness prompt is adapted from:

- `agent_prompt/agent_hook.md`
- `agent_prompt/agent_seasonal.md`

The n8n placeholders from those files are replaced with the current Compass run
context:

- user brief
- selected service
- selected output quantity
- Brand Kit
- Products
- Documents
- References
- Brand Memory working/avoid notes
- onboarding questionnaire text, explicitly marked as historical onboarding
  context rather than a current campaign brief
- attachment file names

The research step keeps the same discipline as `agent_seasonal.md`: it is
research-only and must not invent hooks, captions, content ideas, source names,
rankings, statistics, or trend names.

The generation step keeps the same discipline as `agent_hook.md`: the hook is
the most important output, must be natural Thai, brand-native, and useful for
paid social.

**`agent_hook.md` was substantially rewritten on 2026-07-10** — new output
schema (`recommendations[]` with `content_type` quotas across STATIC AD /
VIDEO AD / ALBUM AD / SHORT VIDEO, plus `audience_insight`, `strategic_angle`,
`content_pillar`, and a `copywriting` sub-object with `sub_headline_1/2` and
`bullets[]`), a much longer set of concrete rules, and no more n8n example
content baked in. Decision (2026-07-10): **adapt, don't adopt wholesale.**
`buildGenerationPrompt` absorbed the new file's stronger creative-strategy
language — content locked to single-image (STATIC AD) behavior, factual
grounding, concept strategy (audience insight → strategic angle → headline),
the concrete headline avoid-list, and the mood-only visual-direction rule —
but the request/response schema and `RawDirection`/`CreativeDirection` shape
were deliberately left unchanged. The new file's `content_type` quota system
(mixing video/album/short-video recommendations) was **not** adopted: Moons'
artwork generation only produces static images via `gpt-image-2` (see
`docs/FEATURE_ARTWORK_GENERATION.md`), so quota'd video/album recommendations
would have nowhere to go. Revisit this if/when video or album generation gets
built — until then every hook is generated as if it were a STATIC AD.

## Caption grounding in real past posts

The generation step's caption instructions ("Caption ต้อง:" in the prompt
built by `buildGenerationPrompt`) tell the model to write in the voice of an
actual copywriter for the page, not to write a generic caption. To make that
concrete rather than aspirational, `fetchPastPostExamples()`
(`src/server/hook-generation/past-posts.ts`) queries the brand's real
`moons.brand_social_posts` and `moons.brand_ad_library_items` rows for past
caption text and includes a sample directly in the prompt as style
reference. Falls back to Brand Kit voice notes alone if a brand has no
ingested post history yet (new clients, or ingestion not yet run).

## Current limitation

Harness mode is synchronous. It performs research and generation in one backend
request. This is enough for v1 UI wiring, but production-scale orchestration
should move it to the `moons.jobs` model so the UI can show progress such as:

- `Researching references...`
- `Generating hook candidates...`
- `Ranking shortlist...`

## Files

- `src/features/workflow/use-generate-hooks.ts` — `useGenerateHooks` (initial
  generation) and `useGenerateMoreHooks` (append, duplicate-avoiding)
- `src/services/creative-generation/n8n-hook-generation.ts`
- `src/services/creative-generation/harness-hook-generation.ts`
- `src/services/creative-generation/hook-generation-types.ts`
- `src/server/hook-generation/hook-generation-harness-endpoint.ts`
- `src/server/hook-generation/past-posts.ts`
- `api/hook-generation-harness.ts`
