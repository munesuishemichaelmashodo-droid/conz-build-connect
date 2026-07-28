import { o as __toESM } from "../_runtime.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/location-privacy-BVeQVH5l.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var KEY = "conz.locationSharingEnabled";
function getLocationSharingEnabled() {
	if (typeof window === "undefined") return true;
	const v = window.localStorage.getItem(KEY);
	return v === null ? true : v === "true";
}
function setLocationSharingEnabled(enabled) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(KEY, String(enabled));
	window.dispatchEvent(new CustomEvent("conz:location-sharing-changed", { detail: enabled }));
}
function useLocationSharingEnabled() {
	const [enabled, setEnabled] = (0, import_react.useState)(() => getLocationSharingEnabled());
	(0, import_react.useEffect)(() => {
		const onChange = (e) => setEnabled(e.detail);
		const onStorage = (e) => {
			if (e.key === KEY) setEnabled(e.newValue === null ? true : e.newValue === "true");
		};
		window.addEventListener("conz:location-sharing-changed", onChange);
		window.addEventListener("storage", onStorage);
		return () => {
			window.removeEventListener("conz:location-sharing-changed", onChange);
			window.removeEventListener("storage", onStorage);
		};
	}, []);
	return [enabled, (v) => setLocationSharingEnabled(v)];
}
//#endregion
export { useLocationSharingEnabled as t };
