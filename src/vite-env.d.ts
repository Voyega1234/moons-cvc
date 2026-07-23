/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_ANON_KEY?: string;
  readonly BRAND_ASSETS_BUCKET?: string;
  readonly VITE_GOOGLE_OAUTH_CLIENT_ID?: string;
}
