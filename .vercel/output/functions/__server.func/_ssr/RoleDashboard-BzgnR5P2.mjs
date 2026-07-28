import { o as __toESM } from "../_runtime.mjs";
import { t as supabase } from "./client-BKwn9D3n.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { g as Link, v as useNavigate } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { t as Button } from "./button-Bq5vK6RO.mjs";
import { A as Package, B as MapPin, G as LoaderCircle, O as Plus, W as LocateFixed, f as Star, n as X, o as Truck, r as Wallet, vt as Briefcase, x as ShieldAlert } from "../_libs/lucide-react.mjs";
import { t as useQuery } from "../_libs/tanstack__react-query.mjs";
import { n as useAuth } from "./auth-CKNZvOvp.mjs";
import { n as toast } from "../_libs/sonner.mjs";
import { t as AppShell } from "./AppShell-1W_lsY73.mjs";
import { n as Section, r as StatusBadge, t as EmptyState } from "./ui-bits-DE9HqP-8.mjs";
import { i as money, n as levelInfo, r as materialLabel } from "./domain-CYaPqfcD.mjs";
import { t as reverseGeocode } from "./osm-geocode-ERMsFbDH.mjs";
import { t as JobCard } from "./home-Cs_XU4md.mjs";
import { n as DialogContent, o as DialogTitle, t as Dialog } from "./dialog-DIo89e4g.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/RoleDashboard-BzgnR5P2.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function hasPoint(point) {
	return typeof point.lat === "number" && typeof point.lng === "number" && Number.isFinite(point.lat) && Number.isFinite(point.lng);
}
function googleNavigateTo(point) {
	return `https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lng}&travelmode=driving`;
}
function googlePickupToDropoff(pickup, dropoff) {
	return `https://www.google.com/maps/dir/?api=1&origin=${pickup.lat},${pickup.lng}&destination=${dropoff.lat},${dropoff.lng}&travelmode=driving`;
}
function wazeNavigateTo(point) {
	return `https://waze.com/ul?ll=${point.lat},${point.lng}&navigate=yes`;
}
function defaultPhoneMap(point, label = "Con Z location") {
	return `geo:${point.lat},${point.lng}?q=${point.lat},${point.lng}(${encodeURIComponent(label)})`;
}
function openStreetMapPoint(point) {
	return `https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lng}#map=17/${point.lat}/${point.lng}`;
}
function NavButton({ href, children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
		href,
		target: "_blank",
		rel: "noreferrer",
		className: "inline-flex rounded-full bg-black px-4 py-2 text-sm font-bold text-white hover:bg-green-700",
		children
	});
}
function DriverNavigationButtons({ pickup, dropoff, pickupLabel = "Pickup", dropoffLabel = "Drop-off" }) {
	const hasPickup = hasPoint(pickup);
	const hasDropoff = hasPoint(dropoff);
	if (!hasPickup && !hasDropoff) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "mt-3 rounded-xl bg-yellow-100 p-3 text-sm text-yellow-800",
		children: "No GPS coordinates saved for this job yet."
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "mt-4 flex flex-wrap gap-2",
		children: [
			hasPickup && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavButton, {
				href: googleNavigateTo(pickup),
				children: "Google Maps to pickup"
			}),
			hasDropoff && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavButton, {
				href: googleNavigateTo(dropoff),
				children: "Google Maps to drop-off"
			}),
			hasPickup && hasDropoff && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavButton, {
				href: googlePickupToDropoff(pickup, dropoff),
				children: "Route pickup → drop-off"
			}),
			hasDropoff && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavButton, {
				href: wazeNavigateTo(dropoff),
				children: "Waze"
			}),
			hasDropoff && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavButton, {
				href: defaultPhoneMap(dropoff, dropoffLabel),
				children: "Phone GPS app"
			}),
			hasDropoff && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavButton, {
				href: openStreetMapPoint(dropoff),
				children: "OpenStreetMap"
			}),
			hasDropoff && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				onClick: () => {
					navigator.clipboard.writeText(`${dropoff.lat}, ${dropoff.lng}`);
					alert("Drop-off coordinates copied");
				},
				className: "inline-flex rounded-full border border-black px-4 py-2 text-sm font-bold text-black hover:bg-gray-100",
				children: "Copy coordinates"
			})
		]
	});
}
function LocalLocator() {
	const [loading, setLoading] = (0, import_react.useState)(false);
	const [coords, setCoords] = (0, import_react.useState)(null);
	const [address, setAddress] = (0, import_react.useState)(null);
	const [error, setError] = (0, import_react.useState)(null);
	const locate = async () => {
		setLoading(true);
		setError(null);
		try {
			const { locateOnce } = await import("./geolocate-BpDbz8US.mjs");
			const c = await locateOnce({ onUpdate: async (better) => {
				setCoords({
					lat: better.lat,
					lng: better.lng,
					acc: better.accuracy
				});
				const addr = await reverseGeocode(better.lat, better.lng);
				if (addr) setAddress(addr);
			} });
			setCoords({
				lat: c.lat,
				lng: c.lng,
				acc: c.accuracy
			});
			setAddress(await reverseGeocode(c.lat, c.lng));
			setLoading(false);
			toast.success("Location captured");
		} catch (e) {
			setLoading(false);
			setError(e.message);
			toast.error(e.message);
		}
	};
	(0, import_react.useEffect)(() => {
		if (typeof navigator === "undefined" || !("permissions" in navigator)) return;
		navigator.permissions?.query({ name: "geolocation" }).then((res) => {
			if (res.state === "granted") locate();
		}).catch(() => {});
	}, []);
	const mapHref = coords ? `https://www.openstreetmap.org/?mlat=${coords.lat}&mlon=${coords.lng}#map=17/${coords.lat}/${coords.lng}` : "#";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "rounded-2xl border bg-card p-4 shadow-soft",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "flex items-start justify-between gap-3",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-start gap-3 min-w-0",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MapPin, { className: "w-5 h-5 text-primary" })
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "min-w-0",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "text-[11px] uppercase tracking-widest text-muted-foreground font-semibold",
							children: "You are here"
						}),
						loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "text-sm text-muted-foreground mt-1 flex items-center gap-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-3 h-3 animate-spin" }), " Locating…"]
						}) : address ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "text-sm font-medium mt-1 break-words",
							children: address
						}) : coords ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "text-sm font-medium mt-1",
							children: [
								coords.lat.toFixed(5),
								", ",
								coords.lng.toFixed(5)
							]
						}) : error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "text-sm text-destructive mt-1",
							children: error
						}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "text-sm text-muted-foreground mt-1",
							children: "Tap locate to see your address"
						}),
						coords && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "text-[11px] text-muted-foreground mt-1",
							children: [coords.acc ? `± ${Math.round(coords.acc)} m accuracy • ` : "", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
								href: mapHref,
								target: "_blank",
								rel: "noreferrer",
								className: "text-primary underline",
								children: "Open in Maps"
							})]
						})
					]
				})]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				type: "button",
				size: "icon",
				variant: "outline",
				onClick: locate,
				disabled: loading,
				title: "Locate me",
				children: loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-4 h-4 animate-spin" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LocateFixed, { className: "w-4 h-4" })
			})]
		})
	});
}
var WINDOW_MS = 1e4;
/** Short beep via WebAudio; also vibrate if supported. */
function alertPulse() {
	try {
		if ("vibrate" in navigator) navigator.vibrate([
			200,
			100,
			200
		]);
	} catch {}
	try {
		const Ctx = window.AudioContext ?? window.webkitAudioContext;
		if (!Ctx) return;
		const ctx = new Ctx();
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		o.type = "sine";
		o.frequency.value = 880;
		o.connect(g);
		g.connect(ctx.destination);
		g.gain.setValueAtTime(.3, ctx.currentTime);
		o.start();
		o.frequency.setValueAtTime(660, ctx.currentTime + .15);
		g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .5);
		o.stop(ctx.currentTime + .55);
	} catch {}
}
function JobOfferListener() {
	const { userId, is } = useAuth();
	const [offer, setOffer] = (0, import_react.useState)(null);
	const [job, setJob] = (0, import_react.useState)(null);
	const seenIds = (0, import_react.useRef)(/* @__PURE__ */ new Set());
	const isDriver = is("driver");
	const loadJob = (0, import_react.useCallback)(async (jobId) => {
		const { data } = await supabase.from("jobs").select("id,material,custom_material,quantity_m3,budget,delivery_address").eq("id", jobId).maybeSingle();
		if (data) setJob(data);
	}, []);
	const openOffer = (0, import_react.useCallback)((o) => {
		if (seenIds.current.has(o.id)) return;
		if (new Date(o.expires_at).getTime() < Date.now()) return;
		seenIds.current.add(o.id);
		setOffer(o);
		setJob(null);
		loadJob(o.job_id);
		alertPulse();
	}, [loadJob]);
	(0, import_react.useEffect)(() => {
		if (!userId || !isDriver) return;
		let cancelled = false;
		(async () => {
			const { data } = await supabase.from("job_dispatch_offers").select("*").eq("driver_id", userId).eq("status", "pending").gte("expires_at", (/* @__PURE__ */ new Date()).toISOString()).order("offered_at", { ascending: false }).limit(1);
			if (!cancelled && data?.[0]) openOffer(data[0]);
		})();
		return () => {
			cancelled = true;
		};
	}, [
		userId,
		isDriver,
		openOffer
	]);
	(0, import_react.useEffect)(() => {
		if (!userId || !isDriver) return;
		const ch = supabase.channel(`offers-${userId}`).on("postgres_changes", {
			event: "INSERT",
			schema: "public",
			table: "job_dispatch_offers",
			filter: `driver_id=eq.${userId}`
		}, (payload) => {
			const o = payload.new;
			if (o.status === "pending") openOffer(o);
		}).on("postgres_changes", {
			event: "UPDATE",
			schema: "public",
			table: "job_dispatch_offers",
			filter: `driver_id=eq.${userId}`
		}, (payload) => {
			const o = payload.new;
			setOffer((cur) => cur && cur.id === o.id && o.status !== "pending" ? null : cur);
		}).subscribe();
		return () => {
			supabase.removeChannel(ch);
		};
	}, [
		userId,
		isDriver,
		openOffer
	]);
	if (!offer) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(OfferModal, {
		offer,
		job,
		onClose: () => setOffer(null)
	});
}
function OfferModal({ offer, job, onClose }) {
	const nav = useNavigate();
	const [remaining, setRemaining] = (0, import_react.useState)(() => Math.max(0, new Date(offer.expires_at).getTime() - Date.now()));
	const [accepting, setAccepting] = (0, import_react.useState)(false);
	(0, import_react.useEffect)(() => {
		const id = setInterval(() => {
			const r = Math.max(0, new Date(offer.expires_at).getTime() - Date.now());
			setRemaining(r);
			if (r <= 0) {
				clearInterval(id);
				supabase.rpc("expire_stale_dispatch_offers", { _job_id: offer.job_id }).then(() => void 0);
				toast("Job offer expired — sending to next driver…");
				onClose();
			}
		}, 100);
		return () => clearInterval(id);
	}, [
		offer.expires_at,
		offer.job_id,
		onClose
	]);
	const secondsLeft = Math.ceil(remaining / 1e3);
	const pct = Math.max(0, Math.min(1, remaining / WINDOW_MS));
	const color = secondsLeft >= 8 ? "#22c55e" : secondsLeft >= 5 ? "#84cc16" : secondsLeft >= 2 ? "#f97316" : "#ef4444";
	const accept = async () => {
		setAccepting(true);
		const { data, error } = await supabase.rpc("accept_dispatch_offer", { _offer_id: offer.id });
		setAccepting(false);
		if (error) {
			const msg = error.message ?? "Could not accept";
			if (/insufficient wallet balance/i.test(msg)) {
				toast.error("Wallet too low to accept — top up first");
				onClose();
				nav({ to: "/wallet" });
				return;
			}
			toast.error(msg);
			onClose();
			return;
		}
		toast.success("Job accepted!");
		onClose();
		if (data) nav({
			to: "/jobs/$id",
			params: { id: String(data) }
		});
	};
	const R = 70;
	const C = 2 * Math.PI * R;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Dialog, {
		open: true,
		onOpenChange: (o) => {
			if (!o) onClose();
		},
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DialogContent, {
			className: "max-w-sm p-0 overflow-hidden bg-gradient-to-b from-neutral-900 to-black text-white border-none",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DialogTitle, {
				className: "sr-only",
				children: "New job request"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "p-6 space-y-5",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center justify-between",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "text-[10px] uppercase tracking-widest text-primary font-semibold",
							children: "New job request"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							onClick: onClose,
							className: "w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center",
							"aria-label": "Dismiss",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, { className: "w-4 h-4" })
						})]
					}),
					job && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "rounded-2xl bg-white/5 border border-white/10 p-4 space-y-2 text-sm",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
								icon: Package,
								label: materialLabel(job.material, job.custom_material),
								value: `${Number(job.quantity_m3)} m³`
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
								icon: MapPin,
								label: "Delivery to",
								value: job.delivery_address
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex items-center justify-between pt-2 border-t border-white/10",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "text-xs text-white/60 uppercase tracking-widest",
									children: "Trip value"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "font-display font-bold text-primary text-lg",
									children: money(Number(job.budget))
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "relative mx-auto w-40 h-40",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", {
							viewBox: "0 0 160 160",
							className: "w-full h-full -rotate-90",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", {
								cx: "80",
								cy: "80",
								r: R,
								stroke: "rgba(255,255,255,0.1)",
								strokeWidth: "10",
								fill: "none"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", {
								cx: "80",
								cy: "80",
								r: R,
								stroke: color,
								strokeWidth: "10",
								fill: "none",
								strokeLinecap: "round",
								strokeDasharray: C,
								strokeDashoffset: C * (1 - pct),
								style: { transition: "stroke-dashoffset 100ms linear, stroke 300ms" }
							})]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "absolute inset-0 flex flex-col items-center justify-center",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "font-display font-bold text-5xl",
								style: { color },
								children: secondsLeft
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "text-[10px] uppercase tracking-widest text-white/60",
								children: "seconds"
							})]
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "h-2 bg-white/10 rounded-full overflow-hidden",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "h-full rounded-full",
							style: {
								width: `${pct * 100}%`,
								background: color,
								transition: "width 100ms linear, background 300ms"
							}
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						onClick: accept,
						disabled: accepting || secondsLeft <= 0,
						className: "w-full h-14 rounded-2xl font-display uppercase tracking-wide text-base",
						children: accepting ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-5 h-5 animate-spin" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Truck, { className: "w-5 h-5 mr-2" }), " Accept job"] })
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-[11px] text-center text-white/50",
						children: "Accept quickly — after 10 seconds this goes to the next driver."
					})
				]
			})]
		})
	});
}
function Row({ icon: Icon, label, value }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex items-center gap-3",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { className: "w-4 h-4 text-white/60 shrink-0" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "flex-1 min-w-0",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "text-[10px] uppercase tracking-widest text-white/50",
				children: label
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "text-sm truncate",
				children: value
			})]
		})]
	});
}
function RoleDashboard({ role }) {
	const { userId, profile, is } = useAuth();
	const isDriver = role === "driver";
	const isCustomer = role === "customer";
	const { data: jobs } = useQuery({
		queryKey: [
			"role-dash-jobs",
			userId,
			role
		],
		enabled: !!userId,
		refetchInterval: 4e3,
		queryFn: async () => {
			const q = supabase.from("jobs").select("*").order("created_at", { ascending: false }).limit(5);
			if (isDriver) q.eq("status", "open");
			else q.eq("customer_id", userId);
			const { data, error } = await q;
			if (error) throw error;
			return data;
		}
	});
	const { data: wallet } = useQuery({
		queryKey: ["wallet", userId],
		enabled: !!userId && isDriver,
		queryFn: async () => {
			const { data } = await supabase.from("wallets").select("*").eq("user_id", userId).maybeSingle();
			return data;
		}
	});
	const { data: driver } = useQuery({
		queryKey: ["driver-profile", userId],
		enabled: !!userId && isDriver,
		queryFn: async () => {
			const { data } = await supabase.from("driver_profiles").select("*").eq("user_id", userId).maybeSingle();
			return data;
		}
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AppShell, {
		title: isDriver ? "Driver" : "Customer",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "space-y-6",
			children: [
				isDriver && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(JobOfferListener, {}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "rounded-2xl bg-gradient-dark text-white p-5 shadow-lift",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "text-xs uppercase tracking-widest text-white/60",
							children: "Welcome back"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "font-display font-bold text-2xl mt-1",
							children: profile?.full_name?.split(" ")[0] ?? "Builder"
						}),
						isDriver && wallet && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mt-4 flex items-end justify-between",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "text-[11px] uppercase tracking-widest text-white/60",
									children: "Wallet"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "font-display font-bold text-3xl text-primary",
									children: money(Number(wallet.balance))
								}),
								wallet.limited && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusBadge, {
									label: "Limited",
									className: "bg-destructive/20 text-destructive border-destructive/40 mt-1"
								})
							] }), driver && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "text-right",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusBadge, {
									label: levelInfo(driver.level).label,
									className: levelInfo(driver.level).className
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "text-xs text-white/70 mt-1 flex items-center gap-1 justify-end",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Star, { className: "w-3 h-3 fill-current text-warning" }),
										Number(driver.rating_avg).toFixed(1),
										" • ",
										driver.jobs_completed,
										" jobs"
									]
								})]
							})]
						})
					]
				}),
				isDriver && driver?.verification_status !== "verified" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
					to: "/profile",
					className: "flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ShieldAlert, { className: "w-5 h-5 text-warning shrink-0" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "text-sm",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "font-semibold",
							children: "Complete your verification"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "text-muted-foreground text-xs",
							children: "Upload your ID, truck, and selfie to start bidding."
						})]
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(LocalLocator, {}),
				isCustomer && (() => {
					const restrictedUntil = profile?.restricted_until;
					const restricted = restrictedUntil ? new Date(restrictedUntil) > /* @__PURE__ */ new Date() : false;
					return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "space-y-2",
						children: [
							restricted && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "font-semibold text-destructive",
									children: "Posting temporarily restricted"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "text-muted-foreground text-xs mt-1",
									children: [
										"Your account is temporarily restricted from posting new jobs until",
										" ",
										new Date(restrictedUntil).toLocaleString(),
										" due to cancellation history."
									]
								})]
							}),
							!restricted && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
								to: "/customer/book",
								className: "block rounded-xl bg-gradient-primary text-primary-foreground p-4 shadow-lift",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Plus, { className: "w-6 h-6" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "font-display font-bold mt-2 uppercase",
										children: "Book delivery"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "text-xs opacity-80",
										children: "AI-priced in seconds"
									})
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-[11px] text-muted-foreground px-1",
								children: "Cancelling jobs after a driver accepts may affect your account — see our cancellation policy."
							})
						]
					});
				})(),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "grid grid-cols-2 gap-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
						to: "/jobs",
						className: "rounded-xl bg-card border p-4 shadow-soft",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Briefcase, { className: "w-6 h-6 text-primary" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "font-display font-bold mt-2 uppercase",
								children: isDriver ? "Find jobs" : "My jobs"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "text-xs text-muted-foreground",
								children: isDriver ? "Open requests" : "Track progress"
							})
						]
					}), isDriver && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
						to: "/wallet",
						className: "rounded-xl bg-card border p-4 shadow-soft",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Wallet, { className: "w-6 h-6 text-primary" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "font-display font-bold mt-2 uppercase",
								children: "Wallet"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "text-xs text-muted-foreground",
								children: "Top-ups & fees"
							})
						]
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
					title: isDriver ? "Open jobs" : "Recent jobs",
					action: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/jobs",
						className: "text-xs font-semibold text-primary uppercase tracking-wide",
						children: "See all"
					}),
					children: (jobs ?? []).length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
						icon: Truck,
						title: "Nothing here yet",
						hint: isCustomer ? "Post your first job to get bids." : "No open jobs in your area right now."
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "space-y-3",
						children: jobs.map((j) => {
							const job = j;
							return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "space-y-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(JobCard, { j }), isDriver && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DriverNavigationButtons, {
									pickup: {
										lat: job.pickup_lat ?? -17.8292,
										lng: job.pickup_lng ?? 31.0522
									},
									dropoff: {
										lat: job.dropoff_lat ?? job.delivery_lat,
										lng: job.dropoff_lng ?? job.delivery_lng
									},
									pickupLabel: job.pickup_address ?? "Harare CBD supplier pickup point",
									dropoffLabel: job.dropoff_address ?? job.delivery_address ?? "Drop-off"
								})]
							}, job.id);
						})
					})
				})
			]
		})
	});
}
//#endregion
export { RoleDashboard as t };
