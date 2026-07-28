import { l as createServerFn } from "./esm-Dova13aH.mjs";
import { t as createServerRpc } from "./createServerRpc-WJgk8O8C.mjs";
import { t as requireSupabaseAuth } from "./auth-middleware-QP6BYy5L.mjs";
import { et as enumType, it as ZodIssueCode, nt as objectType, rt as stringType, tt as numberType } from "../_libs/@ai-sdk/gateway+[...].mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/booking.functions-BZEKctNP.js
var MATERIALS = [
	"river_sand",
	"pit_sand",
	"quarry_dust",
	"crusher_run",
	"gravel",
	"stones",
	"top_soil",
	"filling_soil",
	"custom"
];
var MAX_SERVICE_KM = 900;
var TOO_FAR_MESSAGE = "This delivery address is too far from our service area — please choose a closer address.";
var OfferInput = objectType({
	material: enumType(MATERIALS),
	quantity: numberType().positive().max(50),
	distanceKm: numberType().min(0).optional(),
	address: stringType().max(200).optional()
}).superRefine((val, ctx) => {
	if (val.distanceKm !== void 0 && val.distanceKm > MAX_SERVICE_KM) ctx.addIssue({
		code: ZodIssueCode.custom,
		message: TOO_FAR_MESSAGE,
		path: ["distanceKm"]
	});
});
function parseOfferInput(input) {
	const result = OfferInput.safeParse(input);
	if (!result.success) {
		if (result.error.issues.find((i) => i.message === TOO_FAR_MESSAGE)) throw new Error(TOO_FAR_MESSAGE);
		throw new Error(result.error.issues[0]?.message ?? "Invalid booking details");
	}
	return result.data;
}
var computeOffer_createServerFn_handler = createServerRpc({
	id: "04f96c60f2e8c59fbbbaa44e49e4a8b28592812cb1ecec1bc4098abc6c6e138b",
	name: "computeOffer",
	filename: "src/lib/booking.functions.ts"
}, (opts) => computeOffer.__executeServer(opts));
var computeOffer = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(parseOfferInput).handler(computeOffer_createServerFn_handler, async ({ data, context }) => {
	const { supabase } = context;
	const distanceKm = data.distanceKm ?? 15;
	const { data: guide, error } = await supabase.rpc("compute_material_offer", {
		_material: data.material,
		_quantity: data.quantity,
		_distance_km: distanceKm
	});
	if (error) throw new Error(error.message);
	const g = guide;
	const offer = Number(g.offer ?? 0);
	const min = Number(g.min ?? 0);
	const max = Number(g.max ?? 0);
	const etaMinutes = Math.max(10, Math.round(distanceKm / 40 * 60) + 20);
	const label = g.label ?? data.material.replace("_", " ");
	return {
		offer,
		min,
		max,
		step: Number(g.step ?? 5),
		label,
		unit: g.unit ?? "10-15 m³ load",
		enforced: Boolean(g.enforced),
		etaMinutes,
		distanceKm: Math.round(distanceKm),
		explanation: `Fair rate for ${label} — ${data.quantity} m³, ${Math.round(distanceKm)} km.`
	};
});
var ExplainInput = objectType({
	material: stringType().max(50),
	quantity: numberType().positive().max(50),
	distanceKm: numberType().min(0).transform((v) => Math.min(v, MAX_SERVICE_KM))
});
/**
* Best-effort AI explanation. Called in the background after the offer is shown.
*/
var explainOffer_createServerFn_handler = createServerRpc({
	id: "fdd4242533399c1b51ef088f84151dd36055762fa6349f018cd8a8ae3ba1d2ee",
	name: "explainOffer",
	filename: "src/lib/booking.functions.ts"
}, (opts) => explainOffer.__executeServer(opts));
var explainOffer = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((input) => ExplainInput.parse(input)).handler(explainOffer_createServerFn_handler, async ({ data }) => {
	const fallback = `Fair rate for ${data.material.replace("_", " ")} — ${data.quantity} m³, ${Math.round(data.distanceKm)} km.`;
	try {
		const key = process.env.LOVABLE_API_KEY;
		if (!key) return { explanation: fallback };
		const { generateText } = await import("../_libs/ai.mjs").then((n) => n.t);
		const { createLovableAiGatewayProvider } = await import("./ai-gateway.server-KgHAfzs5.mjs");
		const { text } = await generateText({
			model: createLovableAiGatewayProvider(key)("google/gemini-3-flash-preview"),
			prompt: `Write ONE friendly sentence (max 18 words) explaining a fair transport offer to a construction customer in Zimbabwe. Do NOT mention any price number, ranges, minimums, maximums, formulas, or dollar figures. Only reference material, quantity, and distance qualitatively. Material: ${data.material}. Quantity: ${data.quantity} m³. Distance: ~${Math.round(data.distanceKm)} km. Return plain text, no quotes.`
		});
		return { explanation: text?.trim().replace(/^["']|["']$/g, "") || fallback };
	} catch {
		return { explanation: fallback };
	}
});
//#endregion
export { computeOffer_createServerFn_handler, explainOffer_createServerFn_handler };
