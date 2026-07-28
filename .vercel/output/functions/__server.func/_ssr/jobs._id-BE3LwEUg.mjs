import { o as __toESM } from "../_runtime.mjs";
import { t as supabase } from "./client-BEr3FmPh.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { g as Link, v as useNavigate } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { t as cn } from "./utils-C_uf36nf.mjs";
import { t as Button } from "./button-Bq5vK6RO.mjs";
import { D as Route, F as Navigation2, K as LoaderCircle, M as PackageCheck, P as Navigation, R as MessageSquare, Tt as ArrowLeft, V as MapPin, X as Image, _t as Calendar, ct as Clock, dt as CircleCheck, et as Flag, f as Star, gt as Camera, j as PackageOpen, l as Trash2, lt as Circle, o as Truck, p as Square, r as Wallet, tt as FileText, y as ShieldOff } from "../_libs/lucide-react.mjs";
import { r as useQueryClient, t as useQuery } from "../_libs/tanstack__react-query.mjs";
import { n as useAuth } from "./auth-Dij6GkaO.mjs";
import { n as AvatarFallback$1, r as AvatarImage$1, t as Avatar$1 } from "../_libs/@radix-ui/react-avatar+[...].mjs";
import { n as toast } from "../_libs/sonner.mjs";
import { t as AppShell } from "./AppShell-n1riXnH5.mjs";
import { n as Section, r as StatusBadge } from "./ui-bits-DE9HqP-8.mjs";
import { a as statusInfo, i as money, n as levelInfo, r as materialLabel } from "./domain-CYaPqfcD.mjs";
import { t as Textarea } from "./textarea-kko37XEX.mjs";
import { t as Input } from "./input-B8Q2ztVi.mjs";
import { t as Label } from "./label-DBD1bRRP.mjs";
import { t as require_leaflet_src } from "../_libs/leaflet.mjs";
import { a as MapContainer, i as Marker, n as Popup, r as Polyline, s as useMapEvents, t as TileLayer } from "../_libs/react-leaflet.mjs";
import { t as motion } from "../_libs/framer-motion.mjs";
import { a as DialogHeader, i as DialogFooter, n as DialogContent, o as DialogTitle, r as DialogDescription, s as DialogTrigger, t as Dialog } from "./dialog-DIo89e4g.mjs";
import { t as getRoute } from "./routing.functions-oIsdjvP1.mjs";
import { t as Route$1 } from "./jobs._id-RXZDsSRf.mjs";
import { t as useLocationSharingEnabled } from "./location-privacy-BVeQVH5l.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/jobs._id-BE3LwEUg.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var import_leaflet_src = /* @__PURE__ */ __toESM(require_leaflet_src());
var Avatar = import_react.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Avatar$1, {
	ref,
	className: cn("relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full", className),
	...props
}));
Avatar.displayName = Avatar$1.displayName;
var AvatarImage = import_react.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AvatarImage$1, {
	ref,
	className: cn("aspect-square h-full w-full", className),
	...props
}));
AvatarImage.displayName = AvatarImage$1.displayName;
var AvatarFallback = import_react.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AvatarFallback$1, {
	ref,
	className: cn("flex h-full w-full items-center justify-center rounded-full bg-muted", className),
	...props
}));
AvatarFallback.displayName = AvatarFallback$1.displayName;
/**
* Formatting helpers for route distance / duration / arrival time.
* Pure functions — no React, no DOM. Safe to unit-test and to call on the server.
*/
/**
* Human-friendly distance.
*   0.42  -> "420 m"
*   1     -> "1.0 km"
*   7.35  -> "7.4 km"
*   128.4 -> "128 km"
*/
function formatDistance(km) {
	if (km == null || !Number.isFinite(km) || km < 0) return "—";
	if (km < 1) {
		const m = Math.round(km * 1e3);
		return `${m < 100 ? m : Math.round(m / 10) * 10} m`;
	}
	if (km < 10) return `${km.toFixed(1)} km`;
	return `${Math.round(km)} km`;
}
/**
* Human-friendly duration from minutes.
*   0.4  -> "<1 min"
*   9    -> "9 min"
*   75   -> "1 h 15 min"
*   120  -> "2 h"
*/
function formatDuration(min) {
	if (min == null || !Number.isFinite(min) || min < 0) return "—";
	const total = Math.round(min);
	if (total < 1) return "<1 min";
	if (total < 60) return `${total} min`;
	const h = Math.floor(total / 60);
	const m = total % 60;
	return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
/**
* Clock time of arrival, e.g. "14:32".
* `now` is injectable so this is deterministic in tests.
*/
function formatArrival(etaMin, now = /* @__PURE__ */ new Date(), locale) {
	if (etaMin == null || !Number.isFinite(etaMin) || etaMin < 0) return "—";
	return new Date(now.getTime() + etaMin * 6e4).toLocaleTimeString(locale, {
		hour: "2-digit",
		minute: "2-digit"
	});
}
/**
* Rough trip cost estimate. Returns null when no rate is configured,
* so the UI can simply omit the chip.
*/
function formatFare(km, ratePerKm, currency = "USD", locale) {
	if (km == null || ratePerKm == null) return null;
	if (!Number.isFinite(km) || !Number.isFinite(ratePerKm)) return null;
	const amount = km * ratePerKm;
	try {
		return new Intl.NumberFormat(locale, {
			style: "currency",
			currency,
			maximumFractionDigits: 2
		}).format(amount);
	} catch {
		return `${currency} ${amount.toFixed(2)}`;
	}
}
function Stat({ icon, label, value }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex flex-col items-center gap-0.5 flex-1 min-w-0",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
			className: "flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground",
			children: [icon, label]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "text-sm font-semibold tabular-nums truncate",
			children: value
		})]
	});
}
function RouteStats({ distanceKm, etaMin, loading = false, ratePerKm = null, currency = "USD" }) {
	const [now, setNow] = (0, import_react.useState)(() => /* @__PURE__ */ new Date());
	(0, import_react.useEffect)(() => {
		if (etaMin == null) return;
		const id = setInterval(() => setNow(/* @__PURE__ */ new Date()), 3e4);
		return () => clearInterval(id);
	}, [etaMin]);
	if (loading) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "px-4 py-3 flex items-center justify-center gap-2 text-xs text-muted-foreground",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-3 h-3 animate-spin" }), "Calculating routeâ€¦"]
	});
	if (distanceKm == null || etaMin == null) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "px-4 py-3 flex items-center justify-center gap-2 text-xs text-muted-foreground",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(MapPin, { className: "w-3 h-3" }), "Tap the map to set a destination."]
	});
	const fare = formatFare(distanceKm, ratePerKm, currency);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "px-4 py-3 flex items-stretch gap-2 divide-x divide-border",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
				icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Navigation, { className: "w-3 h-3" }),
				label: "Distance",
				value: formatDistance(distanceKm)
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
				icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Clock, { className: "w-3 h-3" }),
				label: "Duration",
				value: formatDuration(etaMin)
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
				icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MapPin, { className: "w-3 h-3" }),
				label: "Arrive",
				value: formatArrival(etaMin, now)
			}),
			fare ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
				icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Wallet, { className: "w-3 h-3" }),
				label: "Est. fare",
				value: fare
			}) : null
		]
	});
}
var truckIcon$1 = import_leaflet_src.default.divIcon({
	className: "",
	html: `<div style="background:hsl(var(--primary));color:hsl(var(--primary-foreground));width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);font-size:16px">🚛</div>`,
	iconSize: [32, 32],
	iconAnchor: [16, 16]
});
var destIcon = import_leaflet_src.default.divIcon({
	className: "",
	html: `<div style="background:hsl(var(--foreground));color:hsl(var(--background));width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)"><span style="transform:rotate(45deg);font-size:14px">📍</span></div>`,
	iconSize: [28, 28],
	iconAnchor: [14, 28]
});
function RouteMap({ driverLocation, initialDestination = null, onRoute, height = 320, showNavigateButton = false }) {
	const [destination, setDestination] = (0, import_react.useState)(initialDestination);
	const [route, setRoute] = (0, import_react.useState)(null);
	const [loading, setLoading] = (0, import_react.useState)(false);
	async function fetchRoute(dest) {
		setLoading(true);
		try {
			const r = await getRoute({ data: {
				startLat: driverLocation.lat,
				startLng: driverLocation.lng,
				destLat: dest.lat,
				destLng: dest.lng
			} });
			setRoute(r);
			onRoute?.(r);
		} catch (e) {
			console.error("Route fetch failed:", e);
			toast.error(e?.message ?? "Could not calculate route");
		} finally {
			setLoading(false);
		}
	}
	function ClickHandler() {
		useMapEvents({ click(e) {
			const d = {
				lat: e.latlng.lat,
				lng: e.latlng.lng
			};
			setDestination(d);
			fetchRoute(d);
		} });
		return null;
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "rounded-2xl bg-card border overflow-hidden",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-center gap-2 px-4 pt-4 pb-2 font-display font-bold uppercase text-sm tracking-wide",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Route, { className: "w-4 h-4 text-primary" }), " Route & ETA"]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "px-4 pb-2 text-xs text-muted-foreground",
				children: "Tap the map to drop a destination and see the driving route."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				style: { height },
				className: "w-full",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(MapContainer, {
					center: [driverLocation.lat, driverLocation.lng],
					zoom: 13,
					scrollWheelZoom: false,
					style: {
						height: "100%",
						width: "100%"
					},
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TileLayer, {
							attribution: "© OpenStreetMap",
							url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ClickHandler, {}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Marker, {
							position: [driverLocation.lat, driverLocation.lng],
							icon: truckIcon$1,
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Popup, { children: "Driver" })
						}),
						destination && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Marker, {
							position: [destination.lat, destination.lng],
							icon: destIcon,
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Popup, { children: "Destination" })
						}),
						route?.coords?.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Polyline, {
							positions: route.coords,
							pathOptions: {
								color: "hsl(var(--primary))",
								weight: 5,
								opacity: .85
							}
						}) : null
					]
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(RouteStats, {
				distanceKm: route?.distanceKm,
				etaMin: route?.etaMin,
				loading
			}),
			showNavigateButton && destination && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "px-4 pb-4",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
					href: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${destination.lat},${destination.lng}`)}&travelmode=driving`,
					target: "_blank",
					rel: "noopener noreferrer",
					className: "flex items-center justify-center gap-2 w-full rounded-xl bg-primary text-primary-foreground font-semibold text-sm py-2.5 hover:opacity-90 transition",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Navigation2, { className: "w-4 h-4" }), " Navigate with Google Maps"]
				})
			})
		]
	});
}
var truckIcon = import_leaflet_src.default.divIcon({
	className: "",
	html: `<div style="background:hsl(var(--primary));color:hsl(var(--primary-foreground));width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);font-size:16px">🚛</div>`,
	iconSize: [32, 32],
	iconAnchor: [16, 16]
});
function DriverShareLocation({ jobId, driverId }) {
	const [sharing, setSharing] = (0, import_react.useState)(false);
	const [busy, setBusy] = (0, import_react.useState)(false);
	const watchRef = (0, import_react.useRef)(null);
	const [privacyOn] = useLocationSharingEnabled();
	const stopWatch = () => {
		if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
		watchRef.current = null;
	};
	(0, import_react.useEffect)(() => () => stopWatch(), []);
	(0, import_react.useEffect)(() => {
		if (!privacyOn && (sharing || watchRef.current !== null)) {
			stopWatch();
			setSharing(false);
			supabase.from("driver_locations").delete().eq("job_id", jobId).then(() => {
				toast.message("Live location sharing paused", { description: "You turned it off in privacy settings." });
			});
		}
	}, [privacyOn]);
	const push = async (pos) => {
		await supabase.from("driver_locations").upsert({
			job_id: jobId,
			driver_id: driverId,
			lat: pos.coords.latitude,
			lng: pos.coords.longitude,
			heading: pos.coords.heading,
			accuracy: pos.coords.accuracy,
			updated_at: (/* @__PURE__ */ new Date()).toISOString()
		}, { onConflict: "job_id" });
	};
	const start = async () => {
		if (!privacyOn) return toast.error("Location sharing is off in privacy settings");
		if (!("geolocation" in navigator)) return toast.error("Geolocation not supported");
		setBusy(true);
		try {
			const { locateOnce } = await import("./geolocate-BpDbz8US.mjs");
			const c = await locateOnce();
			await push({ coords: {
				latitude: c.lat,
				longitude: c.lng,
				heading: null,
				accuracy: c.accuracy ?? null
			} });
			watchRef.current = navigator.geolocation.watchPosition(push, (err) => toast.error(err.message), {
				enableHighAccuracy: true,
				maximumAge: 5e3,
				timeout: 2e4
			});
			setSharing(true);
			setBusy(false);
			toast.success("Live location sharing started");
		} catch (e) {
			setBusy(false);
			toast.error(e.message ?? "Could not get location");
		}
	};
	const stop = async () => {
		stopWatch();
		setSharing(false);
		await supabase.from("driver_locations").delete().eq("job_id", jobId);
		toast.success("Stopped sharing");
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "rounded-2xl bg-card border p-4 space-y-3",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-center gap-2 font-display font-bold uppercase text-sm tracking-wide",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Navigation2, { className: "w-4 h-4 text-primary" }), " Live GPS"]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs text-muted-foreground",
				children: "Share your live location with the customer while you deliver."
			}),
			!privacyOn ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs space-y-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-center gap-2 font-semibold text-warning",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ShieldOff, { className: "w-4 h-4" }), " Location sharing is turned off"]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "text-muted-foreground",
					children: [
						"Turn it back on in",
						" ",
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
							to: "/profile",
							className: "underline font-semibold",
							children: "privacy settings"
						}),
						" ",
						"to share your live GPS with customers."
					]
				})]
			}) : !sharing ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				onClick: start,
				disabled: busy,
				className: "w-full",
				children: busy ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-4 h-4 animate-spin" }) : "Start sharing location"
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
				onClick: stop,
				variant: "outline",
				className: "w-full",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Square, { className: "w-4 h-4 mr-2" }), " Stop sharing"]
			})
		]
	});
}
function CustomerTrackMap({ jobId }) {
	const [loc, setLoc] = (0, import_react.useState)(null);
	const [destination, setDestination] = (0, import_react.useState)(null);
	(0, import_react.useEffect)(() => {
		let mounted = true;
		(async () => {
			const { data } = await supabase.from("jobs").select("delivery_lat,delivery_lng").eq("id", jobId).maybeSingle();
			if (mounted && data?.delivery_lat != null && data?.delivery_lng != null) setDestination({
				lat: Number(data.delivery_lat),
				lng: Number(data.delivery_lng)
			});
		})();
		return () => {
			mounted = false;
		};
	}, [jobId]);
	(0, import_react.useEffect)(() => {
		let mounted = true;
		const load = async () => {
			const { data } = await supabase.from("driver_locations").select("*").eq("job_id", jobId).maybeSingle();
			if (mounted && data) setLoc(data);
		};
		load();
		const channel = supabase.channel(`track:${jobId}`).on("postgres_changes", {
			event: "*",
			schema: "public",
			table: "driver_locations",
			filter: `job_id=eq.${jobId}`
		}, (payload) => {
			if (payload.eventType === "DELETE") setLoc(null);
			else setLoc(payload.new);
		}).subscribe();
		return () => {
			mounted = false;
			supabase.removeChannel(channel);
		};
	}, [jobId]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-3",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "rounded-2xl bg-card border overflow-hidden",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-center gap-2 px-4 pt-4 pb-2 font-display font-bold uppercase text-sm tracking-wide",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(MapPin, { className: "w-4 h-4 text-primary" }), " Live driver location"]
			}), !loc ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "px-4 pb-4 text-xs text-muted-foreground",
				children: "Driver hasn't started sharing location yet."
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "h-64 w-full",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(MapContainer, {
					center: [loc.lat, loc.lng],
					zoom: 15,
					scrollWheelZoom: false,
					style: {
						height: "100%",
						width: "100%"
					},
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TileLayer, {
						attribution: "© OpenStreetMap",
						url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Marker, {
						position: [loc.lat, loc.lng],
						icon: truckIcon,
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Popup, { children: ["Updated ", new Date(loc.updated_at).toLocaleTimeString()] })
					})]
				}, `${loc.lat},${loc.lng}`)
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "px-4 py-2 text-[11px] text-muted-foreground flex justify-between",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
					loc.lat.toFixed(5),
					", ",
					loc.lng.toFixed(5)
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["Updated ", new Date(loc.updated_at).toLocaleTimeString()] })]
			})] })]
		}), loc && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RouteMap, {
			driverLocation: {
				lat: loc.lat,
				lng: loc.lng
			},
			initialDestination: destination
		})]
	});
}
function DriverRouteView({ jobId }) {
	const [origin, setOrigin] = (0, import_react.useState)(null);
	const [destination, setDestination] = (0, import_react.useState)(null);
	const [error, setError] = (0, import_react.useState)(null);
	const [loading, setLoading] = (0, import_react.useState)(true);
	(0, import_react.useEffect)(() => {
		let mounted = true;
		(async () => {
			const { data } = await supabase.from("jobs").select("delivery_lat,delivery_lng").eq("id", jobId).maybeSingle();
			if (mounted && data?.delivery_lat != null && data?.delivery_lng != null) setDestination({
				lat: Number(data.delivery_lat),
				lng: Number(data.delivery_lng)
			});
		})();
		(async () => {
			try {
				const { locateOnce } = await import("./geolocate-BpDbz8US.mjs");
				const c = await locateOnce();
				if (mounted) setOrigin({
					lat: c.lat,
					lng: c.lng
				});
			} catch (e) {
				if (mounted) setError(e?.message ?? "Could not get your location");
			} finally {
				if (mounted) setLoading(false);
			}
		})();
		return () => {
			mounted = false;
		};
	}, [jobId]);
	if (loading) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "rounded-2xl bg-card border p-4 text-xs text-muted-foreground flex items-center gap-2",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-3 h-3 animate-spin" }), " Loading route to delivery point…"]
	});
	if (!destination) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "rounded-2xl bg-card border p-4 text-xs text-muted-foreground",
		children: "No delivery coordinates on this job — route can't be calculated."
	});
	if (!origin) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "rounded-2xl bg-card border p-4 text-xs text-muted-foreground",
		children: error ?? "Location required to show the route."
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RouteMap, {
		driverLocation: origin,
		initialDestination: destination,
		showNavigateButton: true
	});
}
var MESSAGES = [
	"Searching for nearby tipper trucks…",
	"Finding the best available driver…",
	"Matching you with a verified truck…"
];
function RadarSearch({ etaMinutes = 5, nearbyDrivers }) {
	const [i, setI] = (0, import_react.useState)(0);
	(0, import_react.useEffect)(() => {
		const t = setInterval(() => setI((v) => (v + 1) % MESSAGES.length), 2500);
		return () => clearInterval(t);
	}, []);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "relative rounded-3xl overflow-hidden bg-gradient-dark text-white p-8 shadow-lift",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "relative mx-auto w-64 h-64 flex items-center justify-center",
				children: [
					[
						0,
						1,
						2
					].map((ring) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(motion.div, {
						className: "absolute inset-0 rounded-full border border-primary/40",
						initial: {
							scale: .2,
							opacity: .8
						},
						animate: {
							scale: 1,
							opacity: 0
						},
						transition: {
							duration: 3,
							repeat: Infinity,
							delay: ring,
							ease: "easeOut"
						}
					}, ring)),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(motion.div, {
						className: "absolute inset-0 rounded-full",
						style: {
							background: "conic-gradient(from 0deg, transparent 0deg, var(--color-primary) 30deg, transparent 60deg)",
							opacity: .35
						},
						animate: { rotate: 360 },
						transition: {
							duration: 2.4,
							repeat: Infinity,
							ease: "linear"
						}
					}),
					[
						0,
						1,
						2
					].map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(motion.div, {
						className: "absolute w-8 h-8 rounded-full bg-primary/90 text-primary-foreground flex items-center justify-center shadow-lift",
						animate: { rotate: 360 },
						transition: {
							duration: 6 + t * 1.5,
							repeat: Infinity,
							ease: "linear",
							delay: t * .8
						},
						style: {
							transformOrigin: `0 ${70 + t * 20}px`,
							top: "50%",
							left: "50%",
							marginTop: -(70 + t * 20),
							marginLeft: -16
						},
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Truck, { className: "w-4 h-4" })
					}, t)),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "relative z-10 w-16 h-16 rounded-full bg-primary flex items-center justify-center shadow-lift",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "w-3 h-3 rounded-full bg-primary-foreground animate-pulse" })
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(motion.div, {
				initial: {
					opacity: 0,
					y: 8
				},
				animate: {
					opacity: 1,
					y: 0
				},
				exit: { opacity: 0 },
				transition: { duration: .4 },
				className: "text-center mt-6 font-display text-lg tracking-wide",
				children: MESSAGES[i]
			}, i),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "text-center text-xs text-white/60 mt-2 space-y-0.5",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: ["Estimated wait: ", /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
					className: "text-primary font-semibold",
					children: [
						etaMinutes,
						"–",
						etaMinutes + 5,
						" min"
					]
				})] }), typeof nearbyDrivers === "number" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "text-primary font-semibold",
						children: nearbyDrivers
					}),
					" ",
					"verified ",
					nearbyDrivers === 1 ? "driver" : "drivers",
					" active nearby"
				] })]
			})
		]
	});
}
function JobDetail() {
	const { id } = Route$1.useParams();
	const { userId, is } = useAuth();
	const qc = useQueryClient();
	const nav = useNavigate();
	const { data: job, isLoading } = useQuery({
		queryKey: ["job", id],
		queryFn: async () => {
			const { data, error } = await supabase.from("jobs").select("*").eq("id", id).maybeSingle();
			if (error) throw error;
			return data;
		}
	});
	const { data: bids } = useQuery({
		queryKey: ["bids", id],
		enabled: !!job,
		queryFn: async () => {
			const { data: bids } = await supabase.from("bids").select("*").eq("job_id", id).order("price");
			if (!bids?.length) return [];
			const driverIds = [...new Set(bids.map((b) => b.driver_id))];
			const [{ data: profs }, { data: drvs }] = await Promise.all([supabase.from("profiles").select("id,full_name,avatar_url").in("id", driverIds), supabase.from("driver_public_profiles").select("user_id,rating_avg,rating_count,level,jobs_completed").in("user_id", driverIds)]);
			return bids.map((b) => ({
				...b,
				profile: profs?.find((p) => p.id === b.driver_id),
				driver: drvs?.find((d) => d.user_id === b.driver_id)
			}));
		}
	});
	const showRadar = !!job && job.customer_id === userId && job.status === "open" && (bids?.length ?? 0) === 0;
	const { data: nearbyDrivers } = useQuery({
		queryKey: ["nearby-drivers", id],
		enabled: showRadar,
		refetchInterval: 15e3,
		queryFn: async () => {
			const { data, error } = await supabase.rpc("count_available_verified_drivers", { _job_id: id });
			if (error) throw error;
			return typeof data === "number" ? data : 0;
		}
	});
	if (isLoading || !job) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AppShell, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "text-center text-muted-foreground py-10",
		children: "Loading…"
	}) });
	const isOwner = job.customer_id === userId;
	const isAssignedDriver = job.driver_id === userId;
	const s = statusInfo(job.status);
	const myBid = bids?.find((b) => b.driver_id === userId);
	const acceptBid = async (bidId) => {
		const { error } = await supabase.rpc("accept_bid", { _bid_id: bidId });
		if (error) return toast.error(error.message);
		toast.success("Bid accepted!");
		qc.invalidateQueries({ queryKey: ["job", id] });
		qc.invalidateQueries({ queryKey: ["bids", id] });
	};
	const completeJob = async () => {
		const { error } = await supabase.rpc("complete_job", { _job_id: id });
		if (error) return toast.error(error.message);
		toast.success("Delivery confirmed.");
		qc.invalidateQueries({ queryKey: ["job", id] });
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(AppShell, {
		title: "Job",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
			to: "/jobs",
			className: "inline-flex items-center gap-1 text-sm text-muted-foreground mb-4",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowLeft, { className: "w-4 h-4" }), " Back"]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "space-y-4",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(JobTimeline, { job }),
				isOwner && job.status === "open" && (bids?.length ?? 0) === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RadarSearch, {
					etaMinutes: 5,
					nearbyDrivers
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "rounded-2xl bg-card border p-5 shadow-soft",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex items-start justify-between gap-3",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
								className: "font-display font-bold text-2xl",
								children: materialLabel(job.material, job.custom_material)
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusBadge, {
								label: s.label,
								className: s.className
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mt-3 grid grid-cols-2 gap-3 text-sm",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "text-[11px] uppercase text-muted-foreground tracking-widest",
								children: "Quantity"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "font-semibold",
								children: [Number(job.quantity_m3), " m³"]
							})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "text-[11px] uppercase text-muted-foreground tracking-widest",
								children: isOwner ? "Your offer" : "Offer"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "font-display font-bold text-primary text-lg",
								children: money(Number(job.budget))
							})] })]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mt-3 flex items-start gap-2 text-sm",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(MapPin, { className: "w-4 h-4 text-muted-foreground mt-0.5" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: job.delivery_address })]
						}),
						job.preferred_date && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mt-2 flex items-center gap-2 text-sm",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Calendar, { className: "w-4 h-4 text-muted-foreground" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: job.preferred_date })]
						}),
						job.notes && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-3 text-sm text-muted-foreground border-t pt-3",
							children: job.notes
						}),
						job.final_price && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mt-3 pt-3 border-t text-sm flex justify-between",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "text-muted-foreground",
								children: "Agreed price"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "font-display font-bold text-primary",
								children: money(Number(job.final_price))
							})]
						})
					]
				}),
				(isOwner || isAssignedDriver) && job.status !== "open" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					asChild: true,
					variant: "outline",
					className: "w-full",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
						to: "/chat/$jobId",
						params: { jobId: id },
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(MessageSquare, { className: "w-4 h-4 mr-2" }), "Open chat"]
					})
				}),
				(isOwner || isAssignedDriver) && [
					"accepted",
					"in_progress",
					"completed"
				].includes(job.status) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RaiseDisputeDialog, {
					jobId: id,
					against: isOwner ? job.driver_id : job.customer_id
				}),
				(job.pickup_photo_url || job.delivery_photo_url) && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "rounded-2xl bg-card border p-4 space-y-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "font-display font-bold uppercase text-sm tracking-wide",
						children: "Proof of delivery"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "grid grid-cols-2 gap-3",
						children: [job.pickup_photo_url && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("figure", {
							className: "space-y-1",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
								src: job.pickup_photo_url,
								alt: "Load confirmed",
								className: "w-full aspect-square object-cover rounded-lg border"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("figcaption", {
								className: "text-xs font-semibold text-success flex items-center gap-1",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CircleCheck, { className: "w-3 h-3" }), " Load confirmed"]
							})]
						}), job.delivery_photo_url && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("figure", {
							className: "space-y-1",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
								src: job.delivery_photo_url,
								alt: "Delivery confirmed",
								className: "w-full aspect-square object-cover rounded-lg border"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("figcaption", {
								className: "text-xs font-semibold text-success flex items-center gap-1",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CircleCheck, { className: "w-3 h-3" }), " Delivery confirmed"]
							})]
						})]
					})]
				}),
				isAssignedDriver && job.status === "accepted" && !job.pickup_photo_url && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ProofUpload, {
					jobId: id,
					kind: "pickup",
					label: "Confirm Pickup",
					hint: "Take a photo of the loaded truck to start the trip.",
					onUploaded: async () => {
						await supabase.from("jobs").update({ status: "in_progress" }).eq("id", id);
						qc.invalidateQueries({ queryKey: ["job", id] });
					}
				}),
				isAssignedDriver && (job.status === "accepted" || job.status === "in_progress") && job.pickup_photo_url && !job.delivery_photo_url && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ProofUpload, {
					jobId: id,
					kind: "delivery",
					label: "Confirm Delivery",
					hint: "Take a photo at the delivery point. The customer can then confirm.",
					onUploaded: async () => {
						qc.invalidateQueries({ queryKey: ["job", id] });
					}
				}),
				isOwner && (job.status === "accepted" || job.status === "in_progress") && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
					onClick: completeJob,
					disabled: !job.delivery_photo_url,
					className: "w-full bg-success text-success-foreground hover:bg-success/90",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CircleCheck, { className: "w-4 h-4 mr-2" }), job.delivery_photo_url ? "Confirm delivery" : "Waiting for driver's delivery photo"]
				}),
				isAssignedDriver && (job.status === "accepted" || job.status === "in_progress") && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DriverRouteView, { jobId: id }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DriverShareLocation, {
					jobId: id,
					driverId: userId
				})] }),
				isOwner && (job.status === "accepted" || job.status === "in_progress") && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CustomerTrackMap, { jobId: id }),
				is("driver") && !isOwner && job.status === "open" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BidForm, {
					jobId: id,
					existing: myBid,
					onSaved: () => qc.invalidateQueries({ queryKey: ["bids", id] })
				}),
				isOwner && (job.status === "open" || job.status === "accepted" || job.status === "in_progress") && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CancelJobDialog, {
					jobId: id,
					status: job.status,
					onCancelled: () => nav({ to: "/jobs" })
				}),
				(isOwner || is("admin") || is("super_admin")) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
					title: `Bids (${bids?.length ?? 0})`,
					children: !bids?.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-muted-foreground",
						children: "No bids yet. Drivers are checking your request."
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "space-y-2",
						children: bids.map((b) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "rounded-xl bg-card border p-4",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "flex items-start justify-between gap-2",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "flex items-start gap-3 min-w-0",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Avatar, {
											className: "w-11 h-11 shrink-0 border",
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AvatarImage, {
												src: b.profile?.avatar_url ?? void 0,
												alt: b.profile?.full_name ?? "Driver"
											}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AvatarFallback, {
												className: "bg-primary/10 text-primary font-bold",
												children: (b.profile?.full_name ?? "D").trim().slice(0, 1).toUpperCase()
											})]
										}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
											className: "min-w-0",
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
												className: "font-semibold truncate",
												children: b.profile?.full_name ?? "Driver"
											}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
												className: "text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5",
												children: b.driver && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
													/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusBadge, {
														label: levelInfo(b.driver.level).label,
														className: levelInfo(b.driver.level).className
													}),
													/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
														className: "flex items-center gap-0.5",
														children: [
															/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Star, { className: "w-3 h-3 fill-warning text-warning" }),
															Number(b.driver.rating_avg || 0).toFixed(1),
															" ",
															/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
																className: "text-muted-foreground/70",
																children: [
																	"(",
																	b.driver.rating_count ?? 0,
																	")"
																]
															})
														]
													}),
													/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
														"• ",
														b.driver.jobs_completed ?? 0,
														" rides completed"
													] })
												] })
											})]
										})]
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "text-right",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
											className: "font-display font-bold text-primary text-xl",
											children: money(Number(b.price))
										}), b.delivery_date && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
											className: "text-[11px] text-muted-foreground",
											children: b.delivery_date
										})]
									})]
								}),
								b.message && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "text-sm text-muted-foreground mt-2",
									children: b.message
								}),
								isOwner && job.status === "open" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
									size: "sm",
									onClick: () => acceptBid(b.id),
									className: "w-full mt-3",
									children: "Accept this bid"
								}),
								b.status === "accepted" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusBadge, {
									label: "Accepted",
									className: "bg-success/15 text-success border-success/30 mt-2"
								})
							]
						}, b.id))
					})
				}),
				isOwner && job.status === "completed" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RateForm, {
					jobId: id,
					driverId: job.driver_id,
					onSaved: () => nav({ to: "/jobs" })
				}),
				isAssignedDriver && job.status === "completed" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RateCustomerForm, {
					jobId: id,
					customerId: job.customer_id,
					onSaved: () => nav({ to: "/jobs" })
				})
			]
		})]
	});
}
function BidForm({ jobId, existing, onSaved }) {
	const { userId } = useAuth();
	const [price, setPrice] = (0, import_react.useState)(existing?.price?.toString() ?? "");
	const [date, setDate] = (0, import_react.useState)(existing?.delivery_date ?? "");
	const [message, setMessage] = (0, import_react.useState)(existing?.message ?? "");
	const [loading, setLoading] = (0, import_react.useState)(false);
	const submit = async (e) => {
		e.preventDefault();
		const p = parseFloat(price);
		if (!p || p <= 0) return toast.error("Enter a valid price");
		setLoading(true);
		const { error } = await supabase.from("bids").upsert({
			job_id: jobId,
			driver_id: userId,
			price: p,
			delivery_date: date || null,
			message: message.trim() || null
		}, { onConflict: "job_id,driver_id" });
		setLoading(false);
		if (error) return toast.error(error.message);
		toast.success(existing ? "Bid updated" : "Bid submitted");
		onSaved();
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
		onSubmit: submit,
		className: "rounded-2xl bg-card border p-4 space-y-3",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "font-display font-bold uppercase text-sm tracking-wide",
				children: existing ? "Update your bid" : "Submit a bid"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid grid-cols-2 gap-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
					htmlFor: "bp",
					children: "Price ($)"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
					id: "bp",
					type: "number",
					inputMode: "decimal",
					min: 1,
					step: 1,
					value: price,
					onChange: (e) => setPrice(e.target.value),
					required: true
				})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
					htmlFor: "bd",
					children: "Delivery date"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
					id: "bd",
					type: "date",
					value: date,
					onChange: (e) => setDate(e.target.value)
				})] })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
				htmlFor: "bm",
				children: "Message"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Textarea, {
				id: "bm",
				value: message,
				onChange: (e) => setMessage(e.target.value),
				rows: 2,
				maxLength: 300,
				placeholder: "e.g. Can deliver tomorrow morning"
			})] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				type: "submit",
				disabled: loading,
				className: "w-full",
				children: loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-4 h-4 animate-spin" }) : existing ? "Update bid" : "Submit bid"
			})
		]
	});
}
function RateForm({ jobId, driverId, onSaved }) {
	const { userId } = useAuth();
	const [q, setQ] = (0, import_react.useState)(5);
	const [c, setC] = (0, import_react.useState)(5);
	const [r, setR] = (0, import_react.useState)(5);
	const [d, setD] = (0, import_react.useState)(5);
	const [comment, setComment] = (0, import_react.useState)("");
	const [loading, setLoading] = (0, import_react.useState)(false);
	const submit = async () => {
		setLoading(true);
		const { error } = await supabase.from("ratings").insert({
			job_id: jobId,
			customer_id: userId,
			driver_id: driverId,
			quality: q,
			communication: c,
			reliability: r,
			delivery_time: d,
			comment: comment.trim() || null
		});
		setLoading(false);
		if (error) return toast.error(error.message);
		toast.success("Thanks for the rating!");
		onSaved();
	};
	const Stars = ({ value, onChange, label }) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex items-center justify-between",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "text-sm",
			children: label
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "flex gap-1",
			children: [
				1,
				2,
				3,
				4,
				5
			].map((n) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				onClick: () => onChange(n),
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Star, { className: `w-5 h-5 ${n <= value ? "fill-warning text-warning" : "text-muted-foreground"}` })
			}, n))
		})]
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "rounded-2xl bg-card border p-4 space-y-3",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "font-display font-bold uppercase text-sm tracking-wide",
				children: "Rate this driver"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stars, {
				value: q,
				onChange: setQ,
				label: "Quality"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stars, {
				value: c,
				onChange: setC,
				label: "Communication"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stars, {
				value: r,
				onChange: setR,
				label: "Reliability"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stars, {
				value: d,
				onChange: setD,
				label: "Delivery time"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Textarea, {
				value: comment,
				onChange: (e) => setComment(e.target.value),
				rows: 2,
				maxLength: 300,
				placeholder: "Optional comment"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				onClick: submit,
				disabled: loading,
				className: "w-full",
				children: loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-4 h-4 animate-spin" }) : "Submit rating"
			})
		]
	});
}
function RateCustomerForm({ jobId, customerId, onSaved }) {
	const { userId } = useAuth();
	const [punctuality, setP] = (0, import_react.useState)(5);
	const [communication, setC] = (0, import_react.useState)(5);
	const [payment, setPay] = (0, import_react.useState)(5);
	const [overall, setO] = (0, import_react.useState)(5);
	const [comment, setComment] = (0, import_react.useState)("");
	const [loading, setLoading] = (0, import_react.useState)(false);
	const [done, setDone] = (0, import_react.useState)(false);
	const submit = async () => {
		setLoading(true);
		const { error } = await supabase.from("customer_ratings").insert({
			job_id: jobId,
			driver_id: userId,
			customer_id: customerId,
			punctuality,
			communication,
			payment,
			overall,
			comment: comment.trim() || null
		});
		setLoading(false);
		if (error) return toast.error(error.message);
		toast.success("Thanks for rating the customer!");
		setDone(true);
		onSaved();
	};
	const Stars = ({ value, onChange, label }) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex items-center justify-between",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "text-sm",
			children: label
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "flex gap-1",
			children: [
				1,
				2,
				3,
				4,
				5
			].map((n) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				onClick: () => onChange(n),
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Star, { className: `w-5 h-5 ${n <= value ? "fill-warning text-warning" : "text-muted-foreground"}` })
			}, n))
		})]
	});
	if (done) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "rounded-2xl bg-card border p-4 space-y-3",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "font-display font-bold uppercase text-sm tracking-wide",
				children: "Rate this customer (optional)"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs text-muted-foreground",
				children: "Help other drivers by sharing your experience."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stars, {
				value: punctuality,
				onChange: setP,
				label: "Punctuality"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stars, {
				value: communication,
				onChange: setC,
				label: "Communication"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stars, {
				value: payment,
				onChange: setPay,
				label: "Payment"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stars, {
				value: overall,
				onChange: setO,
				label: "Overall"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Textarea, {
				value: comment,
				onChange: (e) => setComment(e.target.value),
				rows: 2,
				maxLength: 300,
				placeholder: "Optional comment"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				onClick: submit,
				disabled: loading,
				className: "w-full",
				children: loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-4 h-4 animate-spin" }) : "Submit rating"
			})
		]
	});
}
function ProofUpload({ jobId, kind, label, hint, onUploaded }) {
	const [uploading, setUploading] = (0, import_react.useState)(false);
	const upload = async (file) => {
		setUploading(true);
		const path = `${jobId}/${kind}.jpg`;
		const { error: uerr } = await supabase.storage.from("job-proof-photos").upload(path, file, {
			upsert: true,
			contentType: file.type || "image/jpeg"
		});
		if (uerr) {
			setUploading(false);
			return toast.error(uerr.message);
		}
		const { data: pub } = supabase.storage.from("job-proof-photos").getPublicUrl(path);
		const url = `${pub.publicUrl}?t=${Date.now()}`;
		const patch = kind === "pickup" ? { pickup_photo_url: url } : { delivery_photo_url: url };
		const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
		setUploading(false);
		if (error) return toast.error(error.message);
		toast.success(`${label} photo uploaded`);
		await onUploaded();
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "rounded-2xl border p-4 space-y-3 bg-card",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-center gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PackageCheck, { className: "w-5 h-5 text-primary" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "font-display font-bold uppercase text-sm tracking-wide",
					children: label
				})]
			}),
			hint && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs text-muted-foreground",
				children: hint
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid grid-cols-2 gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
					className: "flex items-center gap-2 rounded-lg border border-dashed bg-muted/40 hover:bg-muted transition p-3 cursor-pointer",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Camera, { className: "w-5 h-5 text-primary shrink-0" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "text-xs font-semibold",
							children: uploading ? "Uploading…" : "Take photo"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							type: "file",
							accept: "image/*",
							capture: "environment",
							disabled: uploading,
							onChange: (e) => e.target.files?.[0] && upload(e.target.files[0]),
							className: "hidden"
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
					className: "flex items-center gap-2 rounded-lg border border-dashed bg-muted/40 hover:bg-muted transition p-3 cursor-pointer",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Image, { className: "w-5 h-5 text-primary shrink-0" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "text-xs font-semibold",
							children: uploading ? "Uploading…" : "Choose from gallery"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							type: "file",
							accept: "image/*",
							disabled: uploading,
							onChange: (e) => e.target.files?.[0] && upload(e.target.files[0]),
							className: "hidden"
						})
					]
				})]
			})
		]
	});
}
function CancelJobDialog({ jobId, status, onCancelled }) {
	const [open, setOpen] = (0, import_react.useState)(false);
	const [reason, setReason] = (0, import_react.useState)("");
	const [loading, setLoading] = (0, import_react.useState)(false);
	const policy = status === "open" ? "You can cancel this job for free." : status === "accepted" ? "This driver has already accepted your job. Cancelling now may result in a fee and a strike on your account." : "The driver has already loaded your material. Cancelling now will result in a strike and may affect your account. This should only be used for genuine emergencies.";
	const tone = status === "open" ? "text-muted-foreground" : status === "accepted" ? "text-warning" : "text-destructive";
	const submit = async () => {
		setLoading(true);
		const { error } = await supabase.rpc("cancel_job", {
			_job_id: jobId,
			_reason: reason.trim() || ""
		});
		setLoading(false);
		if (error) return toast.error(error.message);
		toast.success("Job cancelled");
		setOpen(false);
		onCancelled();
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Dialog, {
		open,
		onOpenChange: setOpen,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DialogTrigger, {
			asChild: true,
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
				variant: "outline",
				className: "w-full text-destructive hover:text-destructive",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Trash2, { className: "w-4 h-4 mr-2" }), "Cancel job"]
			})
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DialogContent, { children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DialogHeader, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DialogTitle, { children: "Cancel this job?" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DialogDescription, {
				className: tone,
				children: policy
			})] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "space-y-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
					htmlFor: "cxr",
					children: "Reason (optional)"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Textarea, {
					id: "cxr",
					rows: 3,
					maxLength: 300,
					value: reason,
					onChange: (e) => setReason(e.target.value),
					placeholder: "Tell us why you're cancelling"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DialogFooter, {
				className: "gap-2 sm:gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					variant: "ghost",
					onClick: () => setOpen(false),
					disabled: loading,
					children: "Keep job"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					variant: "destructive",
					onClick: submit,
					disabled: loading,
					children: loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-4 h-4 animate-spin" }) : "Confirm cancellation"
				})]
			})
		] })]
	});
}
var DISPUTE_TYPES = [
	{
		value: "wrong_quantity",
		label: "Wrong quantity delivered"
	},
	{
		value: "damage",
		label: "Damaged material"
	},
	{
		value: "no_show",
		label: "Driver didn't show up"
	},
	{
		value: "payment_issue",
		label: "Payment issue"
	},
	{
		value: "conduct",
		label: "Bad conduct or behavior"
	},
	{
		value: "other",
		label: "Something else"
	}
];
function RaiseDisputeDialog({ jobId, against }) {
	const [open, setOpen] = (0, import_react.useState)(false);
	const [category, setCategory] = (0, import_react.useState)("wrong_quantity");
	const [explanation, setExplanation] = (0, import_react.useState)("");
	const [loading, setLoading] = (0, import_react.useState)(false);
	const submit = async () => {
		if (explanation.trim().length < 5) return toast.error("Please explain what happened.");
		if (!against) return toast.error("Cannot identify the other party yet.");
		setLoading(true);
		const label = DISPUTE_TYPES.find((t) => t.value === category)?.label ?? category;
		const { error } = await supabase.rpc("raise_dispute", {
			_job_id: jobId,
			_against: against,
			_category: category,
			_reason: `${label}: ${explanation.trim()}`
		});
		setLoading(false);
		if (error) return toast.error(error.message);
		toast.success("Dispute submitted. Our team will review it.");
		setOpen(false);
		setExplanation("");
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Dialog, {
		open,
		onOpenChange: setOpen,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DialogTrigger, {
			asChild: true,
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
				variant: "outline",
				className: "w-full",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Flag, { className: "w-4 h-4 mr-2" }), " Raise a dispute"]
			})
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DialogContent, { children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DialogHeader, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DialogTitle, { children: "Raise a dispute" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DialogDescription, { children: "An admin will review the job details and proof photos before deciding." })] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "space-y-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
					htmlFor: "dcat",
					children: "Type of issue"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
					id: "dcat",
					value: category,
					onChange: (e) => setCategory(e.target.value),
					className: "w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm",
					children: DISPUTE_TYPES.map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
						value: t.value,
						children: t.label
					}, t.value))
				})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
					htmlFor: "dexp",
					children: "What happened?"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Textarea, {
					id: "dexp",
					rows: 4,
					maxLength: 1e3,
					value: explanation,
					onChange: (e) => setExplanation(e.target.value),
					placeholder: "Give a short, clear description."
				})] })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DialogFooter, {
				className: "gap-2 sm:gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					variant: "ghost",
					onClick: () => setOpen(false),
					disabled: loading,
					children: "Cancel"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					onClick: submit,
					disabled: loading,
					children: loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-4 h-4 animate-spin" }) : "Submit dispute"
				})]
			})
		] })]
	});
}
function JobTimeline({ job }) {
	const cancelled = job.status === "cancelled";
	const posted = true;
	const accepted = [
		"accepted",
		"in_progress",
		"completed"
	].includes(job.status);
	const enRoute = job.status === "in_progress" || !!job.pickup_photo_url && job.status !== "completed" || job.status === "completed";
	const delivered = job.status === "completed" || !!job.delivery_photo_url;
	const steps = [
		{
			key: "posted",
			label: "Posted",
			icon: FileText,
			done: posted,
			active: !accepted && !cancelled
		},
		{
			key: "accepted",
			label: "Bid accepted",
			icon: CircleCheck,
			done: accepted,
			active: accepted && !enRoute
		},
		{
			key: "enroute",
			label: "En route",
			icon: Truck,
			done: enRoute,
			active: enRoute && !delivered
		},
		{
			key: "delivered",
			label: "Delivered",
			icon: PackageOpen,
			done: delivered,
			active: delivered
		}
	];
	if (cancelled) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "rounded-2xl bg-card border p-4 text-sm text-muted-foreground",
		children: "This job was cancelled."
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "rounded-2xl bg-card border p-4",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "flex items-center justify-between gap-2",
			children: steps.map((s, i) => {
				const Icon = s.done ? s.icon : Circle;
				const color = s.active ? "text-primary" : s.done ? "text-success" : "text-muted-foreground";
				return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex-1 flex flex-col items-center gap-1 min-w-0",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center w-full",
						children: [
							i > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: `h-0.5 flex-1 ${steps[i - 1].done ? "bg-success" : "bg-border"}` }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: `w-8 h-8 rounded-full border-2 flex items-center justify-center ${s.active ? "border-primary bg-primary/10" : s.done ? "border-success bg-success/10" : "border-border bg-muted"}`,
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { className: `w-4 h-4 ${color}` })
							}),
							i < steps.length - 1 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: `h-0.5 flex-1 ${s.done ? "bg-success" : "bg-border"}` })
						]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: `text-[10px] font-semibold uppercase tracking-wide text-center ${color}`,
						children: s.label
					})]
				}, s.key);
			})
		})
	});
}
//#endregion
export { JobDetail as component };
