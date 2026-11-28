import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// React hooks must run in the same order on every render. A hook placed after JobDetail's loading return crashed
// the job page ("Rendered more hooks than during the previous render") the first time a job loaded.
describe("job page hook order", () => {
  const src = readFileSync("src/routes/_authenticated/jobs.$id.tsx", "utf8");
  const body = src.slice(src.indexOf("function JobDetail()"));
  const firstReturn = body.indexOf("if (isLoading || !job) {");
  it("reads the launch switches before the loading return", () => {
    const hook = body.indexOf("useLaunchSwitches()");
    expect(firstReturn).toBeGreaterThan(0);
    expect(hook).toBeGreaterThan(0);
    expect(hook).toBeLessThan(firstReturn);
  });
  it("calls no use* hook after the loading return in JobDetail itself", () => {
    const end = body.indexOf("\nfunction ", 10);
    const after = body.slice(firstReturn, end > 0 ? end : undefined);
    expect(after).not.toMatch(/\n {2}const [^=]+= use[A-Z]\w*\(/);
  });
});
