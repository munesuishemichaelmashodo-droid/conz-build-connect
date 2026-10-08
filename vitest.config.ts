import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit tests only. Deliberately does not load vite.config.ts (TanStack Start /
// Nitro plugins are not needed to test pure server modules).
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
