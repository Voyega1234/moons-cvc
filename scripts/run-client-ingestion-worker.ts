import { runClientIngestionWorkerOnce } from "../src/server/client-ingestion/client-ingestion-worker";

try {
  const result = await runClientIngestionWorkerOnce({
    env: {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      APIFY_TOKEN: process.env.APIFY_TOKEN,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_BRAND_ANALYSIS_MODEL: process.env.OPENAI_BRAND_ANALYSIS_MODEL,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GEMINI_GROUNDING_MODEL: process.env.GEMINI_GROUNDING_MODEL
    }
  });

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify(readableError(error), null, 2));
  process.exitCode = 1;
}

function readableError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      cause: error.cause
    };
  }

  return error;
}
