# Artwork generation contract

## Purpose

When the user clicks `Create selected hooks`, Moons should generate artwork for
the hooks selected in the Hook step.

The frontend must not call OpenAI directly because `OPENAI_API_KEY` must stay on
the backend. The frontend calls the configured backend endpoint instead.

## Frontend env

```text
VITE_ARTWORK_GENERATION_ENDPOINT=
```

If this value is empty, the app keeps the prototype flow working by creating
draft output cards without generated assets.

When Supabase auth is available, the frontend sends the current Supabase access
token as `Authorization: Bearer <token>` so the backend can write storage/DB
through normal user-scoped policies or verify the user before using a service
role.

## Backend model

Use OpenAI image model:

```text
gpt-image-2
```

Official guide:

```text
https://developers.openai.com/api/docs/guides/image-generation#generate-images
```

## Request shape

Frontend sends:

```ts
type ArtworkGenerationRequest = {
  model: "gpt-image-2";
  runId: string;
  brand: {
    id: string;
    name: string;
    category: string;
  } | null;
  service: "single-static" | "album-post" | "motion-static" | "resize" | "ugc-video";
  quantity: number;
  brief: string;
  selectedHooks: {
    id: string;
    hook: string;
    concept: string;
    visual: string;
    caption: string;
  }[];
  textInputs: string[];
  referenceImages: (
    | { kind: "url"; url: string; label?: string; mediaType?: string }
    | { kind: "base64"; data: string; mediaType: string; label?: string }
    | { kind: "openai_file"; fileId: string; label?: string }
  )[];
  output: {
    size: "1024x1024";
    format: "png";
  };
};
```

## Response shape

Backend must return:

```ts
type ArtworkGenerationResponse = {
  outputs: {
    id: string;
    directionId: string;
    format: string;
    status: "draft" | "needs-revision" | "ready" | "fixed";
    clientStatus: "queued" | "sent" | "revision" | "approved";
    assetUrl?: string;
    assetStoragePath?: string;
    assetBucket?: "creative-assets";
    provider?: "openai";
    model?: "gpt-image-2";
    revisionCount: number;
  }[];
};
```

`assetUrl` must point to a persisted image URL, preferably a signed Supabase
Storage URL. Do not return a temporary base64 image to the frontend as the final
asset. Also return `assetStoragePath` and `assetBucket` so Moons can refresh
signed URLs later without regenerating images.

## Storage and database persistence

Use the private Supabase Storage bucket:

```text
creative-assets
```

Recommended object path:

```text
{clientId}/{runId}/outputs/{directionId}-{version}.png
```

Backend flow:

1. Receive selected hooks and brief from the frontend.
2. Call OpenAI `gpt-image-2`.
3. Decode the image result server-side.
4. Upload the image file to Supabase Storage bucket `creative-assets`.
5. Insert or upsert `moons.outputs` rows with:
   - `run_id`
   - `direction_id`
   - `format`
   - `status`
   - `client_status`
   - `asset_url` as a signed URL or public delivery URL
   - `asset_bucket = 'creative-assets'`
   - `asset_storage_path`
   - `provider = 'openai'`
   - `model = 'gpt-image-2'`
   - `payload` for prompt/version metadata only, not base64 image data
6. Return the output rows to the frontend.

Required migration:

```text
supabase/migrations/202606260008_creative_asset_storage.sql
```

## Input handling

- `brief` is the user's Brief step text.
- `selectedHooks` are the hooks selected in Shortlist hooks.
- `textInputs` is for extra prompt context added later.
- `referenceImages` supports URL, base64 image payload, or an OpenAI file id.
  Base64 is allowed only as inbound reference input. It must not be stored as
  the generated output.

Backend implementation can choose:

- image generation when only text is provided;
- image edit or multimodal flow when reference images are provided.

## Current frontend files

- `src/features/workflow/use-create-selected-hooks.ts`
- `src/services/artwork-generation/openai-image-generation.ts`
- `src/features/workflow/stages.tsx`
