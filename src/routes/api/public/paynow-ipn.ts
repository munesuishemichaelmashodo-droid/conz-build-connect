import { createFileRoute } from "@tanstack/react-router";

// Paynow resultUrl (server-to-server notification). All decisions —
// reference/amount verification, idempotency, no status regression — are made
// by processPaynowIpn() + the apply_paynow_result() database function.
async function handleIpn(request: Request): Promise<Response> {
  const { getPaynowCredentials, processPaynowIpn } = await import("@/lib/paynow.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const raw = await request.text();
  const { status, body } = await processPaynowIpn(raw, {
    integrationKey: getPaynowCredentials()?.key ?? null,
    db: supabaseAdmin as never,
  });
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

export const Route = createFileRoute("/api/public/paynow-ipn")({
  server: {
    handlers: {
      POST: async ({ request }) => handleIpn(request),
      GET: async () => new Response("ok", { status: 200 }),
    },
  },
});
