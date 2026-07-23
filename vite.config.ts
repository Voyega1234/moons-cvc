import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    define: {
      "import.meta.env.SUPABASE_URL": JSON.stringify(
        env.SUPABASE_URL ?? ""
      ),
      "import.meta.env.SUPABASE_ANON_KEY": JSON.stringify(
        env.SUPABASE_ANON_KEY ?? ""
      ),
      "import.meta.env.BRAND_ASSETS_BUCKET": JSON.stringify(
        env.BRAND_ASSETS_BUCKET ?? ""
      )
    },
    build: {
      target: "es2022",
      sourcemap: true
    },
    server: {
      port: 4173,
      strictPort: true
    },
    preview: {
      port: 4173,
      strictPort: true
    },
    test: {
      environment: "jsdom",
      exclude: [...configDefaults.exclude, ".vercel/**"]
    }
  };
});
