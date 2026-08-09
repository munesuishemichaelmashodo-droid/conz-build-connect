import { createFileRoute } from "@tanstack/react-router";

const SUCCESS_STATUSES = ["paid", "awaiting delivery", "delivered"];
const FAILED_STATUSES = ["cancelled", "failed", "disputed", "refunded"];

async function handleIpn(request: Request): Promise<Response> {
  const { getPaynowCredentials, verifyPaynowPayload } = await import("@/lib/paynow.server");
  const creds = getPaynowCredentials();
  if (!creds) return new Response("paynow_not_configured", { status: 503 });

  const raw = await request.text();
  const fields: Array<[string, string]> = [...new URLSearchParams(raw).entries()];
  if (fields.length === 0) return new Response("bad request", { status: 400 });

  const valid = await verifyPaynowPayload(fields, creds.key);
  if (!valid) return new Response("invalid hash", { status: 401 });

  const map: Record<string, string> = {};
  for (const [k, v] of fields) map[k.toLowerCase()] = v;

  const reference = map["reference"];
  const status = (map["status"] ?? "").toLowerCase();
  if (!reference) return new Response("missing reference", { status: 400 });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;

  const { data: payment } = await db
    .from("payments")
    .select("id, status")
    .eq("id", reference)
    .maybeSingle();

  if (!payment) return new Response("unknown reference", { status: 404 });

  if (SUCCESS_STATUSES.includes(status)) {
    // Do NOT pre-set status to "paid" here — credit_wallet_from_payment()
    // uses status='paid' as its own idempotency guard and will skip crediting
    // if it's already set. Only store the paynow_reference; let the RPC be
    // the sole place that transitions status and credits the wallet.
    if (map["paynowreference"]) {
      await db.from("payments").update({ paynow_reference: map["paynowreference"] }).eq("id", payment.id);
    }
    const { error } = await db.rpc("credit_wallet_from_payment", { _payment_id: payment.id });
    if (error) console.error("[paynow-ipn] credit_wallet_from_payment failed", error.message);
  } else if (FAILED_STATUSES.includes(status)) {
    await db.from("payments").update({ status: "failed" }).eq("id", payment.id);
  }

  return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
}

export const Route = createFileRoute("/api/public/paynow-ipn")({
  server: {
    handlers: {
      POST: async ({ request }) => handleIpn(request),
      GET: async () => new Response("ok", { status: 200 }),
    },
  },
});
