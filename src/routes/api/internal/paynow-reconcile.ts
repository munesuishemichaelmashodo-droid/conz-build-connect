import { createFileRoute } from "@tanstack/react-router";

// Scheduled server-side Paynow reconciliation (audit F9).
//
// Called every 10 minutes by pg_cron (public.request_paynow_reconcile) with
// the shared secret in `x-conz-reconcile-secret`. Requires the
// PAYNOW_RECONCILE_SECRET env var; without it the endpoint refuses (503), so
// it is inert until the owner configures both sides.
async function handleReconcile(request: Request): Promise<Response> {
  const expected = process.env["PAYNOW_RECONCILE_SECRET"]?.trim();
  if (!expected || expected.length < 32) return new Response("not_configured", { status: 503 });

  const { constantTimeEqual, getPaynowCredentials } = await import("@/lib/paynow.server");
  const provided = request.headers.get("x-conz-reconcile-secret") ?? "";
  if (!constantTimeEqual(provided, expected)) return new Response("unauthorized", { status: 401 });
  if (!getPaynowCredentials()) return new Response("paynow_not_configured", { status: 503 });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { reconcilePayments } = await import("@/lib/paynow.reconcile.server");
  const db = supabaseAdmin as never as Parameters<typeof reconcilePayments>[0] & {
    rpc: (
      fn: "paynow_pending_for_reconcile",
      args: { _limit: number },
    ) => PromiseLike<{
      data: Array<{ id: string; paynow_poll_url: string | null; created_at: string }> | null;
      error: { message: string } | null;
    }>;
  };

  const { data: pending, error } = await db.rpc("paynow_pending_for_reconcile", { _limit: 25 });
  if (error) {
    console.error("[paynow-reconcile] listing failed", error.message);
    return new Response("db_error", { status: 502 });
  }

  // Stay well inside the serverless time limit; the next run picks up the rest.
  const summary = await reconcilePayments(db, pending ?? [], "reconcile", { deadlineMs: 20_000 });
  console.log(`[paynow-reconcile] ${JSON.stringify(summary)}`);
  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/internal/paynow-reconcile")({
  server: {
    handlers: {
      POST: async ({ request }) => handleReconcile(request),
    },
  },
});
