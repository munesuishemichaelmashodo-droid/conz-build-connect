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
    // Security headers. vercel.json "headers" are NOT applied when Nitro emits
    // the Vercel Build Output API (.vercel/output/config.json is used instead),
    // so they are declared here where Nitro writes them into that config.
    // Content-Security-Policy is Report-Only on purpose: it surfaces anything
    // that would break (Paynow redirect, OSM tiles, Supabase, push) in the
    // browser console without blocking it. Promote to an enforced
    // Content-Security-Policy once a real session shows no violations.
    routeRules: {
      "/**": {
        headers: {
          "X-Frame-Options": "DENY",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "strict-origin-when-cross-origin",
          "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
          "Permissions-Policy": "geolocation=(self), camera=(self), microphone=(self)",
          "Content-Security-Policy-Report-Only": [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' data: https://fonts.gstatic.com",
            "img-src 'self' data: blob: https://*.supabase.co https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com",
            "media-src 'self' blob: https://*.supabase.co",
            "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://router.project-osrm.org https://nominatim.openstreetmap.org https://*.tile.openstreetmap.org",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self' https://www.paynow.co.zw https://*.paynow.co.zw",
            "object-src 'none'",
          ].join("; "),
        },
      },
    },
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
