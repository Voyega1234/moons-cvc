# Hook generation contract

## Current modes

Moons supports two hook generation modes:

1. `n8n`
   - Existing behavior.
   - Frontend sends the brief to `VITE_N8N_HOOK_WEBHOOK_URL`.
   - n8n returns hook directions directly.

2. `harness`
   - Backend Hook Agent mode.
   - Frontend sends the active run context to `/api/hook-generation-harness`.
   - Backend keeps model/search API keys server-side.
   - Backend performs one direct Creative Strategist pass followed by one
     focused Subheadline-highlight pass.
   - `standard` does not attach web search and uses only supplied verified
     context.
   - `fresh-research` is the default. OpenAI attaches
     `web_search_preview`; OpenRouter attaches the top-level `web` plugin.
   - All search instructions live only in `agent_prompt/agent_hook.md`.
     Runtime code passes `Hook idea mode` as input and configures the search
     tool, but does not append a second search prompt.
   - Creative judgment such as consideration logic, content angles, Headline
     quality, and generic-versus-strong selection criteria also lives in
     `agent_prompt/agent_hook.md`. Runtime prompt builders retain only changing
     context, Research availability, schema/quotas, and format-specific
     transport contracts such as Album panel counts and UGC field presence.
   - `standard` writes directly from verified current context.
   - There is no separate research-summary or Creative-Director handoff.

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
OPENROUTER_API_KEY=<openrouter-api-key>
OPENROUTER_HOOK_GENERATION_MODEL=google/gemini-3.6-flash
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

The service request retains the full run shape, but prompt compilation sends
only Questionnaire, Brand name, Brand system, and User brief to Research. The
Hook Agent receives those same four blocks plus the completed Research dossier.
Brand Memory, Products, Documents, References, Past Posts, attachments, and
uploaded images are intentionally excluded from Hook generation.

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
- `subheadline` — optional user-facing supporting copy mapped from
  `copywriting.sub_headline_1`; the Structured Output field remains a required
  string and uses `""` when the headline already communicates the complete
  message
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
non-empty `{ id, subheadline }` to a separate structured-output call. Directions
with `subheadline: ""` skip this call and persist an empty highlight. The
generation prompt no longer selects `subheadlineHighlight`; the dedicated pass
is the single source of that decision.

The stable Highlight instructions live in:

- `agent_prompt/agent_hook_highlight.md`

The endpoint appends only the current `{ id, subheadline }` items. The prompt
selects an exact continuous span, requests
`{ items: [{ id, highlights: [...] }] }`, and the API enforces the matching
Runtime JSON Schema.

The prompt begins with:

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

The Hook Agent's stable role and judgment rules live only in:

- `agent_prompt/agent_hook.md`

It defines the Agent as a Creative Strategist that understands the brand,
product, audience, and current market; uses Search for current context;
develops meaningfully distinct, format-native ideas; and does not invent
brand or product facts.

`buildInputBlock()` appends exactly four changing business-context blocks:

- Questionnaire
- Brand name
- Brand system (`brandLibrary.brand`)
- User brief, including round-specific instructions

The completed Research dossier is appended afterward. Quota, format, and JSON
transport instructions remain separate runtime contract data. If the Brief
itself is a raw Launch Questionnaire, runtime replaces it with a short
no-current-brief notice.

OpenAI requests attach `web_search_preview` and enforce tool use with
`tool_choice: "required"`; the tool receives an approximate Thailand location.
OpenRouter requests use Chat Completions with `plugins: [{ id: "web" }]`,
`provider.require_parameters: true`, and strict JSON Schema output. Search and
evidence policy remains owned by `agent_prompt/agent_hook.md`; runtime only
announces whether Research is available for the current request.

## Topic Agent (pain-point shortlist)

Before Hook generation, a dedicated Topic Agent reads the completed Research
dossier plus the same business-context blocks the Hook Agent receives, and
returns a shortlist of 12–15 short pain points / angles with a one-line
`why` for each. Its stable role and rules live only in:

- `agent_prompt/agent_hook_topics.md`

The goal is to widen the idea pool beyond the static onboarding pain-point
bullets by prioritizing fresh Research insights and forcing spread across
the same angle categories `agent_hook.md` already defines (problem/symptom,
product+benefit, feature/number/offer, how-to/question, seasonal/occasion,
lifestyle/identity). The shortlist is appended to the Hook Agent's prompt as
an expanded idea pool, not a checklist — the Hook Agent is not required to
use every topic and may still find a stronger angle outside the list.

Output is intentionally minimal JSON (`{ topics: [{ topic, why }] }`), not
the full `hookGenerationSchema`. The step runs once per request (shared
across all generation batches) and is skipped for `researchOnly` requests,
the same way past posts are skipped there.

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
The Vercel function permits up to 900 seconds for this synchronous chain.
The browser retries once only for a malformed `502` or `503` gateway response.
It does not replay `500` or `504` responses because those can represent a full
function timeout; replaying them would duplicate the long-running model work.
Malformed-response errors report the HTTP status, content type, and available
request ID without exposing the raw response body.
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
- `src/server/hook-generation/hook-topic-agent.ts`
- `src/server/hook-generation/past-posts.ts`
- `api/hook-generation-harness.ts`
