import { createFileRoute } from "@tanstack/react-router";

// Provider callback for jobs paid through ConZ (0171). Signature verified by the provider's adapter, then the
// payment is re-checked with the provider before anything is applied (src/lib/payments/provider.server.ts).
// No provider is approved yet: every request answers 404.
async function handleWebhook(provider: string, request: Request): Promise<Response> {
  const raw = await request.text();
  if (raw.length > 64_000) return new Response("too_large", { status: 413 });
  const { handleProviderWebhook, PROVIDER_REGISTRY } =
    await import("@/lib/payments/provider.server");
  if (!Object.prototype.hasOwnProperty.call(PROVIDER_REGISTRY, provider)) {
    return new Response("not_found", { status: 404 });
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return handleProviderWebhook(provider, raw, request.headers, supabaseAdmin as never);
}

export const Route = createFileRoute("/api/payments/webhook/$provider")({
  server: {
    handlers: {
      POST: async ({ request, params }) => handleWebhook(params.provider, request),
    },
  },
});
