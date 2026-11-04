// The pgTAP test must exercise exactly the statement the owner would run in production.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const update = (s: string) => {
  const i = s.indexOf("update public.notifications n");
  return norm(s.slice(i, s.indexOf(";", i) + 1));
};

describe("new_job notification redaction", () => {
  const script = readFileSync(
    "supabase/maintenance/20261104_redact_new_job_notification_addresses.sql",
    "utf8",
  );
  const test = readFileSync(
    "supabase/tests/database/730_redact_new_job_notifications.test.sql",
    "utf8",
  );
  it("the tested UPDATE is identical to the script's UPDATE", () => {
    expect(update(test)).toBe(update(script));
  });
  it("only ever sets body and only touches new_job rows", () => {
    const u = update(script);
    expect(u).toMatch(/^update public\.notifications n set body = /);
    expect(u).toMatch(/n\.type = 'new_job'/);
    expect(u.match(/\bset\b/g)).toHaveLength(1);
  });
  it("is not a migration, so db push and the test harness never run it", () => {
    expect(script).toMatch(/NOT EXECUTED in production/);
  });
});
