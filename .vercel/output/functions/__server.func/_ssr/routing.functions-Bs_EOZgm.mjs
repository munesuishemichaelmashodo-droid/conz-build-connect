import { l as createServerFn } from "./esm-Dova13aH.mjs";
import { t as createServerRpc } from "./createServerRpc-WJgk8O8C.mjs";
import { nt as objectType, tt as numberType } from "../_libs/@ai-sdk/gateway+[...].mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routing.functions-Bs_EOZgm.js
var RouteInput = objectType({
	startLat: numberType(),
	startLng: numberType(),
	destLat: numberType(),
	destLng: numberType()
});
function haversineKm(a, b) {
	const R = 6371;
	const toRad = (d) => d * Math.PI / 180;
	const dLat = toRad(b.lat - a.lat);
	const dLng = toRad(b.lng - a.lng);
	const lat1 = toRad(a.lat);
	const lat2 = toRad(b.lat);
	const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
	return 2 * R * Math.asin(Math.sqrt(h));
}
/**
* Real road route via OSRM's free public routing API, with a haversine
* fallback so bookings still get a distance estimate if OSRM is slow/down.
*/
var getRoute_createServerFn_handler = createServerRpc({
	id: "1c6c71434ab46b355c7a124c4cc97e4dcd02cd6678474c55ccb412a274e97972",
	name: "getRoute",
	filename: "src/lib/routing.functions.ts"
}, (opts) => getRoute.__executeServer(opts));
var getRoute = createServerFn({ method: "POST" }).inputValidator((input) => RouteInput.parse(input)).handler(getRoute_createServerFn_handler, async ({ data }) => {
	const { startLat, startLng, destLat, destLng } = data;
	const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${destLng},${destLat}?overview=full&geometries=geojson`;
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 6e3);
		const res = await fetch(url, {
			signal: controller.signal,
			headers: { Accept: "application/json" }
		});
		clearTimeout(timeout);
		if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
		const r = (await res.json()).routes?.[0];
		if (!r) throw new Error("No route returned");
		const distanceKm = r.distance / 1e3;
		const etaMin = Math.max(1, Math.round(r.duration / 60));
		const coords = r.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
		return {
			distanceKm: Math.round(distanceKm * 10) / 10,
			etaMin,
			coords,
			source: "osrm"
		};
	} catch {
		const distanceKm = haversineKm({
			lat: startLat,
			lng: startLng
		}, {
			lat: destLat,
			lng: destLng
		});
		const etaMin = Math.max(5, Math.round(distanceKm / 40 * 60) + 15);
		return {
			distanceKm: Math.round(distanceKm * 10) / 10,
			etaMin,
			coords: [[startLat, startLng], [destLat, destLng]],
			source: "haversine"
		};
	}
});
//#endregion
export { getRoute_createServerFn_handler };
