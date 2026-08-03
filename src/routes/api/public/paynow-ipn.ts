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
    await db
      .from("payments")
      .update({ status: "paid", paynow_reference: map["paynowreference"] ?? reference })
      .eq("id", payment.id);
    // Idempotent: credits wallet, logs transaction, notifies the user.
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
