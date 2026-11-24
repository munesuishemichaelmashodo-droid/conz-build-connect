import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

// A detached `supabase.rpc` reference loses `this`: calling it throws
// "Cannot read properties of undefined (reading 'rest')". LaunchSwitchesCard,
// PointsCard and admin.points shipped with `const rpc = supabase.rpc as ...`
// and could not load (found 24/11/2026).

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("supabase.rpc is never detached", () => {
  it("a detached rpc really throws (the reason for this rule)", () => {
    const client = createClient("http://127.0.0.1:1", "test-key");
    const detached = client.rpc;
    expect(() => detached("x", {})).toThrow(/rest/);
  });

  it("no source file assigns supabase.rpc (or db.rpc) to a variable", () => {
    const offenders = sourceFiles(join(process.cwd(), "src")).filter((f) =>
      /=\s*(supabase|db|supabaseAdmin)\.rpc\b(?!\s*\()/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
