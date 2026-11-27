import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Terms and Privacy Policy name the operating company and its registration number (owner decision 26/11/2026:
// no street address and no tax number on public pages; the company has no offices yet and the old address was a
// private home).
describe("legal pages identify the operator without private details", () => {
  for (const f of ["src/routes/terms.tsx", "src/routes/privacy.tsx"]) {
    const t = readFileSync(f, "utf8");
    it(`${f} names the company and its registration number`, () => {
      expect(t).toMatch(/Navysky Innovations \(Private\) Limited/);
      expect(t).toMatch(/145174A02102026/);
    });
    it(`${f} shows no street address or tax number`, () => {
      expect(t).not.toMatch(/Timire|12705|Ruwa|registered\s+office/i);
      expect(t).not.toMatch(/\bTIN\b|2002683072/);
    });
  }
});
