#!/usr/bin/env node
// Local stand-in for the Supabase HTTP APIs, for UI testing with SYNTHETIC data.
//
// Why: signed-in screens (driver home, offer form, sign-up stages) can only be
// checked in a browser if something answers the app's auth/REST/RPC/storage calls.
// The hosted project must not be used for that (no test accounts, no writes), and
// Docker is not always available for a local Supabase stack. This server keeps
// everything in memory and forgets it on exit.
//
// It is NOT Supabase: no RLS, no triggers, no real pricing or money logic. Use it
// to look at screens and states, never as evidence that the backend is correct.
//
//   node scripts/dev/mock-supabase.mjs            # http://localhost:54399
//   MOCK_SMS=off node scripts/dev/mock-supabase.mjs   # phone OTP "not configured"
//
// Then start the app against it (see scripts/dev/README.md). Sign in with one of
// the sample accounts below; every password is "sample-pass-1". The SMS code is
// always 123456.

import http from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.MOCK_SUPABASE_PORT ?? 54399);
const SMS_ON = process.env.MOCK_SMS !== "off";
const PASSWORD = "sample-pass-1";
const OTP = "123456";

const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const hoursAgo = (h) => minutesAgo(h * 60);

// --- Synthetic people (all names say "Sample" so nobody mistakes them for real) ---
const ID = {
  customer: "00000000-0000-4000-8000-0000000000c1",
  driver: "00000000-0000-4000-8000-0000000000d1",
  applicant: "00000000-0000-4000-8000-0000000000a1",
  driver2: "00000000-0000-4000-8000-0000000000d2",
  admin: "00000000-0000-4000-8000-0000000000e1",
  driver3: "00000000-0000-4000-8000-0000000000d3",
};

const users = new Map(
  [
    { id: ID.customer, email: "customer@sample.test", name: "Rudo Sample", role: "customer", phone: null },
    { id: ID.driver, email: "driver@sample.test", name: "Tafadzwa Sample", role: "driver", phone: "263771000001" },
    { id: ID.applicant, email: "applicant@sample.test", name: "Kuda Sample", role: "driver", phone: null },
    { id: ID.driver2, email: "driver2@sample.test", name: "Farai Sample", role: "driver", phone: "263771000002" },
    { id: ID.admin, email: "admin@sample.test", name: "Admin Sample", role: "customer", phone: null },
    { id: ID.driver3, email: "driver3@sample.test", name: "Tatenda Sample", role: "driver", phone: "263771000003" },
  ].map((u) => [
    u.id,
    {
      id: u.id,
      aud: "authenticated",
      role: "authenticated",
      email: u.email,
      email_confirmed_at: hoursAgo(500),
      phone: u.phone ?? "",
      phone_confirmed_at: u.phone ? hoursAgo(400) : null,
      new_phone: null,
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: { full_name: u.name, role: u.role },
      created_at: hoursAgo(600),
      updated_at: hoursAgo(1),
    },
  ]),
);

