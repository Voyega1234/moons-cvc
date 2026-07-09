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
   - Backend performs two model steps:
     1. research/search for provable Thai moments, consumer behavior, cultural
        signals, platform buzz, and category signals;
     2. generate, judge, rank, and return six hook directions.

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
OPENAI_HOOK_GENERATION_MODEL=gpt-5.5
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

## Backend response shape

```ts
type HookGenerationHarnessResponse = {
  directions: {
    id: string;
    hook: string;
    concept: string;
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
- `hook`
- `concept`
- `why`
- `visual`
- `cta`
- `caption`
- `selected`

`score`, `reasoning`, and `citations` are returned by the backend for future UI
work but are not persisted in `CreativeDirection` yet.

## Prompt source

The harness prompt is adapted from:

- `agent_prompt/agent_hook.md`
- `agent_prompt/agent_seasonal.md`

The n8n placeholders from those files are replaced with the current Moons run
context:

- user brief
- selected service
- selected output quantity
- Brand Kit
- Products
- Documents
- References
- Brand Memory working/avoid notes
- attachment file names

The research step keeps the same discipline as `agent_seasonal.md`: it is
research-only and must not invent hooks, captions, content ideas, source names,
rankings, statistics, or trend names.

The generation step keeps the same discipline as `agent_hook.md`: the hook is
the most important output, must be natural Thai, brand-native, and useful for
paid social.

## Current limitation

Harness mode is synchronous. It performs research and generation in one backend
request. This is enough for v1 UI wiring, but production-scale orchestration
should move it to the `moons.jobs` model so the UI can show progress such as:

- `Researching references...`
- `Generating hook candidates...`
- `Ranking shortlist...`

## Files

- `src/features/workflow/use-generate-hooks.ts`
- `src/services/creative-generation/n8n-hook-generation.ts`
- `src/services/creative-generation/harness-hook-generation.ts`
- `src/services/creative-generation/hook-generation-types.ts`
- `src/server/hook-generation/hook-generation-harness-endpoint.ts`
- `api/hook-generation-harness.ts`
