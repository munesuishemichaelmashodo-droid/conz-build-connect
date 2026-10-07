#!/usr/bin/env node
// Post-build smoke test.
//
// Why this exists: on 2026-08-17, every request to production (including
// /favicon.ico) was returning 500 because a transitive `tslib` import in a
// Nitro-generated `_libs/*` chunk couldn't be resolved at runtime. `npm run
// build` succeeded with zero errors or warnings — the bug only showed up
// once a real request hit the deployed function. This script closes that
// gap by actually invoking the compiled server's fetch handler, the same
// way Vercel does, as part of the build itself.
//
// Run automatically after `npm run build` (see package.json) and in CI.
// Exits non-zero — failing the build/CI check — if anything below fails.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FUNC_DIR = path.resolve(
  process.cwd(),
  ".vercel/output/functions/__server.func",
);

const ROUTES_TO_CHECK = [
  "/",
  "/favicon.ico",
  "/auth",
  "/customer/book",
  "/become-driver",
];

// Any 5xx here means the function crashed handling the request — always a
// hard failure, regardless of route.
const HARD_FAIL_STATUS = (status) => status >= 500;

let failed = false;
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  failed = true;
};
const pass = (msg) => console.log(`✓ ${msg}`);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

async function main() {
  if (!existsSync(FUNC_DIR)) {
    fail(`Build output not found at ${FUNC_DIR}. Run "npm run build" first.`);
    process.exit(1);
  }

  // --- Static check: no dangling bare imports of packages we deliberately
  // force-inline (tslib and friends). If one of these ever comes back, it
  // means a dependency/config change reintroduced the exact 2026-08-17 bug
  // class, and we want to know at build time, not from a user report.
  const FORCE_INLINED_PACKAGES = ["tslib"];
  const mjsFiles = walk(FUNC_DIR).filter((f) => f.endsWith(".mjs"));
  for (const pkg of FORCE_INLINED_PACKAGES) {
    const offenders = [];
    for (const file of mjsFiles) {
      const content = readFileSync(file, "utf8");
      if (new RegExp(`from\\s+["']${pkg}["']`).test(content)) {
        offenders.push(path.relative(FUNC_DIR, file));
      }
    }
    if (offenders.length > 0) {
      fail(
        `"${pkg}" is still bare-imported (not inlined) in: ${offenders.join(", ")}. ` +
          `This is the exact pattern that caused the 2026-08-17 outage — ` +
          `check nitro.noExternals in vite.config.ts.`,
      );
    } else {
      pass(`"${pkg}" is fully inlined — no bare imports found in build output`);
    }
  }

  // --- Dynamic check: actually boot the function and hit real routes.
  let mod;
  try {
    // pathToFileURL: a bare absolute path is not a valid ESM specifier on Windows.
    mod = await import(pathToFileURL(path.join(FUNC_DIR, "index.mjs")).href);
  } catch (err) {
    fail(`Server module failed to import/initialize: ${err?.stack || err}`);
    console.error(
      "\nA failure here means EVERY request in production would 500 " +
        "before your app code even runs — this is the highest-severity " +
        "failure mode and always blocks the build.",
    );
    process.exit(1);
  }
  pass("Server module imported without throwing");

  const app = mod.default;
  if (!app || typeof app.fetch !== "function") {
    fail("Server module's default export has no .fetch() handler — unexpected shape, verify manually.");
    process.exit(1);
  }

  for (const route of ROUTES_TO_CHECK) {
    try {
      const res = await app.fetch(new Request(`http://localhost${route}`));
      if (HARD_FAIL_STATUS(res.status)) {
        fail(`${route} -> ${res.status} (server error)`);
      } else {
        pass(`${route} -> ${res.status}`);
      }
    } catch (err) {
      fail(`${route} -> threw during fetch(): ${err?.stack || err}`);
    }
  }

  if (failed) {
    console.error("\nBuild verification FAILED. Do not deploy this build.");
    process.exit(1);
  }
  console.log("\nBuild verification passed.");
  // Force-exit: some Nitro dev servers/timers keep the event loop alive.
  process.exit(0);
}

main();
