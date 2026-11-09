import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard rails for new database migrations (0152 onward). They exist because this project is built quickly and often by
 * several sessions at once: each rule below is something that went wrong, or nearly did, in this repository.
 *
 *  1. Every migration has an undo script in supabase/rollbacks with the same version prefix.
 *  2. No DROP in a migration: the Supabase tool used to apply them hangs on DROP, and the repo's rule is "alter in place".
 *     (Undo scripts may drop.)
 *  3. Every new table turns row level security on in the same file.
 *  4. Nothing is granted to anon/public except the reviewed allow-list (the pgTAP test 120 holds the same list).
 */
const FIRST_GUARDED = "20261108100000";
const ANON_ALLOWED_FUNCTIONS = ["transport_pricing_enabled"];

const root = join(__dirname, "..", "..", "supabase");
const migrations = readdirSync(join(root, "migrations"))
  .filter((f) => f.endsWith(".sql") && f.slice(0, 14) >= FIRST_GUARDED)
  .sort();
const rollbacks = readdirSync(join(root, "rollbacks"));

const sqlOf = (file: string) =>
  readFileSync(join(root, "migrations", file), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

describe("migrations from 0152 on", () => {
  it("are found (the guard is not silently empty)", () => {
    expect(migrations.length).toBeGreaterThanOrEqual(10);
  });

  it.each(migrations)("%s has an undo script", (file) => {
    const version = file.slice(0, 14);
    expect(rollbacks.some((r) => r.startsWith(version))).toBe(true);
  });

  it.each(migrations)("%s contains no DROP statement", (file) => {
    const drops = sqlOf(file).match(
      /\bdrop\s+(table|function|trigger|policy|column|index|constraint|view|type|schema|extension)\b/gi,
    );
    expect(drops).toBeNull();
  });

  it.each(migrations)("%s turns on row level security for each table it creates", (file) => {
    const sql = sqlOf(file);
    const created = [
      ...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_0-9]+)/gi),
    ].map((m) => m[1]);
    for (const table of created) {
      const re = new RegExp(
        `alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`,
        "i",
      );
      expect(re.test(sql), `${file}: table ${table} has no ENABLE ROW LEVEL SECURITY`).toBe(true);
    }
  });

  it.each(migrations)("%s grants nothing to anon or public beyond the reviewed list", (file) => {
    const sql = sqlOf(file);
    const grants = [...sql.matchAll(/grant\s+[^;]*?\s+to\s+([^;]*);/gi)].map((m) => ({
      whole: m[0],
      to: m[1],
    }));
    for (const g of grants) {
      if (!/\b(anon|public)\b/i.test(g.to)) continue;
      const allowed = ANON_ALLOWED_FUNCTIONS.some((fn) => g.whole.includes(fn));
      expect(allowed, `${file}: ${g.whole.trim()}`).toBe(true);
    }
  });
});

describe("the guard itself", () => {
  it("would catch a table without row level security", () => {
    const bad = "create table public.t (id int);";
    const created = [
      ...bad.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_0-9]+)/gi),
    ].map((m) => m[1]);
    expect(created).toEqual(["t"]);
    expect(/alter\s+table\s+public\.t\s+enable\s+row\s+level\s+security/i.test(bad)).toBe(false);
  });
});
