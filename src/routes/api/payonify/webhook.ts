import { createFileRoute } from "@tanstack/react-router";

// Payonify webhook (URL saved in the Payonify project: https://www.conz.co.zw/api/payonify/webhook).
// Signature check, de-duplication, re-fetching the charge and the state change all happen in
// handlePayonifyWebhook() + apply_payonify_charge(). Returns 503 while Payonify is not enabled
// on this deployment (it is sandbox-only and never runs against the production database).
async function handleWebhook(request: Request): Promise<Response> {
  const { handlePayonifyWebhook } = await import("@/lib/payonify.process.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const raw = await request.text(); // the exact bytes Payonify signed
  const { status, body } = await handlePayonifyWebhook(
    raw,
    request.headers.get("payonify-signature"),
    {
      env: process.env,
      db: supabaseAdmin as never,
    },
  );
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/payonify/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => handleWebhook(request),
    },
  },
});
