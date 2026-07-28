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
  },
  vite: {
    ssr: {
      // Belt and braces: also stop Vite externalising them during SSR build.
      noExternal: [/^@supabase\//, "tslib"],
    },
    resolve: {
      alias: [
        // Force tslib to its ESM entry. When inlined via the CJS `tslib.js`
        // entry, the top-level `var { __extends, ... } = __toESM(...)`
        // destructuring resolves to `undefined` at runtime on Node/Vercel
        // and crashes SSR with "Cannot destructure property '__extends'".
        { find: /^tslib$/, replacement: "tslib/tslib.es6.mjs" },
      ],
    },
  },
});
