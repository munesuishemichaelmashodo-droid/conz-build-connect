import { o as __toESM } from "../_runtime.mjs";
import { t as supabase } from "./client-BKwn9D3n.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { g as Link, v as useNavigate } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { t as cn } from "./utils-C_uf36nf.mjs";
import { t as Button } from "./button-Bq5vK6RO.mjs";
import { A as Package, G as LocateFixed, K as LoaderCircle, L as Minus, O as Plus, Tt as ArrowLeft, V as MapPin, _t as Calendar, d as StickyNote, dt as CircleCheck, m as Sparkles, mt as ChevronLeft, o as Truck, pt as ChevronRight } from "../_libs/lucide-react.mjs";
import { l as createServerFn } from "./esm-Dova13aH.mjs";
import { t as requireSupabaseAuth } from "./auth-middleware-QP6BYy5L.mjs";
import { t as createSsrRpc } from "./createSsrRpc-5dJhInVq.mjs";
import { t as useQuery } from "../_libs/tanstack__react-query.mjs";
import { n as useAuth, r as useServerFn } from "./auth-CKNZvOvp.mjs";
import { n as toast } from "../_libs/sonner.mjs";
import { t as AppShell } from "./AppShell-1W_lsY73.mjs";
import { i as money, t as MATERIALS$1 } from "./domain-CYaPqfcD.mjs";
import { t as Textarea } from "./textarea-kko37XEX.mjs";
import { et as enumType, it as ZodIssueCode, nt as objectType, rt as stringType, tt as numberType } from "../_libs/@ai-sdk/gateway+[...].mjs";
import { t as Input } from "./input-B8Q2ztVi.mjs";
import { t as Label } from "./label-DBD1bRRP.mjs";
import { n as searchAddress, t as reverseGeocode } from "./osm-geocode-ERMsFbDH.mjs";
import { t as require_leaflet_src } from "../_libs/leaflet.mjs";
import { a as MapContainer, i as Marker, o as useMap, t as TileLayer } from "../_libs/react-leaflet.mjs";
import { n as AnimatePresence, t as motion } from "../_libs/framer-motion.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/customer.book-CP3sCNgN.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var pinIcon = (/* @__PURE__ */ __toESM(require_leaflet_src())).default.divIcon({
	className: "",
	html: `<div style="background:hsl(var(--primary));color:hsl(var(--primary-foreground));width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)"><span style="transform:rotate(45deg);font-size:14px">📍</span></div>`,
	iconSize: [28, 28],
	iconAnchor: [14, 28]
});
function Recenter({ lat, lng, zoom }) {
	const map = useMap();
	(0, import_react.useEffect)(() => {
		map.setView([lat, lng], zoom ?? map.getZoom());
	}, [
		lat,
		lng,
		zoom,
		map
	]);
	return null;
}
function DraggableMarker({ position, onDragEnd }) {
	const ref = (0, import_react.useRef)(null);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Marker, {
		draggable: true,
		position: [position.lat, position.lng],
		icon: pinIcon,
		ref: (m) => {
			ref.current = m;
		},
		eventHandlers: { dragend: () => {
			const m = ref.current;
			if (!m) return;
			const p = m.getLatLng();
			onDragEnd(p.lat, p.lng);
		} }
	});
}
function AddressPicker({ value, onChange, label = "Delivery address" }) {
	const [coords, setCoords] = (0, import_react.useState)({
		lat: -17.8252,
		lng: 31.0335
	});
	const [hasPin, setHasPin] = (0, import_react.useState)(false);
	const [confirmed, setConfirmed] = (0, import_react.useState)(false);
	const [zoom, setZoom] = (0, import_react.useState)(12);
	const [locating, setLocating] = (0, import_react.useState)(false);
	const [query, setQuery] = (0, import_react.useState)(value);
	const [results, setResults] = (0, import_react.useState)([]);
	const [open, setOpen] = (0, import_react.useState)(false);
	const [searching, setSearching] = (0, import_react.useState)(false);
	(0, import_react.useEffect)(() => setQuery(value), [value]);
	(0, import_react.useEffect)(() => {
		if (!query || query.length < 3) {
			setResults([]);
			return;
		}
		setSearching(true);
		const t = setTimeout(async () => {
			setResults(await searchAddress(query));
			setSearching(false);
		}, 350);
		return () => clearTimeout(t);
	}, [query]);
	const setPin = async (lat, lng, addressHint) => {
		setCoords({
			lat,
			lng
		});
		setHasPin(true);
		setConfirmed(false);
		setZoom(16);
		const finalAddr = addressHint ?? await reverseGeocode(lat, lng) ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
		setQuery(finalAddr);
		onChange(finalAddr, void 0);
	};
	const pickResult = (r) => {
		setOpen(false);
		setResults([]);
		setPin(r.lat, r.lng, r.label);
	};
	const confirmLocation = () => {
		if (!hasPin) return;
		setConfirmed(true);
		onChange(query, coords);
		toast.success("Location confirmed");
	};
	const useMyLocation = async () => {
		setLocating(true);
		try {
			const { locateOnce } = await import("./geolocate-BpDbz8US.mjs");
			const c = await locateOnce({ onUpdate: (better) => void setPin(better.lat, better.lng) });
			await setPin(c.lat, c.lng);
			toast.success("Location captured — tap Confirm to use it");
		} catch (e) {
			toast.error(e.message ?? "Could not get location");
		} finally {
			setLocating(false);
		}
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-2",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
				htmlFor: "addr-picker",
				children: label
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "relative flex-1",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(MapPin, { className: "absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none z-10" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							id: "addr-picker",
							value: query,
							placeholder: "Search address…",
							className: "flex h-10 w-full rounded-md border border-input bg-background pl-8 pr-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
							onChange: (e) => {
								setQuery(e.target.value);
								setOpen(true);
								setConfirmed(false);
								onChange(e.target.value, void 0);
							},
							onFocus: () => setOpen(true),
							onBlur: () => {
								setTimeout(() => {
									if (!searching) setOpen(false);
								}, 1200);
							}
						}),
						open && query.trim().length >= 3 && (results.length > 0 || searching || results.length === 0) && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "absolute z-20 left-0 right-0 top-11 rounded-md border bg-popover shadow-lg max-h-64 overflow-auto",
							children: [
								searching && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "px-3 py-2 text-xs text-muted-foreground",
									children: "Searching…"
								}),
								!searching && results.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "px-3 py-2 text-xs text-muted-foreground",
									children: "No results found — try a different spelling."
								}),
								results.map((r, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									type: "button",
									onMouseDown: (e) => e.preventDefault(),
									onClick: () => pickResult(r),
									className: "block w-full text-left px-3 py-2 text-sm hover:bg-accent",
									children: r.label
								}, i))
							]
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					type: "button",
					variant: "outline",
					size: "icon",
					onClick: useMyLocation,
					disabled: locating,
					title: "Use my current location",
					children: locating ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-4 h-4 animate-spin" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LocateFixed, { className: "w-4 h-4" })
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "w-full h-56 rounded-xl border overflow-hidden bg-muted",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(MapContainer, {
					center: [coords.lat, coords.lng],
					zoom,
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
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Recenter, {
							lat: coords.lat,
							lng: coords.lng,
							zoom
						}),
						hasPin && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DraggableMarker, {
							position: coords,
							onDragEnd: (lat, lng) => void setPin(lat, lng)
						})
					]
				})
			}),
			hasPin && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "space-y-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "text-[11px] text-muted-foreground",
					children: [
						"Pin: ",
						coords.lat.toFixed(5),
						", ",
						coords.lng.toFixed(5),
						" — drag the pin to fine-tune."
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
					type: "button",
					onClick: confirmLocation,
					variant: confirmed ? "outline" : "default",
					className: "w-full",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CircleCheck, { className: "w-4 h-4 mr-2" }), confirmed ? "Location confirmed — tap to update" : "Confirm this location"]
				})]
			})
		]
	});
}
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
/**
* Fast deterministic offer. No AI in the hot path — returns immediately from the price guide.
*/
var computeOffer = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(parseOfferInput).handler(createSsrRpc("04f96c60f2e8c59fbbbaa44e49e4a8b28592812cb1ecec1bc4098abc6c6e138b"));
var ExplainInput = objectType({
	material: stringType().max(50),
	quantity: numberType().positive().max(50),
	distanceKm: numberType().min(0).transform((v) => Math.min(v, MAX_SERVICE_KM))
});
/**
* Best-effort AI explanation. Called in the background after the offer is shown.
*/
var explainOffer = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((input) => ExplainInput.parse(input)).handler(createSsrRpc("fdd4242533399c1b51ef088f84151dd36055762fa6349f018cd8a8ae3ba1d2ee"));
var BOOKABLE_MATERIALS = MATERIALS$1.filter((m) => m.value !== "custom");
var FUEL_LITRES_PER_100KM = 32;
var PICKUP_POINT = {
	lat: -17.8292,
	lng: 31.0522
};
var PICKUP_ADDRESS = "Harare CBD supplier pickup point";
var STEPS = [
	{
		key: "material",
		title: "Material"
	},
	{
		key: "quantity",
		title: "Quantity"
	},
	{
		key: "address",
		title: "Delivery"
	},
	{
		key: "date",
		title: "Date"
	},
	{
		key: "review",
		title: "Notes"
	}
];
function BookDelivery() {
	const { userId, is } = useAuth();
	const nav = useNavigate();
	const runOffer = useServerFn(computeOffer);
	const runExplain = useServerFn(explainOffer);
	const [step, setStep] = (0, import_react.useState)(0);
	const [address, setAddress] = (0, import_react.useState)("");
	const [coords, setCoords] = (0, import_react.useState)(null);
	const [material, setMaterial] = (0, import_react.useState)("river_sand");
	const [quantity, setQuantity] = (0, import_react.useState)(12);
	const [notes, setNotes] = (0, import_react.useState)("");
	const [date, setDate] = (0, import_react.useState)("");
	const [computing, setComputing] = (0, import_react.useState)(false);
	const [offerData, setOfferData] = (0, import_react.useState)(null);
	const [offer, setOffer] = (0, import_react.useState)(0);
	const [posting, setPosting] = (0, import_react.useState)(false);
	const [roadDistanceKm, setRoadDistanceKm] = (0, import_react.useState)(null);
	(0, import_react.useEffect)(() => {
		if (!coords) {
			setRoadDistanceKm(null);
			return;
		}
		const dest = coords;
		let cancelled = false;
		async function loadRoute() {
			try {
				const { getRoute } = await import("./routing.functions-6FbJ3y3U.mjs").then((n) => n.n);
				const r = await getRoute({ data: {
					startLat: PICKUP_POINT.lat,
					startLng: PICKUP_POINT.lng,
					destLat: dest.lat,
					destLng: dest.lng
				} });
				if (!cancelled && typeof r.distanceKm === "number") setRoadDistanceKm(r.distanceKm);
			} catch {}
		}
		loadRoute();
		return () => {
			cancelled = true;
		};
	}, [coords]);
	const { data: matPrice } = useQuery({
		queryKey: ["material-price", material],
		queryFn: async () => {
			const { data } = await supabase.from("material_prices").select("min_price,max_price,label").eq("material", material).maybeSingle();
			return data;
		}
	});
	const { data: dieselPrice } = useQuery({
		queryKey: ["diesel-price"],
		queryFn: async () => {
			const { data } = await supabase.from("system_settings").select("value").eq("key", "diesel_price_per_liter").maybeSingle();
			return Number(data?.value ?? 1.87);
		}
	});
	const { data: commissionRate } = useQuery({
		queryKey: ["commission-rate"],
		queryFn: async () => {
			const { data } = await supabase.from("system_settings").select("value").eq("key", "commission_rate").maybeSingle();
			return Number(data?.value ?? 7);
		}
	});
	const suggestion = (0, import_react.useMemo)(() => {
		if (!matPrice || !coords) return null;
		const distanceKm = roadDistanceKm ?? haversineKm(PICKUP_POINT, coords);
		const midMaterial = (Number(matPrice.min_price) + Number(matPrice.max_price)) / 2;
		const fuelCost = distanceKm * (FUEL_LITRES_PER_100KM / 100) * Number(dieselPrice ?? 1.87);
		const commission = (midMaterial + fuelCost) * (Number(commissionRate ?? 7) / 100);
		const total = midMaterial + fuelCost + commission;
		return {
			low: Math.max(Number(matPrice.min_price), Math.round(total * .9)),
			high: Math.min(Number(matPrice.max_price), Math.round(total * 1.1)),
			distanceKm,
			fuelCost,
			commission,
			total: Math.round(total)
		};
	}, [
		matPrice,
		coords,
		dieselPrice,
		commissionRate,
		roadDistanceKm
	]);
	(0, import_react.useEffect)(() => {}, [suggestion]);
	if (!is("customer")) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AppShell, {
		title: "Book delivery",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "text-center py-10 space-y-3",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-muted-foreground",
				children: "Only customer accounts can book deliveries."
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				asChild: true,
				variant: "outline",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
					to: "/profile",
					children: "Go to profile"
				})
			})]
		})
	});
	const canNext = () => {
		if (step === 0) return !!material;
		if (step === 1) return quantity >= 1 && quantity <= 30;
		if (step === 2) return address.trim().length > 2 && !!coords;
		if (step === 3) return true;
		if (step === 4) return true;
		return true;
	};
	const goToOffer = async () => {
		if (!address.trim()) return toast.error("Enter the delivery address");
		if (!coords) {
			setStep(2);
			return toast.error("Select the delivery point on the map so the driver can navigate.");
		}
		if (!quantity || quantity < 1) return toast.error("Enter quantity");
		setComputing(true);
		try {
			const distanceKm = roadDistanceKm ?? (coords ? haversineKm(PICKUP_POINT, coords) : 15);
			const result = await runOffer({ data: {
				material,
				quantity,
				distanceKm,
				address
			} });
			setOfferData(result);
			setOffer(result.offer);
			setStep(5);
			runExplain({ data: {
				material,
				quantity,
				distanceKm
			} }).then(({ explanation }) => {
				setOfferData((prev) => prev ? {
					...prev,
					explanation
				} : prev);
			}).catch(() => {});
		} catch (e) {
			toast.error(e?.message ?? "Could not calculate offer");
		} finally {
			setComputing(false);
		}
	};
	const nextStep = (v) => v < 100 ? 5 : v < 300 ? 10 : 20;
	const adjust = (dir) => {
		if (!offerData) return;
		const proposed = offer + dir * nextStep(offer);
		if (dir < 0 && proposed < offerData.min) {
			toast("Minimum offer reached.");
			return;
		}
		if (dir > 0 && proposed > offerData.max) {
			toast("Maximum offer reached.");
			return;
		}
		setOffer(proposed);
	};
	const confirm = async () => {
		if (!offerData) return;
		if (!coords) {
			setStep(2);
			return toast.error("Select the delivery point on the map before confirming.");
		}
		setPosting(true);
		const { data, error } = await supabase.from("jobs").insert({
			customer_id: userId,
			material,
			custom_material: null,
			quantity_m3: quantity,
			delivery_address: address.trim(),
			delivery_lat: coords.lat,
			delivery_lng: coords.lng,
			pickup_address: PICKUP_ADDRESS,
			pickup_lat: PICKUP_POINT.lat,
			pickup_lng: PICKUP_POINT.lng,
			dropoff_address: address.trim(),
			dropoff_lat: coords.lat,
			dropoff_lng: coords.lng,
			budget: offer,
			preferred_date: date || null,
			notes: notes.trim() || null
		}).select().single();
		setPosting(false);
		if (error) return toast.error(error.message);
		toast.success("Booking confirmed! Searching for trucks…");
		nav({
			to: "/jobs/$id",
			params: { id: data.id }
		});
	};
	const goBack = () => {
		if (step === 0) return nav({ to: "/customer" });
		if (step === 5) return setStep(4);
		setStep(step - 1);
	};
	const isReview = step === 4;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(AppShell, {
		title: "Book delivery",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
				type: "button",
				onClick: goBack,
				className: "inline-flex items-center gap-1 text-sm text-muted-foreground mb-4",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowLeft, { className: "w-4 h-4" }), " Back"]
			}),
			step < 5 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stepper, {
				current: step,
				total: STEPS.length
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(AnimatePresence, {
				mode: "wait",
				children: [
					step === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(motion.div, {
						...anim,
						className: "space-y-5 mt-6",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Header, {
							icon: Package,
							title: "What are we moving?",
							hint: "Pick the material you need delivered."
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "grid grid-cols-2 gap-2",
							children: BOOKABLE_MATERIALS.map((m) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								type: "button",
								onClick: () => setMaterial(m.value),
								className: cn("rounded-2xl border p-3 text-left transition", material === m.value ? "border-primary bg-primary/10 shadow-lift" : "hover:border-primary/40"),
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "text-[10px] uppercase tracking-widest text-muted-foreground",
									children: m.group
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "font-display font-bold text-sm",
									children: m.label
								})]
							}, m.value))
						})]
					}, "s-material"),
					step === 1 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(motion.div, {
						...anim,
						className: "space-y-5 mt-6",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Header, {
								icon: Truck,
								title: "How much?",
								hint: "One tipper load carries 10–15 m³."
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "flex gap-2",
								children: [
									10,
									12,
									14,
									15
								].map((v) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
									type: "button",
									onClick: () => setQuantity(v),
									className: cn("flex-1 rounded-xl border py-3 font-display font-bold", quantity === v ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"),
									children: [v, " m³"]
								}, v))
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
								htmlFor: "qty",
								children: "Custom quantity (m³)"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
								id: "qty",
								type: "number",
								min: 1,
								max: 30,
								step: .5,
								value: quantity,
								onChange: (e) => setQuantity(Number(e.target.value))
							})] })
						]
					}, "s-qty"),
					step === 2 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(motion.div, {
						...anim,
						className: "space-y-5 mt-6",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Header, {
								icon: MapPin,
								title: "Where to?",
								hint: "We'll match you with the closest tipper truck."
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AddressPicker, {
								value: address,
								onChange: (a, c) => {
									setAddress(a);
									setCoords(c ?? null);
								}
							}),
							address.trim().length > 2 && !coords && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-xs text-destructive",
								children: "Please select a map result or pin the delivery point so the driver can navigate accurately."
							}),
							suggestion && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-1.5",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-primary font-semibold",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Sparkles, { className: "w-3 h-3" }), " Suggested price range"]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "font-display font-bold text-2xl",
										children: [
											money(suggestion.low),
											" ",
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
												className: "text-muted-foreground text-lg",
												children: "–"
											}),
											" ",
											money(suggestion.high)
										]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
										className: "text-xs text-muted-foreground",
										children: [
											"Based on ",
											matPrice?.label,
											" pricing, ~",
											suggestion.distanceKm.toFixed(1),
											" km from pickup, fuel at ",
											FUEL_LITRES_PER_100KM,
											" L/100 km × $",
											Number(dieselPrice ?? 1.87).toFixed(2),
											"/L, plus ",
											commissionRate ?? 7,
											"% platform commission."
										]
									})
								]
							})
						]
					}, "s-addr"),
					step === 3 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(motion.div, {
						...anim,
						className: "space-y-5 mt-6",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Header, {
								icon: Calendar,
								title: "When do you need it?",
								hint: "Optional — leave blank for as soon as possible."
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
								htmlFor: "date",
								children: "Preferred date"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
								id: "date",
								type: "date",
								value: date,
								onChange: (e) => setDate(e.target.value)
							})] }),
							date && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => setDate(""),
								className: "text-xs text-muted-foreground underline",
								children: "Clear date"
							})
						]
					}, "s-date"),
					step === 4 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(motion.div, {
						...anim,
						className: "space-y-5 mt-6",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Header, {
								icon: StickyNote,
								title: "Anything else?",
								hint: "Add notes for the driver, then get your AI offer."
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
								htmlFor: "notes",
								children: "Notes (optional)"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Textarea, {
								id: "notes",
								value: notes,
								onChange: (e) => setNotes(e.target.value),
								rows: 3,
								maxLength: 300,
								placeholder: "Access instructions, contact person, gate code…"
							})] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "rounded-2xl bg-card border p-4 space-y-2 text-sm",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
										icon: Package,
										label: matPrice?.label ?? "Material",
										value: `${quantity} m³`
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
										icon: MapPin,
										label: "Delivery to",
										value: address || "—"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
										icon: Calendar,
										label: "Preferred date",
										value: date || "As soon as possible"
									})
								]
							})
						]
					}, "s-notes"),
					step === 5 && offerData && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(motion.div, {
						...anim,
						className: "space-y-5 mt-6",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "rounded-3xl bg-gradient-dark text-white p-8 shadow-lift text-center",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-primary font-semibold",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Sparkles, { className: "w-3 h-3" }), " AI Recommended"]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "text-[11px] uppercase tracking-widest text-white/60 mt-3",
										children: "Your offer"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(motion.div, {
										initial: {
											scale: .9,
											opacity: 0
										},
										animate: {
											scale: 1,
											opacity: 1
										},
										transition: {
											type: "spring",
											stiffness: 260,
											damping: 18
										},
										className: "font-display font-bold text-primary text-6xl mt-1",
										children: money(offer)
									}, offer),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
										className: "text-xs text-white/70 mt-3 max-w-xs mx-auto",
										children: offerData.explanation
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "mt-6 flex items-center justify-center gap-6",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
											type: "button",
											onClick: () => adjust(-1),
											className: "w-14 h-14 rounded-full bg-white/10 border border-white/20 hover:bg-white/20 flex items-center justify-center transition",
											"aria-label": "Decrease offer",
											children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Minus, { className: "w-6 h-6" })
										}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
											type: "button",
											onClick: () => adjust(1),
											className: "w-14 h-14 rounded-full bg-primary text-primary-foreground hover:brightness-110 flex items-center justify-center shadow-lift transition",
											"aria-label": "Increase offer",
											children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Plus, { className: "w-6 h-6" })
										})]
									})
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "rounded-2xl bg-card border p-4 space-y-2 text-sm",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
										icon: Package,
										label: offerData.label,
										value: `${quantity} m³`
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
										icon: MapPin,
										label: "Delivery to",
										value: address
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
										icon: Truck,
										label: "Estimated distance",
										value: `${offerData.distanceKm} km`
									})
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								onClick: confirm,
								disabled: posting,
								className: "w-full h-14 rounded-2xl font-display uppercase tracking-wide text-base",
								children: posting ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-5 h-5 animate-spin" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: ["Confirm booking ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CircleCheck, { className: "w-5 h-5 ml-2" })] })
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-[11px] text-center text-muted-foreground",
								children: "We'll immediately search for the closest verified tipper truck."
							})
						]
					}, "s-offer")
				]
			}),
			step < 5 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex gap-2 mt-8",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
					variant: "outline",
					onClick: () => setStep((s) => Math.max(0, s - 1)),
					disabled: step === 0,
					className: "flex-1 h-12",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronLeft, { className: "w-4 h-4 mr-1" }), " Back"]
				}), isReview ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					onClick: goToOffer,
					disabled: computing || !canNext(),
					className: "flex-1 h-12 font-display uppercase tracking-wide",
					children: computing ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-4 h-4 animate-spin mr-2" }), " Calculating…"] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: ["Get AI offer ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Sparkles, { className: "w-4 h-4 ml-2" })] })
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
					onClick: () => setStep((s) => s + 1),
					disabled: !canNext(),
					className: "flex-1 h-12",
					children: ["Next ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronRight, { className: "w-4 h-4 ml-1" })]
				})]
			})
		]
	});
}
var anim = {
	initial: {
		opacity: 0,
		x: 20
	},
	animate: {
		opacity: 1,
		x: 0
	},
	exit: {
		opacity: 0,
		x: -20
	},
	transition: { duration: .25 }
};
function Stepper({ current, total }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "flex items-center gap-2",
		children: Array.from({ length: total }).map((_, n) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: cn("flex-1 h-1.5 rounded-full transition-colors", n <= current ? "bg-primary" : "bg-muted") }, n))
	});
}
function Header({ icon: Icon, title, hint }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-3",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { className: "w-6 h-6" })
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
			className: "font-display font-bold text-2xl",
			children: title
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "text-sm text-muted-foreground",
			children: hint
		})
	] });
}
function Row({ icon: Icon, label, value }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex items-center gap-3",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { className: "w-4 h-4 text-muted-foreground shrink-0" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "flex-1 min-w-0",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "text-[10px] uppercase tracking-widest text-muted-foreground",
				children: label
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "text-sm truncate",
				children: value
			})]
		})]
	});
}
function haversineKm(a, b) {
	const R = 6371;
	const dLat = (b.lat - a.lat) * Math.PI / 180;
	const dLng = (b.lng - a.lng) * Math.PI / 180;
	const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(s));
}
//#endregion
export { BookDelivery as component };
