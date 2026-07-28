//#region node_modules/.nitro/vite/services/ssr/assets/geolocate-BpDbz8US.js
async function locateOnce({ onUpdate, timeoutMs = 2e4 } = {}) {
	if (typeof navigator === "undefined" || !("geolocation" in navigator)) throw new Error("Geolocation is not supported on this device");
	try {
		if ((await navigator.permissions?.query?.({ name: "geolocation" }))?.state === "denied") throw new Error("Location permission is blocked. Enable it in your browser settings.");
	} catch {}
	return new Promise((resolve, reject) => {
		let resolved = false;
		let bestAcc = Infinity;
		const finish = (c) => {
			if (resolved) {
				if ((c.accuracy ?? Infinity) < bestAcc) {
					bestAcc = c.accuracy ?? Infinity;
					onUpdate?.(c);
				}
				return;
			}
			resolved = true;
			bestAcc = c.accuracy ?? Infinity;
			resolve(c);
		};
		const fail = (e) => {
			if (resolved) return;
			resolved = true;
			const msg = "code" in e ? e.code === 1 ? "Location permission denied. Enable it in your browser settings." : e.code === 2 ? "Your device could not determine your location. Try moving near a window or outside." : "Getting your location took too long. Check your GPS / internet and try again." : e.message || "Could not get location";
			reject(new Error(msg));
		};
		navigator.geolocation.getCurrentPosition((pos) => finish({
			lat: pos.coords.latitude,
			lng: pos.coords.longitude,
			accuracy: pos.coords.accuracy
		}), () => {}, {
			enableHighAccuracy: false,
			timeout: 8e3,
			maximumAge: 3e4
		});
		navigator.geolocation.getCurrentPosition((pos) => finish({
			lat: pos.coords.latitude,
			lng: pos.coords.longitude,
			accuracy: pos.coords.accuracy
		}), (err) => fail(err), {
			enableHighAccuracy: true,
			timeout: timeoutMs,
			maximumAge: 0
		});
		setTimeout(() => {
			if (!resolved) fail(/* @__PURE__ */ new Error("Getting your location took too long. Move outside or check GPS and try again."));
		}, timeoutMs + 500);
	});
}
//#endregion
export { locateOnce };
