import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Terms and Privacy Policy name the operating company and its registration and tax identifiers.
describe("legal pages identify the operator", () => {
  for (const f of ["src/routes/terms.tsx", "src/routes/privacy.tsx"]) {
    it(`${f} names the company, its number and its ZIMRA TIN`, () => {
      const t = readFileSync(f, "utf8");
      expect(t).toMatch(/Navysky Innovations \(Private\) Limited/);
      expect(t).toMatch(/145174A02102026/);
      expect(t).toMatch(/\(TIN\)\s+2002683072/);
    });
  }
});
