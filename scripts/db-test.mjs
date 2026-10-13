#!/usr/bin/env node
// Local / CI database test harness (pgTAP via the Supabase CLI + Docker).
//
// Why a separate workdir: the full history in supabase/migrations/ cannot be
// replayed on a fresh database — pre-August files depend on objects that were
// only ever created live (see CLAUDE.md "Known issue — git/DB drift"). The
// 13/08 baseline (20260813999999_baseline_reconcile_with_live.sql) is a
// complete introspected snapshot of the live schema, so a fresh test DB is
// built from the baseline plus every migration after it. The repo's
// migration history is left untouched.
//
// This never talks to the hosted project: the generated config uses its own
// project id, and only local Docker containers are started.
//
// Usage:
//   node scripts/db-test.mjs start   # build .dbtest/ and start a fresh local stack
//   node scripts/db-test.mjs test    # rebuild the DB from the CURRENT migrations, then run pgTAP
//                                    #   (add --keep to skip the rebuild and reuse the running DB)
//   node scripts/db-test.mjs reset   # rebuild the DB from migrations (fresh state)
//   node scripts/db-test.mjs stop    # stop and discard the local stack

import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const SRC_MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const SRC_TESTS = path.join(ROOT, "supabase", "tests");
const REFERENCE_DATA = path.join(ROOT, "supabase", "test-fixtures", "reference_data.sql");
const TEST_HELPERS = path.join(ROOT, "supabase", "test-fixtures", "test_helpers.sql");
const WORKDIR = path.join(ROOT, ".dbtest");
const WD_SUPABASE = path.join(WORKDIR, "supabase");
const BASELINE = "20260813999999";
const PROJECT_ID = "conz-dbtest";

// Services pgTAP does not need (keeps memory use low on laptops and CI).
const EXCLUDE = [
  "studio",
  "imgproxy",
  "vector",
  "logflare",
  "edge-runtime",
  "supavisor",
  "realtime",
  "mailpit",
  "postgres-meta",
].join(",");

// Host ports for the throwaway test stack.
//
// The Supabase CLI defaults (54320-54329) fall inside the TCP port range that
// Windows/Hyper-V/WSL can reserve ("netsh interface ipv4 show excludedportrange
// protocol=tcp"), which makes Docker fail with "bind: An attempt was made to
// access a socket in a way forbidden by its access permissions" before any test
// runs. The test stack therefore uses its own block of ports, chosen by actually
// trying to bind them (excluded and in-use ports both fail that check). This
// only affects the generated .dbtest/supabase/config.toml: the repo's real
// supabase/config.toml, application database URLs and the hosted project are
// never touched. Override with CONZ_DBTEST_PORT_BASE=<first of 7 free ports>.
const PORTS_FILE = path.join(WORKDIR, "ports.json");
const PORT_COUNT = 7; // api, db, shadow, pooler, studio, inbucket, analytics
const PORT_SEARCH_START = 55431; // => db on 55432
const PORT_SEARCH_TRIES = 40;

