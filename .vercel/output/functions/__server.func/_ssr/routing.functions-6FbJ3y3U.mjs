import { l as createServerFn } from "./esm-Dova13aH.mjs";
import { t as createSsrRpc } from "./createSsrRpc-5dJhInVq.mjs";
import { nt as objectType, tt as numberType } from "../_libs/@ai-sdk/gateway+[...].mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routing.functions-6FbJ3y3U.js
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
var routing_functions_exports = /* @__PURE__ */ __exportAll({ getRoute: () => getRoute });
var RouteInput = objectType({
	startLat: numberType(),
	startLng: numberType(),
	destLat: numberType(),
	destLng: numberType()
});
/**
* Real road route via OSRM's free public routing API, with a haversine
* fallback so bookings still get a distance estimate if OSRM is slow/down.
*/
var getRoute = createServerFn({ method: "POST" }).inputValidator((input) => RouteInput.parse(input)).handler(createSsrRpc("1c6c71434ab46b355c7a124c4cc97e4dcd02cd6678474c55ccb412a274e97972"));
//#endregion
export { routing_functions_exports as n, getRoute as t };
