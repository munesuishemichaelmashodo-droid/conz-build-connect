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
    // Nitro's own Vercel-function bundling pass (which produces the
    // `_libs/*` shared chunks) runs separately from Vite's SSR build and
    // does NOT respect vite.config's `resolve.alias`/`ssr.noExternal`.
    // Left external, transitive `import ... from "tslib"` inside those
    // chunks (e.g. from @radix-ui packages) relies on tslib's conditional
    // package.json "exports" map at runtime (-> ./modules/index.js), but
    // Nitro's dependency trace only copies the specific tslib entry file
    // it can statically see (tslib.es6.mjs, via the Vite alias below),
    // so ./modules/index.js is missing from the deployed function and
    // Node's ESM resolver throws ERR_MODULE_NOT_FOUND at request time.
    // (Nitro v3 config key is `noExternals`, not the nitropack v2
    // `externals.inline` shape.) Forcing tslib to never be treated as
    // external removes the runtime node_modules resolution entirely.
    // @ts-expect-error -- the wrapper's narrowed `nitro` type omits this key,
    // but it is passed through to Nitro unchanged at build time.
    noExternals: ["tslib"],
  },
  vite: {
    ssr: {
      // Belt and braces: also stop Vite externalising them during SSR build.
      // @radix-ui packages re-export tslib helpers as bare `tslib` imports in
      // their published .mjs files. When left external, Nitro/Vercel's build
      // copies those packages into a separate `_libs/@radix-ui/...` chunk
      // outside the main server bundle, and its runtime `tslib` resolution
      // (via tslib's conditional "exports" map -> ./modules/index.js) fails
      // in the deployed function even though tslib is a direct dependency.
      // Force radix packages to be inlined too so this never hits runtime
      // module resolution.
      noExternal: [/^@supabase\//, /^@radix-ui\//, "tslib"],
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
