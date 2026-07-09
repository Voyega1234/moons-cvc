import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, hasSupabaseEnv } from "../../config/env";
import type { Database } from "./database.types";

let client: SupabaseClient<Database> | null = null;

export function isSupabaseConfigured(): boolean {
  return hasSupabaseEnv();
}

export function getSupabaseClient(): SupabaseClient<Database> {
  if (client) return client;

  const configuredEnv = env;
  if (!hasSupabaseEnv(configuredEnv)) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
    );
  }

  client = createClient<Database>(
    configuredEnv.supabaseUrl,
    configuredEnv.supabaseAnonKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  ) as SupabaseClient<Database>;

  return client;
}
