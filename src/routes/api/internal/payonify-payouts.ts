import { createFileRoute } from "@tanstack/react-router";

// Sends automatic driver payouts (0121) and looks up sent ones. Called every few minutes by pg_cron
// (public.request_payonify_payouts) with the shared secret in `x-conz-payouts-secret`. Inert until
// PAYONIFY_PAYOUTS_SECRET (32+ characters) is set here AND in the database's app_secrets.
async function handlePayouts(request: Request): Promise<Response> {
  const expected = process.env["PAYONIFY_PAYOUTS_SECRET"]?.trim();
  if (!expected || expected.length < 32) return new Response("not_configured", { status: 503 });
  const { constantTimeEqual } = await import("@/lib/paynow.server");
  const provided = request.headers.get("x-conz-payouts-secret") ?? "";
  if (!constantTimeEqual(provided, expected)) return new Response("unauthorized", { status: 401 });

  const { payonifyServerGate } = await import("@/lib/payonify.process.server");
  const gate = payonifyServerGate(process.env);
  if (!gate.ok) return new Response(`payonify_${gate.reason}`, { status: 503 });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { processPayouts } = await import("@/lib/payonify.payouts.server");
  try {
    const summary = await processPayouts(supabaseAdmin as never, gate.cfg, gate.mode, {
      deadlineMs: 20_000,
    });
    console.log(`[payonify-payouts] ${JSON.stringify(summary)}`);
    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[payonify-payouts] failed", err instanceof Error ? err.message : "unknown");
    return new Response("db_error", { status: 502 });
  }
}

export const Route = createFileRoute("/api/internal/payonify-payouts")({
  server: {
    handlers: {
      POST: async ({ request }) => handlePayouts(request),
    },
  },
});
