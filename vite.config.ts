// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Pin Nitro's build target to Vercel for external CI (GitHub -> Vercel).
  // Inside Lovable builds this override is IGNORED — the Lovable config force-pins
  // Cloudflare — so the Lovable preview & published deployment are unaffected.
  // On Vercel, this makes Nitro emit `.vercel/output/` (Build Output API v3),
  // which Vercel auto-detects and serves as a full SSR + server-functions app
  // instead of a static shell.
  nitro: { preset: "vercel" },
});