// --- Tables -------------------------------------------------------------------
const db = {
  profiles: [...users.values()].map((u) => ({
    id: u.id,
    full_name: u.user_metadata.full_name,
    email: u.email,
    phone: u.phone || null,
    avatar_url: null,
    status: "active",
    referral_code: null,
    created_at: u.created_at,
  })),
  user_roles: [
    { user_id: ID.customer, role: "customer" },
    { user_id: ID.driver, role: "driver" },
    { user_id: ID.applicant, role: "driver" },
    { user_id: ID.driver2, role: "driver" },
    { user_id: ID.driver3, role: "driver" },
    { user_id: ID.admin, role: "admin" },
    { user_id: ID.admin, role: "super_admin" },
  ],
  driver_profiles: [
    {
      user_id: ID.driver,
      verification_status: "verified",
      verification_notes: null,
      level: "bronze",
      rating_avg: 0,
      rating_count: 0,
      jobs_completed: 1,
      first_job_free_used: true,
      nationality: "Zimbabwe",
      selfie_url: `${ID.driver}/selfie.jpg`,
      national_id_url: `${ID.driver}/id.jpg`,
      license_url: `${ID.driver}/licence.jpg`,
      tipper_photo_url: `${ID.driver}/front.jpg`,
      tipper_photo_side_url: `${ID.driver}/side.jpg`,
      tipper_photo_back_url: `${ID.driver}/back.jpg`,
    },
    {
      user_id: ID.applicant,
      verification_status: "pending",
      verification_notes: null,
      level: "bronze",
      rating_avg: 0,
      rating_count: 0,
      jobs_completed: 0,
      first_job_free_used: false,
      nationality: null,
    },
    {
      user_id: ID.driver2,
      verification_status: "verified",
      level: "silver",
      rating_avg: 4.7,
      rating_count: 23,
      jobs_completed: 31,
      first_job_free_used: true,
      nationality: "Zimbabwe",
    },
  ],
  wallets: [
    { user_id: ID.driver, balance: 0, limited: false, updated_at: hoursAgo(5) },
    { user_id: ID.applicant, balance: 0, limited: false, updated_at: hoursAgo(5) },
    { user_id: ID.driver2, balance: 42.5, limited: false, updated_at: hoursAgo(2) },
  ],
  trucks: [
    { id: "00000000-0000-4000-8000-0000000000f2", driver_id: ID.driver2, registration: "AEZ 1234 (sample)", capacity_m3: 15, created_at: hoursAgo(300) },
    { id: "00000000-0000-4000-8000-0000000000f3", driver_id: ID.driver3, registration: "AFB 5678 (sample)", capacity_m3: 10, created_at: hoursAgo(200) },
  ],
  // Read by the offer cards (a view in the real database).
  driver_public_profiles: [
    { user_id: ID.driver2, rating_avg: 4.7, rating_count: 23, level: "silver", jobs_completed: 31, verification_status: "verified" },
    { user_id: ID.driver3, rating_avg: 0, rating_count: 0, level: "bronze", jobs_completed: 2, verification_status: "verified" },
    { user_id: ID.driver, rating_avg: 0, rating_count: 0, level: "bronze", jobs_completed: 1, verification_status: "verified" },
  ],
  driver_availability: [{ driver_id: ID.driver, status: "offline", lat: null, lng: null, updated_at: hoursAgo(3) }],
  system_settings: [
    { key: "commission_rate", value: 7 },
    { key: "escrow_enabled", value: false },
    { key: "withdrawals_enabled", value: false },
  ],
  jobs: [
    {
      id: "00000000-0000-4000-8000-00000000a001",
      customer_id: ID.customer,
      driver_id: null,
      material: "pit_sand",
      custom_material: null,
      quantity_m3: 5,
      budget: 90,
      final_price: null,
      status: "open",
      payment_method: "direct",
      pickup_address: "Driver arranges pickup",
      pickup_lat: null,
      pickup_lng: null,
      delivery_address: "Mazowe, Mashonaland Central, Zimbabwe",
      delivery_lat: -17.5126,
      delivery_lng: 30.9714,
      notes: "Open request: Pit sand — driver arranges pickup and bids their own price.",
      created_at: hoursAgo(21),
      tracking_token: randomUUID(),
    },
    {
      id: "00000000-0000-4000-8000-00000000a002",
      customer_id: ID.customer,
      driver_id: ID.driver2,
      material: "quarry_dust",
      custom_material: null,
      quantity_m3: 12,
      budget: 207,
      final_price: 207,
      status: "in_progress",
      payment_method: "direct",
      pickup_address: "Pomona Quarry, Harare (sample)",
      pickup_lat: -17.758,
      pickup_lng: 31.078,
      delivery_address: "Harward Road, Belvedere, Harare, Zimbabwe",
      delivery_lat: -17.8322,
      delivery_lng: 31.0181,
      created_at: hoursAgo(30),
      tracking_token: randomUUID(),
    },
    {
      id: "00000000-0000-4000-8000-00000000a003",
      customer_id: ID.customer,
      driver_id: null,
      material: "crusher_run",
      custom_material: null,
      quantity_m3: 20,
      budget: 560,
      final_price: null,
      status: "cancelled",
      payment_method: "direct",
      pickup_address: null,
      delivery_address: "Marondera, Mashonaland East, Zimbabwe",
      delivery_lat: -18.1853,
      delivery_lng: 31.5519,
      created_at: hoursAgo(80),
      tracking_token: randomUUID(),
    },
    {
      id: "00000000-0000-4000-8000-00000000a005",
      customer_id: ID.customer,
      driver_id: null,
      material: "river_sand",
      custom_material: null,
      quantity_m3: 12,
      budget: 207,
      final_price: null,
      status: "open",
      payment_method: "direct",
      pickup_address: "Pomona Quarry, Harare (sample)",
      pickup_lat: -17.758,
      pickup_lng: 31.078,
      delivery_address: "Harward Road, Belvedere, Harare, Zimbabwe",
      delivery_lat: -17.8322,
      delivery_lng: 31.0181,
      pricing_breakdown: { low: 180, high: 240, recommended: 207, material_component: 120, transport_component: 87, distance_km: 18, trip_count: 1 },
      created_at: minutesAgo(30),
      tracking_token: randomUUID(),
    },
    {
      id: "00000000-0000-4000-8000-00000000a004",
      customer_id: ID.customer,
      driver_id: ID.driver2,
      material: "river_sand",
      custom_material: null,
      quantity_m3: 10,
      budget: 180,
      final_price: 180,
      status: "in_progress",
      payment_method: "direct",
      delivery_address: "Borrowdale, Harare, Zimbabwe",
      created_at: hoursAgo(24 * 70),
      updated_at: hoursAgo(24 * 63),
      tracking_token: randomUUID(),
    },
  ],
  // Offers on the open priced job a005, priced within and above the Con Z guide.
  bids: [
    { id: randomUUID(), job_id: "00000000-0000-4000-8000-00000000a005", driver_id: ID.driver2, truck_id: "00000000-0000-4000-8000-0000000000f2", price: 215, status: "pending", counter_status: "none", eta_minutes: 45, capacity_m3_snapshot: 15, estimated_trips: 1, expires_at: new Date(Date.now() + 25 * 60_000).toISOString(), message: "Can load at Pomona this morning.", created_at: minutesAgo(5) },
    { id: randomUUID(), job_id: "00000000-0000-4000-8000-00000000a005", driver_id: ID.driver3, truck_id: "00000000-0000-4000-8000-0000000000f3", price: 198, status: "pending", counter_status: "none", eta_minutes: 15, capacity_m3_snapshot: 10, estimated_trips: 2, expires_at: new Date(Date.now() + 18 * 60_000).toISOString(), message: null, created_at: minutesAgo(9) },
    { id: randomUUID(), job_id: "00000000-0000-4000-8000-00000000a005", driver_id: ID.driver, truck_id: null, price: 255, status: "pending", counter_status: "none", eta_minutes: 60, capacity_m3_snapshot: 12, estimated_trips: 1, expires_at: new Date(Date.now() + 28 * 60_000).toISOString(), message: null, created_at: minutesAgo(2) },
    { id: randomUUID(), job_id: "00000000-0000-4000-8000-00000000a005", driver_id: ID.driver2, truck_id: null, price: 190, status: "pending", counter_status: "none", eta_minutes: 30, expires_at: minutesAgo(40), created_at: minutesAgo(70) },
  ],
  // A delivery nobody has touched for weeks, a stuck Paynow payment, a waiting
  // top-up and a passing reconciliation, so the admin "Needs attention" panel has
  // something to show.
  wallet_topup_requests: [{ id: randomUUID(), user_id: ID.driver, amount: 10, status: "pending", created_at: hoursAgo(50) }],
  reconciliation_runs: [{ id: randomUUID(), ran_at: hoursAgo(12), ok: true, failed: [] }],
  notifications: Array.from({ length: 3 }, (_, i) => ({
    id: randomUUID(),
    user_id: i === 0 ? ID.customer : ID.driver,
    type: "sample",
    title: "Sample notification",
    body: "Synthetic data from the local test server.",
    read_at: null,
    created_at: minutesAgo(10 * (i + 1)),
  })),
  wallet_transactions: [],
  payments: [{ id: randomUUID(), user_id: ID.driver, type: "topup", amount: 5, status: "initiated", method: "paynow", created_at: hoursAgo(3) }],
  storage_objects: [],
};

