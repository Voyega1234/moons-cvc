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
   - Backend performs three steps when no past content exists, or five when it
     does:
     1. a Past Content Profiler extracts style signals, abstract creative
        patterns, and reusable factual details while discarding old Hooks,
        Concepts, campaign angles, and wording;
     2. the GPT-5.6 Candidate Agent searches, then creates a lightweight pool
        of three candidates per requested direction (at least four per content
        type, capped at 36 per batch);
     3. a separate Creative Director compares the complete pool, rejects
        generic or repetitive candidates, and expands only the winners into
        full directions;
     4. when past posts exist, a Caption Stylist rewrites only the locked
        direction's `caption` and verified recurring `contactLine`;
     5. a support-model pass selects exact Subheadline highlight spans.
   - Both idea modes require at least one web search in every Candidate
     generation batch. The OpenAI request enforces this with
     `tool_choice: "required"`.
   - `standard` performs a focused current-context check before writing.
   - `fresh-research` tells the same Candidate Agent to run multiple focused
     searches before ideation. There is no separate research-summary handoff;
     researched candidates go directly to the Creative Director.

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
    sourceCandidateId: string; // exact candidate selected by Creative Director
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

`sourceCandidateId`, `score`, `reasoning`, and `citations` are returned by the
backend for traceability/future UI work but are not persisted in
`CreativeDirection` yet.

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

The Hook Agent's stable role and judgment rules live in:

- `agent_prompt/agent_hook.md`

The file is intentionally concise. It defines the Agent as a Creative
Strategist that understands the brand, product, audience, and current market;
uses Search for current context; develops meaningfully distinct,
format-native ideas; and does not invent brand or product facts.

`buildGenerationPrompt()` appends only the changing runtime context and
transport contract:

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
- the selected format rules and strict JSON output quota

The OpenAI request gives the Candidate Agent `web_search_preview` directly and
enforces at least one search with `tool_choice: "required"`. The tool receives
an approximate Thailand location (`country: "TH"`, timezone
`Asia/Bangkok`). Unless the Brief names another market, the prompt requires
Thai-language queries and Thailand-specific sources first; US/global consumer
behavior cannot substitute for Thai audience context. Search may add audience
insight or market context, but Brief, Brand Memory, Brand Kit, and verified
Product data remain higher-priority. Any direction influenced by external
research names the actual source in `citations`; directions based only on
campaign input return an empty citation list.

## Caption grounding in real past posts

`fetchPastPostExamples()` (`src/server/hook-generation/past-posts.ts`) queries
the brand's real `moons.brand_social_posts` and
`moons.brand_ad_library_items` rows. Raw past posts go first to a Past Content
Profiler, which returns only `styleSignals` plus factual `reusableDetails` with
source-post indexes. It explicitly removes old Hooks, Concepts, campaign
angles, and time-sensitive prices or promotions not confirmed by current
input. The Hook Agent receives this compact profile, never the raw posts, so
it can reuse brand mood, voice, caption patterns, product/service details,
proof, process, and contact information without being anchored to an old
creative idea. The Profiler reads at most 12 examples: up to six ad captions
plus six organic posts. Within each source it keeps the newest half and samples
the rest across the available history, so brand memory covers both current
voice and a wider range of proven creative patterns. The smaller Caption
Stylist sample remains recent-first because its job is current writing texture.

`styleSignals` includes brand-specific creative language mechanisms—not only
generic tone labels—including rhythm, rhyme, wordplay, bilingual slogans,
brand declarations, humorous comparisons, premium statements, and recurring
CTA texture when those patterns exist. `creativePatterns` separately preserves
abstract, brand-native ways of thinking—such as visual proof, useful education,
expert warning, occasion ritual, identity listicle, social proof, or brand
belief—without preserving the old topic, product, scene, punchline, or campaign
angle. The Candidate Agent can reuse the mechanism without copying the old
idea.

The divergent candidate pass varies content archetype, primary benefit,
emotional entry, and language device before any full caption or production
brief is written. The convergent Creative Director then compares candidates as
a set. It rejects generic hooks, hooks that need explanation, wordplay without
a useful idea, and candidates that repeat a selected benefit, pattern, or
sentence template. Scores are relative to the pool instead of being treated as
independent self-scores.

Thai copy has a hard naturalness rule: generated Hooks, directions, UGC scripts,
and styled captions may not use `ฉัน`. The Agent should omit the subject or
rewrite the sentence as natural spoken Thai, using `เรา` only when it genuinely
fits the context rather than as a mechanical replacement. Candidate,
Creative-Director, and Caption-Stylist outputs are checked server-side; a
violating response gets one correction pass and is rejected if it still
contains the forbidden wording.

After directions are locked, a separate Caption Stylist receives the locked
directions, the compact profile, and at most six raw style examples,
preferring up to four ad captions plus two organic posts. It may rewrite
`caption` and `contactLine` only; Hook, Concept, Product, Visual, and strategy
remain unchanged. The server accepts a contact line only when the exact text
appears in at least two selected examples. If no history exists, both
past-content passes are skipped and the Hook Agent's Brand Kit-grounded
caption draft is preserved.

## Current limitation

Harness mode is synchronous. Past-content profiling happens first when
history exists. Search and divergent candidate generation happen in one
GPT-5.6 call; a second GPT-5.6 Creative Director call selects and expands the
winners, followed by the optional Caption Stylist and Subheadline highlight
passes.
This is enough for current UI wiring, but production-scale orchestration could
move it to the `moons.jobs` model so the UI can show progress such as:

- `Searching and generating hook candidates...`
- `Ranking shortlist...`

Local development writes one combined trace to `logs/hook-generation/` with
separate `candidateAgent` and `hookAgent` (Creative Director) requests and
responses, the exact prompts, Candidate Agent search tools, attached-image
metadata, optional Past Content Profiler and Caption Stylist traces, parsed
directions, and final response. Vercel Preview and Production disable this
logging at the API boundary.

## Files

- `src/features/workflow/use-generate-hooks.ts` — `useGenerateHooks` (initial
  generation) and `useGenerateMoreHooks` (append, duplicate-avoiding)
- `src/services/creative-generation/n8n-hook-generation.ts`
- `src/services/creative-generation/harness-hook-generation.ts`
- `src/services/creative-generation/hook-generation-types.ts`
- `src/server/hook-generation/hook-generation-harness-endpoint.ts`
- `src/server/hook-generation/hook-generation-debug-log.ts`
- `src/server/hook-generation/past-posts.ts`
- `api/hook-generation-harness.ts`
