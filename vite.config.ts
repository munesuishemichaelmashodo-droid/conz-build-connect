// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.

import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  nitro: {
    preset: "vercel",
    // Nitro leaves these as runtime imports and its file tracing does not copy
    // `tslib` (a transitive dep of @supabase/functions-js) into the serverless
    // bundle, causing ERR_MODULE_NOT_FOUND at boot and a 500 on every route.
    // Inlining bundles them into the server output instead.
    externals: {
      inline: [
        "tslib",
        "@supabase/supabase-js",
        "@supabase/functions-js",
        "@supabase/auth-js",
        "@supabase/postgrest-js",
        "@supabase/realtime-js",
        "@supabase/storage-js",
      ],
    },
  },
  vite: {
    ssr: {
      // Belt and braces: also stop Vite externalising them during SSR build.
      noExternal: [/^@supabase\//, "tslib"],
    },
  },
});