// --- RPCs (answers shaped like the real functions; values are synthetic) --------
const rpc = {
  launch_switches: () => ({
    escrowEnabled: false,
    withdrawalsEnabled: false,
    maxJobBudget: 500,
    maxWalletBalance: 150,
    minTopup: 1,
  }),
  driver_today_earnings: () => ({ earned: 0, jobs: 0 }),
  customer_cards: ({ _job_ids = [] }) =>
    _job_ids.map((id) => {
      const job = db.jobs.find((j) => j.id === id);
      const p = job && db.profiles.find((x) => x.id === job.customer_id);
      return { job_id: id, first_name: p?.full_name.split(" ")[0] ?? null, rating_avg: null, rating_count: 0 };
    }),
  driver_can_accept_for: ({ _job_id, _driver_id }) => {
    const job = db.jobs.find((j) => j.id === _job_id);
    const dp = db.driver_profiles.find((d) => d.user_id === _driver_id);
    const w = db.wallets.find((x) => x.user_id === _driver_id);
    if (!job) return { ok: false, reason: "job_not_found" };
    if (dp && dp.first_job_free_used === false) return { ok: true, free: true, required: 0, available: Number(w?.balance ?? 0) };
    const required = Math.round(Number(job.final_price ?? job.budget) * 7) / 100;
    const available = Number(w?.balance ?? 0);
    return { ok: available >= required, required, available, shortfall: Math.max(0, Math.round((required - available) * 100) / 100) };
  },
  job_offer_summary: () => ({ others: 0, min: null, max: null }),
  count_available_verified_drivers: () => 2,
  expire_stale_dispatch_offers: () => 0,
  expire_stale_open_jobs: () => 0,
  nearby_available_trucks: () => [],
  job_bidder_locations: () => [],
  get_my_delivery_pin_expiry: () => null,
  // Mirrors the live rule: only the assigned driver, only after the pickup photo.
  start_trip: ({ _job_id }, me) => {
    const job = db.jobs.find((j) => j.id === _job_id);
    if (!job || !me || job.driver_id !== me.id || !job.pickup_photo_url) return null;
    if (job.status === "accepted") job.status = "in_progress";
    return job;
  },
  compute_material_offer: ({ _quantity = 12, _distance_km = 15 }) => {
    const offer = Math.round(14 * Number(_quantity) + 2.1 * Number(_distance_km));
    return { offer, min: Math.round(offer * 0.85), max: Math.round(offer * 1.25), enforced: true, sample: true };
  },
};