function canBind(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

async function blockIsFree(base) {
  for (let i = 0; i < PORT_COUNT; i++) {
    for (const host of ["127.0.0.1", "0.0.0.0"]) {
      if (!(await canBind(base + i, host))) return false;
    }
  }
  return true;
}

// Reuse the ports a running stack was started with (they are busy by then, so
// re-probing would wrongly move them). `stop` clears the file.
async function selectPorts() {
  mkdirSync(WORKDIR, { recursive: true });
  if (existsSync(PORTS_FILE)) {
    try {
      const saved = JSON.parse(readFileSync(PORTS_FILE, "utf8"));
      if (Number.isInteger(saved.base)) return saved.base;
    } catch {
      // unreadable file: fall through and pick again
    }
  }
  const forced = process.env.CONZ_DBTEST_PORT_BASE;
  let base = null;
  if (forced) {
    const n = Number(forced);
    if (!Number.isInteger(n) || n < 1024 || n + PORT_COUNT > 65535) {
      console.error(`db-test: CONZ_DBTEST_PORT_BASE=${forced} is not a usable port number`);
      process.exit(2);
    }
    if (!(await blockIsFree(n))) {
      console.error(
        `db-test: ports ${n}-${n + PORT_COUNT - 1} are not all free (in use or reserved by Windows)`,
      );
      process.exit(2);
    }
    base = n;
  } else {
    for (let i = 0; i < PORT_SEARCH_TRIES && base === null; i++) {
      const candidate = PORT_SEARCH_START + i * 10;
      if (await blockIsFree(candidate)) base = candidate;
    }
    if (base === null) {
      console.error("db-test: could not find a free block of ports; set CONZ_DBTEST_PORT_BASE");
      process.exit(2);
    }
  }
  writeFileSync(PORTS_FILE, JSON.stringify({ base }) + "\n");
  return base;
}

function configToml(base) {
  return (
    `# GENERATED by scripts/db-test.mjs — local test stack only, never linked.\n` +
    `project_id = "${PROJECT_ID}"\n\n` +
    `[api]\nport = ${base}\n\n` +
    `[db]\nport = ${base + 1}\nshadow_port = ${base + 2}\nmajor_version = 17\n\n` +
    `[db.pooler]\nport = ${base + 3}\n\n` +
    `[studio]\nport = ${base + 4}\n\n` +
    `[inbucket]\nport = ${base + 5}\n\n` +
    `[analytics]\nport = ${base + 6}\n`
  );
}

async function build() {
  rmSync(path.join(WD_SUPABASE, "migrations"), { recursive: true, force: true });
  mkdirSync(path.join(WD_SUPABASE, "migrations"), { recursive: true });
  const base = await selectPorts();
  writeFileSync(path.join(WD_SUPABASE, "config.toml"), configToml(base));
  console.log(
    `db-test: local test stack ports ${base}-${base + PORT_COUNT - 1} (database on ${base + 1})`,
  );
  const files = readdirSync(SRC_MIGRATIONS)
    .filter((f) => /^\d{14}_.+\.sql$/.test(f) && f.slice(0, 14) >= BASELINE)
    .sort();
  for (const f of files) {
    cpSync(path.join(SRC_MIGRATIONS, f), path.join(WD_SUPABASE, "migrations", f));
  }
  // The baseline is schema-only; later migrations assume configuration rows
  // (material prices, platform settings) exist. Append them to the copy.
  const baselineCopy = path.join(WD_SUPABASE, "migrations", files[0]);
  appendFileSync(baselineCopy, "\n\n" + readFileSync(REFERENCE_DATA, "utf8"));
  // Test helpers (pgTAP, identity switching, fixtures) go last.
  cpSync(TEST_HELPERS, path.join(WD_SUPABASE, "migrations", "29991231235959_test_helpers.sql"));
  syncTests();
  console.log(`db-test: ${files.length} migrations from ${files[0]} to ${files.at(-1)}`);
}

function syncTests() {
  rmSync(path.join(WD_SUPABASE, "tests"), { recursive: true, force: true });
  if (existsSync(SRC_TESTS))
    cpSync(SRC_TESTS, path.join(WD_SUPABASE, "tests"), { recursive: true });
}

// Run the CLI, echo its output, and keep a copy in .dbtest/last-run.txt so a
// failed run can be inspected without copying anything from the terminal.
function supabaseLogged(args) {
  const r = spawnSync("npx", ["supabase", ...args, "--workdir", WORKDIR], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  process.stdout.write(text);
  writeFileSync(path.join(WORKDIR, "last-run.txt"), text);
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function supabase(args) {
  const r = spawnSync("npx", ["supabase", ...args, "--workdir", WORKDIR], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const cmd = process.argv[2];
switch (cmd) {
  case "start":
    await build();
    supabase(["start", "-x", EXCLUDE]);
    break;
  case "reset":
    await build();
    supabase(["db", "reset", "--local"]);
    break;
  case "test":
    // A running local DB keeps whatever migrations it was started with, so
    // `test` alone silently ran new tests against an old schema (missing
    // functions, old signatures). Rebuild from the current migrations first.
    if (process.argv.includes("--keep")) {
      syncTests();
    } else {
      await build();
      supabase(["db", "reset", "--local"]);
    }
    supabaseLogged(["test", "db", "--local"]);
    break;
  case "stop":
    supabase(["stop", "--no-backup"]);
    rmSync(PORTS_FILE, { force: true });
    break;
  default:
    console.error("usage: node scripts/db-test.mjs start|test|reset|stop");
    process.exit(2);
}
