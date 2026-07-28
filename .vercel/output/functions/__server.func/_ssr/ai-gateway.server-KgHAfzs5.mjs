import { t as createOpenAICompatible } from "../_libs/ai-sdk__openai-compatible.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/ai-gateway.server-KgHAfzs5.js
/**
* Lovable AI Gateway provider. Server-only.
* Reads LOVABLE_API_KEY at call site; never expose to browser.
*/
function createLovableAiGatewayProvider(lovableApiKey) {
	return createOpenAICompatible({
		name: "lovable",
		baseURL: "https://ai.gateway.lovable.dev/v1",
		supportsStructuredOutputs: false,
		headers: {
			"Lovable-API-Key": lovableApiKey,
			"X-Lovable-AIG-SDK": "vercel-ai-sdk"
		}
	});
}
//#endregion
export { createLovableAiGatewayProvider };
