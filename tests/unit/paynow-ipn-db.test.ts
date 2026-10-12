// Callback pipeline test: the REAL processPaynowIpn() (hash verification, parsing) feeding the REAL
// apply_paynow_result() in a LOCAL Postgres. The Paynow provider is MOCKED: bodies are signed here with a fake
// integration key, exactly as Paynow would. This is NOT a live Paynow integration test and moves no real money.
//
// Skipped unless a disposable database is provided:
//   CONZ_TEST_PG_HOST=/var/tmp/pgsock CONZ_TEST_PG_DB=<disposable db with the migrations + tests helpers> npx vitest run tests/unit/paynow-ipn-db.test.ts
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { processPaynowIpn, type PaynowResultDb } from "@/lib/paynow.server";

const HOST = process.env["CONZ_TEST_PG_HOST"];
const DB = process.env["CONZ_TEST_PG_DB"];
const USER = process.env["CONZ_TEST_PG_USER"] ?? "postgres";
const enabled = !!HOST && !!DB && !/supabase\.co|prod/i.test(`${HOST}${DB}`);
const KEY = "mock-integration-key-not-real";
const run = promisify(execFile);

const psqlArgs = (sql: string) => [
  "-h",
  HOST!,
  "-U",
  USER,
  "-d",
  DB!,
  "-X",
  "-At",
  "-q",
  "-c",
  sql,
];
const q = (sql: string) => execFileSync("psql", psqlArgs(sql), { encoding: "utf8" }).trim();

const db: PaynowResultDb = {
  rpc: async (_fn, a) => {
    const lit = (v: string | null) => (v === null ? "null" : `'${v.replace(/'/g, "''")}'`);
    const sql = `select public.apply_paynow_result('${a._payment_id}', '${a._source}', ${lit(a._status)}, ${lit(
      a._reported_amount,
    )}, ${lit(a._reported_reference)}, ${lit(a._paynow_reference)})`;
    try {
      const { stdout } = await run("psql", psqlArgs(sql), { encoding: "utf8" });
      return { data: JSON.parse(stdout.trim()), error: null };
    } catch (e) {
      const msg = String((e as { stderr?: string }).stderr ?? e);
      return {
        data: null,
        error: { message: msg, code: /payment_not_found/.test(msg) ? "P0002" : undefined },
      };
    }
  },
};

const hash = (values: string[]) =>
  createHash("sha512")
    .update(values.join("") + KEY, "utf8")
    .digest("hex")
    .toUpperCase();
function signed(over: Record<string, string>, tamperAmount?: string) {
  // Paynow references are unique per transaction (payments.paynow_reference is UNIQUE), so derive one per payment.
  const f: Array<[string, string]> = Object.entries({
    reference: "",
    paynowreference: `PN-${over["reference"] ?? "x"}`,
    amount: "25.00",
    status: "Paid",
    pollurl: "https://www.paynow.co.zw/Interface/CheckPayment/?guid=x",
    ...over,
  });
  const h = hash(f.map(([, v]) => v));
  const fields = tamperAmount
    ? f.map(([k, v]): [string, string] => (k === "amount" ? [k, tamperAmount] : [k, v]))
    : f;
  return new URLSearchParams([...fields, ["hash", h]]).toString();
}

function newTopup(): { user: string; pay: string } {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const user = q(`select tests.create_user('ipn_${stamp}')`);
  const pay = q(
    `insert into public.payments(user_id,type,amount,currency,method,status) values ('${user}','topup',25,'USD','paynow','initiated') returning id`,
  );
  return { user, pay };
}
const balance = (user: string) =>
  Number(q(`select balance from public.wallets where user_id='${user}'`));
const ipn = (body: string) => processPaynowIpn(body, { integrationKey: KEY, db });

describe.skipIf(!enabled)(
  "Paynow IPN -> apply_paynow_result (local Postgres, provider mocked)",
  () => {
    it("rejects a tampered amount (bad hash) and credits nothing", async () => {
      const { user, pay } = newTopup();
      const r = await ipn(signed({ reference: pay }, "2500.00"));
      expect(r.status).toBe(401);
      expect(balance(user)).toBe(0);
    });

    it("does not credit a correctly signed message whose amount differs from the stored payment", async () => {
      const { user, pay } = newTopup();
      const r = await ipn(signed({ reference: pay, amount: "5.00" }));
      expect(r.status).toBe(200); // handled; the DB recorded the mismatch
      expect(balance(user)).toBe(0);
      expect(q(`select status from public.payments where id='${pay}'`)).not.toBe("paid");
    });

    it("rejects a non-UUID reference without touching the database", async () => {
      const r = await ipn(signed({ reference: "not-a-uuid" }));
      expect(r.status).toBe(400);
    });

    it("answers 404 for an unknown payment", async () => {
      const r = await ipn(signed({ reference: "00000000-0000-4000-8000-0000000000aa" }));
      expect(r.status).toBe(404);
    });

    it("credits a valid Paid message once; a duplicate and a late 'Awaiting' do not change anything", async () => {
      const { user, pay } = newTopup();
      expect((await ipn(signed({ reference: pay }))).status).toBe(200);
      expect(balance(user)).toBe(25);
      expect((await ipn(signed({ reference: pay }))).status).toBe(200); // duplicate
      expect((await ipn(signed({ reference: pay, status: "Awaiting Delivery" }))).status).toBe(200); // out of order
      expect((await ipn(signed({ reference: pay, status: "Created" }))).status).toBe(200); // out of order
      expect(balance(user)).toBe(25);
      expect(q(`select status from public.payments where id='${pay}'`)).toBe("paid");
      expect(
        q(
          `select count(*) from public.wallet_transactions where user_id='${user}' and type='topup'`,
        ),
      ).toBe("1");
    });

    it("a failure after Paid cannot regress the payment or remove the credit", async () => {
      const { user, pay } = newTopup();
      await ipn(signed({ reference: pay }));
      await ipn(signed({ reference: pay, status: "Cancelled" }));
      expect(q(`select status from public.payments where id='${pay}'`)).toBe("paid");
      expect(balance(user)).toBe(25);
    });

    it("Paid arriving AFTER a Cancelled message is flagged for a human, never auto-credited (money may have moved)", async () => {
      const { user, pay } = newTopup();
      await ipn(signed({ reference: pay, status: "Cancelled" }));
      expect(balance(user)).toBe(0);
      expect((await ipn(signed({ reference: pay }))).status).toBe(200);
      expect(balance(user)).toBe(0);
      expect(q(`select status from public.payments where id='${pay}'`)).toBe("cancelled");
      expect(
        q(
          `select outcome from public.payment_events where payment_id='${pay}' order by created_at desc limit 1`,
        ),
      ).toBe("late_success_flagged");
    });

    it("10 simultaneous valid deliveries credit exactly once", async () => {
      const { user, pay } = newTopup();
      const body = signed({ reference: pay });
      const results = await Promise.all(Array.from({ length: 10 }, () => ipn(body)));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(balance(user)).toBe(25);
      expect(
        q(
          `select count(*) from public.wallet_transactions where user_id='${user}' and type='topup'`,
        ),
      ).toBe("1");
    });

    it("answers 503 when Paynow is not configured", async () => {
      const r = await processPaynowIpn(signed({ reference: "x" }), { integrationKey: null, db });
      expect(r.status).toBe(503);
    });
  },
);
