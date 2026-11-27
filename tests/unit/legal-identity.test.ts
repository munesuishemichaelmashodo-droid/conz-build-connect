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

// Privacy Policy matches the app (27/11): no withdrawals offered, honest deletion rule, rights, no licence claims.
describe("Privacy Policy describes the app accurately", () => {
  const p = readFileSync("src/routes/privacy.tsx", "utf8");
  it("does not describe withdrawals as a feature or promise deletion after a withdrawal", () => {
    expect(p).toMatch(/withdrawals are not offered/);
    expect(p).not.toMatch(/has been withdrawn/);
  });
  it("names the people's rights and the regulator without claiming a licence", () => {
    expect(p).toMatch(/Data Protection Act/);
    expect(p).not.toMatch(
      /licensed by POTRAZ|POTRAZ licen[cs]e(d)? |registered with POTRAZ|our Data Protection Officer/i,
    );
  });
  it("never says Con Z holds or guarantees customer fares", () => {
    expect(p).toMatch(/Con Z does not receive or hold\s+customer fares/);
    expect(p).not.toMatch(/escrow|guarantee/i);
  });
});

// Owner rules (27/11): Commission Credit cannot be withdrawn or transferred; Con Z never holds or refunds fares.
describe("Terms describe Commission Credit and fares accurately", () => {
  const t = readFileSync("src/routes/terms.tsx", "utf8");
  it("does not offer withdrawals or a withdrawal PIN", () => {
    expect(t).not.toMatch(/withdrawal PIN|balances and withdrawals|withdrawal methods/i);
    expect(t).toMatch(/cannot be withdrawn or\s+transferred to another Driver/);
  });
  it("does not promise refunds through a wallet", () => {
    expect(t).not.toMatch(/refunds through the wallet/);
    expect(t).toMatch(/Con Z does not refund customer fares/);
  });
});

describe("no promise that Con Z holds money", () => {
  it("Terms section 7 describes direct payment only", () => {
    const t = readFileSync("src/routes/terms.tsx", "utf8");
    expect(t).not.toMatch(/paying through Con Z at checkout/);
    expect(t).toMatch(/a record is not proof that a payment was made/);
  });
  it("the job page never says money is held safely or held by Con Z", () => {
    const j = readFileSync("src/routes/_authenticated/jobs.$id.tsx", "utf8");
    expect(j).not.toMatch(/held safely|we'll hold the money/i);
  });
});
