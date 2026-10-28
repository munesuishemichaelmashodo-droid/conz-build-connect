// Webhook pipeline test: the REAL handlePayonifyWebhook() (signature check, re-fetch, dedupe)
// feeding the REAL apply_payonify_charge() / record_payonify_event() in a LOCAL Postgres.
// Payonify is MOCKED: events are signed here with a fake secret and "fetched" charges come from
// a local map. This is NOT a Payonify sandbox test and moves no money.
//
// Skipped unless a disposable database is provided (same variables as paynow-ipn-db.test.ts):
//   CONZ_TEST_PG_HOST=127.0.0.1 PGPORT=55432 PGPASSWORD=postgres CONZ_TEST_PG_DB=postgres \
//     npx vitest run tests/unit/payonify-webhook-db.test.ts
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handlePayonifyWebhook, type RpcDb } from "@/lib/payonify.process.server";
import { signPayonifyPayload, type Charge } from "@/lib/payonify.server";

const HOST = process.env["CONZ_TEST_PG_HOST"];
const DB = process.env["CONZ_TEST_PG_DB"];
const USER = process.env["CONZ_TEST_PG_USER"] ?? "postgres";
const enabled = !!HOST && !!DB && !/supabase\.co|prod/i.test(`${HOST}${DB}`);
if (process.env["CONZ_REQUIRE_DB_TESTS"] && !enabled) {
  throw new Error("CONZ_REQUIRE_DB_TESTS is set but no test database is configured");
}
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