// --- Helpers ------------------------------------------------------------------
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function tokenFor(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: user.id, email: user.email, phone: user.phone, role: "authenticated", aal: "aal1", iat: now, exp: now + 3600, session_id: randomUUID() };
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.mock-signature`;
}
function userFromAuth(req) {
  const h = req.headers.authorization ?? "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  try {
    const payload = JSON.parse(Buffer.from(tok.split(".")[1] ?? "", "base64url").toString());
    return users.get(payload.sub) ?? null;
  } catch {
    return null;
  }
}
const refreshTokens = new Map();
function session(user) {
  const refresh = randomUUID();
  refreshTokens.set(refresh, user.id);
  return { access_token: tokenFor(user), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: refresh, user };
}

function send(res, status, body, headers = {}) {
  const isJson = body !== undefined && typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(status, {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS",
    "access-control-expose-headers": "content-range, x-total-count",
    ...(isJson ? { "content-type": "application/json" } : {}),
    ...headers,
  });
  res.end(body === undefined ? undefined : isJson ? JSON.stringify(body) : body);
}
const readBody = (req) =>
  new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : null);
      } catch {
        resolve(raw);
      }
    });
  });

// PostgREST-style filters: col=eq.x, neq, in.(a,b), is.null, gt/gte/lt/lte, not.is.null.
// `or=` and embedded selects are ignored (the mock returns a superset / flat rows).
function matches(row, params) {
  for (const [col, raw] of params) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns", "or", "and"].includes(col)) continue;
    let expr = raw;
    let negate = false;
    if (expr.startsWith("not.")) {
      negate = true;
      expr = expr.slice(4);
    }
    const dot = expr.indexOf(".");
    const op = expr.slice(0, dot);
    const val = expr.slice(dot + 1);
    const cell = row[col];
    let ok = true;
    if (op === "eq") ok = String(cell) === val;
    else if (op === "neq") ok = String(cell) !== val;
    else if (op === "is") ok = val === "null" ? cell == null : String(cell) === val;
    else if (op === "in") ok = val.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, "")).includes(String(cell));
    else if (op === "gt") ok = cell > val;
    else if (op === "gte") ok = cell >= val;
    else if (op === "lt") ok = cell < val;
    else if (op === "lte") ok = cell <= val;
    else if (op === "ilike" || op === "like") ok = new RegExp(`^${val.replace(/[%*]/g, ".*")}$`, "i").test(String(cell ?? ""));
    if (negate) ok = !ok;
    if (!ok) return false;
  }
  return true;
}
function query(table, params) {
  let rows = (db[table] ?? []).filter((r) => matches(r, params));
  const order = params.find(([k]) => k === "order")?.[1];
  if (order) {
    const [col, dir] = order.split(",")[0].split(".");
    rows = [...rows].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === "desc" ? -1 : 1));
  }
  const offset = Number(params.find(([k]) => k === "offset")?.[1] ?? 0);
  const limit = params.find(([k]) => k === "limit")?.[1];
  return rows.slice(offset, limit ? offset + Number(limit) : undefined);
}
function keyCols(table, onConflict) {
  if (onConflict) return onConflict.split(",");
  if (["driver_profiles", "wallets"].includes(table)) return ["user_id"];
  if (table === "driver_availability") return ["driver_id"];
  if (table === "user_roles") return ["user_id", "role"];
  if (table === "system_settings") return ["key"];
  return ["id"];
}

// --- Server ---------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  if (req.method === "OPTIONS") return send(res, 204);
  const me = userFromAuth(req);

  // ---- Auth
  if (path === "/auth/v1/settings") return send(res, 200, { external: { email: true, phone: SMS_ON, google: true } });
  if (path === "/auth/v1/token") {
    const body = (await readBody(req)) ?? {};
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      const u = [...users.values()].find((x) => x.email === String(body.email ?? "").toLowerCase());
      if (!u || body.password !== PASSWORD) return send(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
      return send(res, 200, session(u));
    }
    if (grant === "refresh_token") {
      const uid = refreshTokens.get(body.refresh_token);
      if (!uid) return send(res, 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
      return send(res, 200, session(users.get(uid)));
    }
    return send(res, 400, { msg: "unsupported grant" });
  }
  if (path === "/auth/v1/user") {
    if (!me) return send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
    if (req.method === "GET") return send(res, 200, me);
    if (req.method === "PUT") {
      const body = (await readBody(req)) ?? {};
      if (body.phone) {
        if (!SMS_ON) return send(res, 400, { code: 400, error_code: "phone_provider_disabled", msg: "Unsupported phone provider" });
        me.new_phone = String(body.phone).replace(/^\+/, "");
        console.log(`[mock-supabase] SMS to +${me.new_phone} (not sent): your code is ${OTP}`);
      }
      if (body.data) me.user_metadata = { ...me.user_metadata, ...body.data };
      return send(res, 200, me);
    }
  }
  if (path === "/auth/v1/verify") {
    const body = (await readBody(req)) ?? {};
    const u = me ?? [...users.values()].find((x) => x.new_phone && `+${x.new_phone}` === body.phone);
    if (!u || !u.new_phone || `+${u.new_phone}` !== body.phone) return send(res, 403, { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" });
    if (body.token !== OTP) return send(res, 403, { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" });
    u.phone = u.new_phone;
    u.new_phone = null;
    u.phone_confirmed_at = new Date().toISOString();
    return send(res, 200, session(u));
  }
  if (path === "/auth/v1/logout") return send(res, 204);
  if (path === "/auth/v1/recover" || path === "/auth/v1/otp" || path === "/auth/v1/resend") return send(res, 200, {});

  // ---- REST
  const rest = path.match(/^\/rest\/v1\/(rpc\/)?([a-z_]+)$/);
  if (rest) {
    const [, isRpc, name] = rest;
    if (isRpc) {
      const args = (req.method === "GET" ? Object.fromEntries(url.searchParams) : await readBody(req)) ?? {};
      const fn = rpc[name];
      return send(res, 200, fn ? fn(args, me) : null);
    }
    const params = [...url.searchParams.entries()];
    const wantsObject = (req.headers.accept ?? "").includes("vnd.pgrst.object");
    const prefer = req.headers.prefer ?? "";
    if (!db[name]) db[name] = [];
    if (req.method === "GET" || req.method === "HEAD") {
      const rows = query(name, params);
      const headers = { "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` };
      if (req.method === "HEAD") return send(res, 200, undefined, headers);
      if (wantsObject) return rows.length === 1 ? send(res, 200, rows[0], headers) : send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
      return send(res, 200, rows, headers);
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      const incoming = Array.isArray(body) ? body : [body];
      const keys = keyCols(name, url.searchParams.get("on_conflict"));
      const out = [];
      for (const row of incoming) {
        const existing = db[name].find((r) => keys.every((k) => row[k] !== undefined && String(r[k]) === String(row[k])));
        if (existing) {
          if (prefer.includes("ignore-duplicates")) continue;
          if (prefer.includes("merge-duplicates")) {
            Object.assign(existing, row);
            out.push(existing);
            continue;
          }
          return send(res, 409, { code: "23505", message: "duplicate key value violates unique constraint (mock)" });
        }
        const fresh = { id: randomUUID(), created_at: new Date().toISOString(), ...row };
        db[name].push(fresh);
        out.push(fresh);
      }
      if (!prefer.includes("return=representation")) return send(res, 201);
      return send(res, 201, wantsObject ? out[0] ?? null : out);
    }
    if (req.method === "PATCH") {
      const body = (await readBody(req)) ?? {};
      const rows = (db[name] ?? []).filter((r) => matches(r, params));
      rows.forEach((r) => Object.assign(r, body, { updated_at: new Date().toISOString() }));
      if (!prefer.includes("return=representation")) return send(res, 204);
      return send(res, 200, wantsObject ? rows[0] ?? null : rows);
    }
    if (req.method === "DELETE") {
      db[name] = (db[name] ?? []).filter((r) => !matches(r, params));
      return send(res, 204);
    }
  }

  // ---- Storage
  const obj = path.match(/^\/storage\/v1\/object\/(sign\/|public\/|authenticated\/|list\/)?([^/]+)\/?(.*)$/);
  if (obj) {
    const [, kind, bucket, key] = obj;
    if (kind === "list/") return send(res, 200, []);
    if (kind === "sign/" && req.method === "POST") return send(res, 200, { signedURL: `/object/sign/${bucket}/${key}?token=mock` });
    if (req.method === "POST" || req.method === "PUT") {
      db.storage_objects.push({ bucket, key, at: new Date().toISOString() });
      return send(res, 200, { Key: `${bucket}/${key}`, Id: randomUUID() });
    }
    // Any GET of an object: a neutral placeholder image.
    return send(res, 200, `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#2a2420"/><text x="80" y="55" fill="#a89a8f" font-size="12" text-anchor="middle" font-family="sans-serif">sample photo</text></svg>`, { "content-type": "image/svg+xml" });
  }

  if (path.startsWith("/functions/v1/")) return send(res, 200, { ok: true, mock: true });
  return send(res, 404, { message: `mock-supabase: no handler for ${req.method} ${path}` });
});

// Realtime websockets are not emulated; refuse the upgrade so the client backs off.
server.on("upgrade", (_req, socket) => socket.destroy());

server.listen(PORT, () => {
  console.log(`[mock-supabase] synthetic Supabase on http://localhost:${PORT} (SMS ${SMS_ON ? "on" : "off"})`);
  console.log(`[mock-supabase] sign in as customer@sample.test, driver@sample.test, applicant@sample.test — password ${PASSWORD}`);
});
