import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * Lovable AI Gateway provider. Server-only.
 * Reads LOVABLE_API_KEY at call site; never expose to browser.
 */
export function createLovableAiGatewayProvider(lovableApiKey: string) {
  return createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    supportsStructuredOutputs: false,
    headers: {
      "Lovable-API-Key": lovableApiKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
  });
}