const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
};
const db: RpcDb = {
  rpc: async (fn, args) => {
    if (!/^[a-z_]+$/.test(fn)) throw new Error("bad fn");
    const named = Object.entries(args)
      .map(([k, v]) => `${k} => ${lit(v)}`)
      .join(", ");
    try {
      const { stdout } = await run(
        "psql",
        psqlArgs(`set role service_role; select public.${fn}(${named})`),
        { encoding: "utf8" },
      );
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

const SECRET = "whsec_db_test_only";
const ENV = {
  PAYONIFY_MODE: "test",
  PAYONIFY_PUBLISHABLE_KEY: "pk_test_db",
  PAYONIFY_SECRET_KEY: "sk_test_db",
  PAYONIFY_WEBHOOK_SECRET: SECRET,
  SUPABASE_URL: "http://127.0.0.1:55431",
};
const charges = new Map<string, Charge>();
const fetchCharge = async (_cfg: unknown, id: string) => {
  const c = charges.get(id);
  if (!c) throw new Error("not found");
  return c;
};

let n = 0;
function newPayment(): { pay: string; job: string; driver: string } {
  const stamp = `${Date.now()}${n++}`;
  const cust = q(`select tests.create_user('pyc_${stamp}')`);
  const driver = q(`select tests.create_driver('pyd_${stamp}', 100)`);
  const job = q(`select tests.create_job('${cust}', 300, 'escrow')`);
  q(
    `update public.jobs set status='accepted', driver_id='${driver}', final_price=300 where id='${job}'`,
  );
  const pay = q(
    `insert into public.payments(user_id,job_id,type,amount,currency,method,status,provider,provider_livemode)
     values ('${cust}','${job}','escrow',300,'USD','payonify','initiated','payonify',false) returning id`,
  );
  return { pay, job, driver };
}
function setCharge(id: string, pay: string, status: string, value = 30000) {
  charges.set(id, {
    id,
    object: "charge",
    amount: { value, currency: "usd" },
    status,
    livemode: false,
    metadata: { conz_payment_id: pay },
  });
}
async function deliver(eventId: string, type: string, objectId: string) {
  const t = Math.floor(Date.now() / 1000);
  const raw = JSON.stringify({
    id: eventId,
    type,
    object: "event",
    created: t,
    livemode: "false",
    data: { object: { id: objectId } },
  });
  const header = `t=${t},v1=${await signPayonifyPayload(SECRET, t, raw)}`;
  return handlePayonifyWebhook(raw, header, { env: ENV, db, fetchCharge });
}
const status = (pay: string) => q(`select status from public.payments where id='${pay}'`);

describe.skipIf(!enabled)(
  "Payonify webhook -> apply_payonify_charge (local Postgres, provider mocked)",
  () => {
    // Con Z Pay is switched off by default; turn it on for these tests and put it back after.
    let saved = "";
    beforeAll(() => {
      saved =
        q(`select coalesce(json_agg(json_build_object('k', key, 'v', value)), '[]') from public.system_settings
               where key in ('escrow_enabled','withdrawals_enabled','max_job_budget','max_wallet_balance')`);
      q("select tests.enable_launch_features()");
    });
    afterAll(() => {
      for (const { k, v } of JSON.parse(saved) as Array<{ k: string; v: unknown }>)
        q(
          `update public.system_settings set value = ${lit(JSON.stringify(v))}::jsonb where key = ${lit(k)}`,
        );
    });

    it("marks a Con Z Pay payment paid once, ignores the repeat, and a later failure can't undo it", async () => {
      const { pay, driver } = newPayment();
      const ch = `ch_${pay.slice(0, 8)}`;
      setCharge(ch, pay, "succeeded");
      const ev = `evt_${pay.slice(0, 8)}`;
      expect(await deliver(ev, "charge.succeeded", ch)).toMatchObject({
        status: 200,
        body: { outcome: "escrow_marked_paid" },
      });
      expect(status(pay)).toBe("paid");
      expect(await deliver(ev, "charge.succeeded", ch)).toMatchObject({
        status: 200,
        body: { outcome: "duplicate_event" },
      });
      setCharge(ch, pay, "failed");
      expect(await deliver(`${ev}_late`, "charge.failed", ch)).toMatchObject({
        status: 200,
        body: { outcome: "regression_blocked" },
      });
      expect(status(pay)).toBe("paid");
      expect(
        q(
          `select count(*) from public.notifications where user_id='${driver}' and type='escrow_funded'`,
        ),
      ).toBe("1");
      expect(
        q(
          `select count(*) from public.platform_ledger where payment_id='${pay}' and kind='escrow_paid'`,
        ),
      ).toBe("2");
    });

    it("does not mark paid when Payonify's charge amount differs from the job price", async () => {
      const { pay } = newPayment();
      const ch = `ch_${pay.slice(0, 8)}`;
      setCharge(ch, pay, "succeeded", 100);
      expect(await deliver(`evt_${pay.slice(0, 8)}`, "charge.succeeded", ch)).toMatchObject({
        status: 200,
        body: { outcome: "rejected_amount_mismatch" },
      });
      expect(status(pay)).toBe("initiated");
    });

    it("closes an unpaid payment on charge.failed", async () => {
      const { pay } = newPayment();
      const ch = `ch_${pay.slice(0, 8)}`;
      setCharge(ch, pay, "failed");
      expect((await deliver(`evt_${pay.slice(0, 8)}`, "charge.failed", ch)).status).toBe(200);
      expect(status(pay)).toBe("failed");
    });

    it("records a charge for an unknown payment instead of failing, and only once", async () => {
      const ghost = "00000000-0000-4000-8000-0000000000ab";
      const ch = `ch_ghost_${Date.now()}`;
      setCharge(ch, ghost, "succeeded");
      const ev = `evt_ghost_${Date.now()}`;
      expect(await deliver(ev, "charge.succeeded", ch)).toMatchObject({
        status: 200,
        body: { outcome: "unknown_payment" },
      });
      expect(await deliver(ev, "charge.succeeded", ch)).toMatchObject({
        status: 200,
        body: { outcome: "duplicate_event" },
      });
    });

    it("credits a driver's wallet once for an EcoCash top-up", async () => {
      const stamp = `${Date.now()}t`;
      const driver = q(`select tests.create_driver('pyt_${stamp}', 20)`);
      const before = Number(q(`select balance from public.wallets where user_id='${driver}'`));
      const pay = q(
        `insert into public.payments(user_id,type,amount,currency,method,status,provider,provider_livemode)
       values ('${driver}','topup',15,'USD','payonify','initiated','payonify',false) returning id`,
      );
      const ch = `ch_t_${pay.slice(0, 8)}`;
      setCharge(ch, pay, "succeeded", 1500);
      const ev = `evt_t_${pay.slice(0, 8)}`;
      expect(await deliver(ev, "charge.succeeded", ch)).toMatchObject({
        status: 200,
        body: { outcome: "credited" },
      });
      expect(await deliver(ev, "charge.succeeded", ch)).toMatchObject({
        body: { outcome: "duplicate_event" },
      });
      expect(Number(q(`select balance from public.wallets where user_id='${driver}'`))).toBe(
        before + 15,
      );
    });

    it("records transfer events without acting on them", async () => {
      const ev = `evt_tr_${Date.now()}`;
      expect(await deliver(ev, "transfer.succeeded", "tr_1")).toMatchObject({
        status: 200,
        body: { outcome: "recorded_unhandled" },
      });
      expect(q(`select count(*) from public.payonify_webhook_events where event_id='${ev}'`)).toBe(
        "1",
      );
    });
  },
);
