//#region node_modules/.nitro/vite/services/ssr/assets/osm-geocode-ERMsFbDH.js
async function reverseGeocode(lat, lng) {
	try {
		const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`, { headers: { Accept: "application/json" } });
		if (!res.ok) return null;
		return (await res.json())?.display_name ?? null;
	} catch {
		return null;
	}
}
async function searchAddress(query, limit = 6) {
	const q = query.trim();
	if (q.length < 3) return [];
	try {
		const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&limit=${limit}&addressdetails=1&countrycodes=zw&viewbox=25.2%2C-15.6%2C33.1%2C-22.5&bounded=1`, { headers: { Accept: "application/json" } });
		if (!res.ok) return [];
		return (await res.json()).map((d) => ({
			label: d.display_name,
			lat: parseFloat(d.lat),
			lng: parseFloat(d.lon)
		}));
	} catch {
		return [];
	}
}
//#endregion
export { searchAddress as n, reverseGeocode as t };
